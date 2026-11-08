// 探针：确认 v3 三条结算路径的真实调用序列与 state_version 演进。
import * as R from "../src/engine/vendor/v3/src/runtime.mjs";
import * as A from "../src/engine/vendor/v3/src/adventure.mjs";

const copy = x => structuredClone(x);
const attrs = Object.fromEntries(
  ["strength", "agility", "intelligence", "constitution", "physique", "dexterity",
    "perception", "knowledge", "survival", "social", "authority", "deception"].map(k => [k, 20])
);
const team = ["星穹法师", "熔岩矮人王", "花岗岩像鬼", "实习牧师"].map((name, i) => ({
  instance_id: "qa_" + i, card_id: "c" + i, name, quality: 4,
  profession: ["法师", "战士", "坦克", "法师"][i],
  gender: "男", race: "人类", personality: "睿智", attributes: attrs
}));

function makeNew(r, e) {
  const scene = R.assets.scenes[e.asset_scope.scenes[0]].name;
  return {
    event_details: {
      template_name: "新一轮事件", event_id: e.event_id,
      current_round: r.current_round, supply_value: r.supply_value, corruption_value: r.corruption_value,
      current_theme: e.title, current_type: "主线事件", scene_name: scene,
      steps: [{ narration: "测试。" }],
      options: e.options.map(o => ({
        text: o.text, id: o.id,
        template_name: { check: "检定", battle: "战斗事件", direct: "结算" }[o.resolution_type],
        visible: true, available: R.optionAvailable(r, o),
        ...(o.resolution_type === "check" ? { check_type: "常规检定", check_difficulty: o.base_difficulty } : {})
      }))
    }
  };
}

function makeSettlement(r, outcome) {
  const { event: e, effect: fx } = R.settlementEffect(r, outcome);
  const resources = Object.fromEntries(Object.entries(fx.resources).filter(([, v]) => v !== 0));
  const entries = [...fx.items.map(x => ({ type: "item", ...x })),
    ...(Object.keys(resources).length ? [{ type: "player_attr", ...resources }] : [])];
  const hard = r.corruption_value + (fx.resources.corruption ?? 0) >= 100 ||
    r.supply_value + (fx.resources.supply ?? 0) <= 0 || r.team_status === "defeated";
  return {
    event_details: {
      template_name: "结算", event_id: e.event_id,
      current_round: r.current_round, supply_value: r.supply_value, corruption_value: r.corruption_value,
      current_theme: e.title, current_type: "事件结算", scene_name: r.pending_interaction.scene_name,
      steps: [{ narration: "结算。" }],
      summary: entries.length ? [{ summary: "变化" }, ...entries] : [{ summary: "无变化" }],
      story_patch: {
        completed_event_id: e.event_id, selected_option_id: r.pending_interaction.option_id,
        outcome, run_archetype: r.story_state.run_archetype,
        run_modifier_ids: copy(r.story_state.run_modifier_ids),
        add_flags: fx.add_flags.filter(f => !r.story_state.story_flags.includes(f)),
        remove_flags: fx.remove_flags.filter(f => r.story_state.story_flags.includes(f)),
        route_delta: fx.route_delta, npc_state_updates: copy(fx.npc_updates),
        memory_notes: [], unresolved_hooks_added: [], unresolved_hooks_resolved: []
      },
      final_chapter: hard || fx.finish !== "ongoing"
    }
  };
}

function newRun(chapterId, campaign, seed = 1001) {
  return R.createChapterRun({
    campaign, chapterId, runId: "probe_" + chapterId, seed, team,
    gold: 1000, diamond: 0, relics: [],
    rewardState: R.createRewardState({ chapterId, cycleId: "probe_cycle" })
  });
}

const modeName = { check: "检定", battle: "战斗事件", direct: "结算" };

// ── 场景 1：direct 选项（结算模板）────────────────────────────
{
  console.log("=== 场景1：direct 选项（CH01_E001 option 3）===");
  const campaign = R.newCampaign("probe_direct");
  let r = newRun("CH01", campaign);
  const e = R.events.CH01_E001;
  const opt = e.options.find(o => o.resolution_type === "direct");

  // 起点：pending 为 null，AI 输出新一轮事件
  r = R.acceptNewEvent(r, makeNew(r, e));
  console.log("  acceptNewEvent 后 sv =", r.state_version, "phase =", r.pending_interaction.phase);

  // 客户端发出 choose（direct）：operation.expected_template_name = '结算'
  const op = {
    request_id: "probe_direct_1_choose", type: "choose", expected_template_name: "结算",
    event_id: e.event_id, option_id: opt.id,
    selected_option: copy(r.pending_interaction.event_output.event_details.options.find(o => o.id === opt.id))
  };
  // 服务端 pre-migrate：selectOption
  const selected = R.selectOption(r, op.option_id);
  console.log("  selectOption 后 sv =", selected.state_version, "phase =", selected.pending_interaction.phase);

  // 服务端校验：prepareAiMessages 必须能通过
  const built = R.prepareAiMessages(R.request(selected, op));
  console.log("  prepareAiMessages 通过（direct 走 choose+结算模板）");

  // 服务端推进：direct 应直接 commitSettlement（不经 acceptResolution）
  const settlement = makeSettlement(selected, "resolved");
  let ok = false;
  try {
    const committed = R.commitSettlement(selected, settlement, {
      requestId: op.request_id, expectedVersion: selected.state_version
    });
    console.log("  ✅ direct → commitSettlement 成功，sv =", committed.state_version,
      "completed =", committed.story_state.completed_events.length,
      "pending =", committed.pending_interaction);
    ok = true;
  } catch (error) {
    console.log("  ❌ commitSettlement 失败：", error.message);
  }

  // 对照：direct 若走 acceptResolution 会怎样
  try {
    const after = R.acceptResolution(selected, settlement);
    console.log("  ⚠️  若走 acceptResolution：phase =", after.pending_interaction.phase,
      "（错误路径：结算模板不应进入 awaiting_battle_result）");
  } catch (error) {
    console.log("  ✅ acceptResolution 对结算模板直接拒绝：", error.message);
  }
  if (!ok) process.exitCode = 1;
}

// ── 场景 2：nextRound 的调用位置与硬失败 ─────────────────────
{
  console.log("\n=== 场景2：nextRound 归属与 supply 扣减 ===");
  const campaign = R.newCampaign("probe_round");
  let r = newRun("CH01", campaign);
  const e = R.events.CH01_E001;
  const opt = e.options.find(o => o.resolution_type === "direct");
  r = R.acceptNewEvent(r, makeNew(r, e));
  const selected = R.selectOption(r, opt.id);
  const settlement = makeSettlement(selected, "resolved");
  const committed = R.commitSettlement(selected, settlement, {
    requestId: "probe_round_settle", expectedVersion: selected.state_version
  });
  console.log("  commitSettlement 后 sv =", committed.state_version,
    "round =", committed.current_round, "supply =", committed.supply_value,
    "completed =", committed.story_state.completed_events.length);

  const advanced = R.nextRound(committed);
  console.log("  nextRound 后 sv =", advanced.state_version, "round =", advanced.current_round,
    "supply =", advanced.supply_value, "run_status =", advanced.run_status);
  console.log("  → nextRound 使 state_version +1、current_round +1、supply 扣 difficulty(1)");

  // nextRound 后能否直接 prepare next_round 请求
  const built = R.prepareAiMessages(R.request(advanced, {
    request_id: "probe_round_next", type: "next_round", expected_template_name: "新一轮事件"
  }));
  console.log("  ✅ nextRound 之后可装配 next_round 请求");
}

// ── 场景 3：章末轮无 nextRound ────────────────────────────────
{
  console.log("\n=== 场景3：章末轮（不推进）===");
  const campaign = R.newCampaign("probe_end");
  const chapter = R.getChapter("CH01");
  let r = newRun("CH01", campaign);
  // 直接把轮次推到末轮
  r.current_round = chapter.count;
  const e = R.events[chapter.ending.event_id];
  const opt = e.options.find(o => Object.values(o.results).some(x => x.finish === "cleared"));
  r = R.acceptNewEvent(r, makeNew(r, e));
  const selected = R.selectOption(r, opt.id);
  const outcome = Object.keys(opt.results).find(k => opt.results[k].finish === "cleared");
  const settlement = makeSettlement(selected, outcome);
  const committed = R.commitSettlement(selected, settlement, {
    requestId: "probe_end_settle", expectedVersion: selected.state_version
  });
  console.log("  章末结算后 run_status =", committed.run_status, "round =", committed.current_round);
  try {
    R.nextRound(committed);
    console.log("  ⚠️ 末轮竟然可以 nextRound");
  } catch (error) {
    console.log("  ✅ 末轮 nextRound 被拒：", error.message);
  }
}
