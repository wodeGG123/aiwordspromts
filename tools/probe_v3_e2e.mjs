// 探针 2：完整双阶段端到端时序（对齐 04_完整模拟 的真实请求序列）。
//
// 关键问题：
//   1. direct 选项走 choose+结算模板时，服务端推进能否直接 commitSettlement？
//   2. nextRound 应由服务端在 next_round 请求的 pre-migrate 阶段执行吗？
//   3. 每个阶段回传给客户端的 runtime（含 state_version）如何连续？
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
const modeName = { check: "检定", battle: "战斗事件", direct: "结算" };

function makeNew(r, e) {
  const scene = R.assets.scenes[e.asset_scope.scenes[0]].name;
  return {
    event_details: {
      template_name: "新一轮事件", event_id: e.event_id,
      current_round: r.current_round, supply_value: r.supply_value, corruption_value: r.corruption_value,
      current_theme: e.title, current_type: "主线事件", scene_name: scene,
      steps: [{ narration: "测试。" }],
      options: e.options.map(o => ({
        text: o.text, id: o.id, template_name: modeName[o.resolution_type],
        visible: true, available: R.optionAvailable(r, o),
        ...(o.resolution_type === "check" ? { check_type: "常规检定", check_difficulty: o.base_difficulty } : {})
      }))
    }
  };
}
function makeCheck(r) {
  return { event_details: { template_name: "检定", analysis: "检定分析。", result: "成功" } };
}
function makeBattle(r, e) {
  return {
    event_details: {
      template_name: "战斗事件", current_round: r.current_round,
      supply_value: r.supply_value, corruption_value: r.corruption_value,
      current_theme: e.title, current_type: "战斗",
      scene_name: r.pending_interaction.scene_name, steps: [{ narration: "战斗。" }]
    },
    combat_start: true,
    enemies: e.enemy_names.map(name => ({ name }))
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

const log = [];
function step(name, fn) {
  const before = process.hrtime.bigint();
  const result = fn();
  log.push(name);
  return result;
}

// ══ 场景 A：检定路径（choose → settle_check → next_round）══════════
function runCheckPath() {
  console.log("=== 场景A：检定路径（两阶段）===");
  const campaign = R.newCampaign("probe_a");
  let adventure = A.createAdventure("probe_a");
  adventure = A.continueAdventure(adventure, {
    expectedRevision: adventure.revision, runId: "probe_a_run", seed: 1001, team,
    gold: 1000, diamond: 0, relics: [],
    rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "cycle_a" })
  });
  console.log("  入章 sv =", adventure.runtime.state_version, "round =", adventure.runtime.current_round);

  const e = R.events.CH01_E001;
  const opt = e.options.find(o => o.resolution_type === "check");

  // ── 请求 1：start（新事件）
  let op = { request_id: "a1", type: "start", expected_template_name: "新一轮事件", forced_event_id: e.event_id };
  let runtime = adventure.runtime;
  R.prepareAiMessages(R.request(runtime, op));  // 服务端装配
  runtime = R.acceptNewEvent(runtime, makeNew(runtime, e));  // 服务端推进
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [start]      → sv =", runtime.state_version, "phase =", runtime.pending_interaction.phase);

  // ── 请求 2：choose（检定）  ← 服务端 pre-migrate: selectOption
  const selectedOption = copy(runtime.pending_interaction.event_output.event_details.options.find(o => o.id === opt.id));
  op = {
    request_id: "a2", type: "choose", expected_template_name: "检定",
    event_id: e.event_id, option_id: opt.id, selected_option: selectedOption, check_attempt: 0
  };
  runtime = R.selectOption(runtime, op.option_id);   // pre-migrate
  R.prepareAiMessages(R.request(runtime, op));         // 装配
  runtime = R.acceptResolution(runtime, makeCheck(runtime));  // 推进
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [choose]     → sv =", runtime.state_version, "phase =", runtime.pending_interaction.phase,
    "resolution =", runtime.pending_interaction.resolution_output.event_details.template_name);

  // ── 请求 3：settle_check（结算）  ← 客户端回传 runtime（已含 resolution_output）
  op = {
    request_id: "a3", type: "settle_check", expected_template_name: "结算",
    event_id: e.event_id, option_id: opt.id, check_result: "成功"
  };
  R.prepareAiMessages(R.request(runtime, op));  // 装配
  runtime = R.commitSettlement(runtime, makeSettlement(runtime, "success"), {
    requestId: op.request_id, expectedVersion: runtime.state_version
  });
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [settle]     → sv =", runtime.state_version, "pending =", runtime.pending_interaction,
    "completed =", runtime.story_state.completed_events.length);

  // ── 请求 4：next_round（新事件）  ← 服务端 pre-migrate: nextRound
  op = { request_id: "a4", type: "next_round", expected_template_name: "新一轮事件" };
  const e2 = R.events.CH01_E002;
  runtime = R.nextRound(runtime);   // pre-migrate
  console.log("     pre-migrate nextRound → sv =", runtime.state_version, "round =", runtime.current_round,
    "supply =", runtime.supply_value);
  R.prepareAiMessages(R.request(runtime, op));
  runtime = R.acceptNewEvent(runtime, makeNew(runtime, e2));
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [next_round] → sv =", runtime.state_version, "round =", runtime.current_round,
    "phase =", runtime.pending_interaction.phase);

  // ── 幂等性检查：同一快照重放请求 4
  const snapshot = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  const replayRuntime = R.nextRound(snapshot.runtime);  // 从结算后快照重放
  console.log("  [重放] next_round 从同一 base 快照重放 → sv =", replayRuntime.state_version,
    "round =", replayRuntime.current_round, "（与首跑一致 =", replayRuntime.state_version === 5 + 1, "）");
}

// ══ 场景 B：战斗路径（choose → battle_result）═════════════════════
function runBattlePath() {
  console.log("\n=== 场景B：战斗路径（两阶段）===");
  const campaign = R.newCampaign("probe_b");
  let adventure = A.createAdventure("probe_b");
  adventure = A.continueAdventure(adventure, {
    expectedRevision: adventure.revision, runId: "probe_b_run", seed: 1001, team,
    gold: 1000, diamond: 0, relics: [],
    rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "cycle_b" })
  });
  const e = R.events.CH01_E005;
  const opt = e.options.find(o => o.resolution_type === "battle");

  let op = { request_id: "b1", type: "start", expected_template_name: "新一轮事件", forced_event_id: e.event_id };
  let runtime = adventure.runtime;
  runtime = R.acceptNewEvent(runtime, makeNew(runtime, e));
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });

  const selectedOption = copy(runtime.pending_interaction.event_output.event_details.options.find(o => o.id === opt.id));
  op = {
    request_id: "b2", type: "choose", expected_template_name: "战斗事件",
    event_id: e.event_id, option_id: opt.id, selected_option: selectedOption
  };
  runtime = R.selectOption(runtime, op.option_id);
  R.prepareAiMessages(R.request(runtime, op));
  runtime = R.acceptResolution(runtime, makeBattle(runtime, e));   // phase → awaiting_battle_result
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [choose]     → sv =", runtime.state_version, "phase =", runtime.pending_interaction.phase);

  // 客户端本地战斗 → victory
  op = {
    request_id: "b3", type: "battle_result", expected_template_name: "结算",
    event_id: e.event_id, option_id: opt.id, battle_result: "victory"
  };
  runtime = R.acceptBattleResult(runtime, op.battle_result);   // pre-migrate
  console.log("     pre-migrate acceptBattleResult → sv =", runtime.state_version,
    "phase =", runtime.pending_interaction.phase);
  R.prepareAiMessages(R.request(runtime, op));
  runtime = R.commitSettlement(runtime, makeSettlement(runtime, "victory"), {
    requestId: op.request_id, expectedVersion: runtime.state_version
  });
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [battle]     → sv =", runtime.state_version, "completed =",
    runtime.story_state.completed_events.length, "pending =", runtime.pending_interaction);
}

// ══ 场景 C：direct 路径（choose + 结算模板，单阶段）═══════════════
function runDirectPath() {
  console.log("\n=== 场景C：direct 路径（单阶段 choose+结算）===");
  const campaign = R.newCampaign("probe_c");
  let adventure = A.createAdventure("probe_c");
  adventure = A.continueAdventure(adventure, {
    expectedRevision: adventure.revision, runId: "probe_c_run", seed: 1001, team,
    gold: 1000, diamond: 0, relics: [],
    rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "cycle_c" })
  });
  const e = R.events.CH01_E001;
  const opt = e.options.find(o => o.resolution_type === "direct");

  let runtime = adventure.runtime;
  runtime = R.acceptNewEvent(runtime, makeNew(runtime, e));
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });

  const selectedOption = copy(runtime.pending_interaction.event_output.event_details.options.find(o => o.id === opt.id));
  const op = {
    request_id: "c2", type: "choose", expected_template_name: "结算",
    event_id: e.event_id, option_id: opt.id, selected_option: selectedOption
  };
  runtime = R.selectOption(runtime, op.option_id);   // pre-migrate
  R.prepareAiMessages(R.request(runtime, op));
  // ✅ 正确路径：direct 直接 commitSettlement
  runtime = R.commitSettlement(runtime, makeSettlement(runtime, "resolved"), {
    requestId: op.request_id, expectedVersion: runtime.state_version
  });
  adventure = A.updateAdventure(adventure, runtime, { expectedRevision: adventure.revision });
  console.log("  [choose+结算] → sv =", runtime.state_version, "completed =",
    runtime.story_state.completed_events.length, "pending =", runtime.pending_interaction);

  // ❌ 错误路径验证：若服务端对 direct 也走 acceptResolution
  const fresh = R.selectOption(R.acceptNewEvent(
    A.continueAdventure(A.createAdventure("probe_c2"), {
      expectedRevision: 0, runId: "probe_c2_run", seed: 1001, team, gold: 1000, diamond: 0, relics: [],
      rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "cycle_c2" })
    }).runtime, makeNew(
      A.continueAdventure(A.createAdventure("probe_c3"), {
        expectedRevision: 0, runId: "probe_c3_run", seed: 1001, team, gold: 1000, diamond: 0, relics: [],
        rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "cycle_c3" })
      }).runtime, R.events.CH01_E001
    )), opt.id);
  const afterAccept = R.acceptResolution(fresh, makeSettlement(fresh, "resolved"));
  console.log("  ⚠️ 错误路径 acceptResolution → phase =", afterAccept.pending_interaction.phase,
    "（应为 awaiting_settlement_commit，实际错误）");
}

runCheckPath();
runBattlePath();
runDirectPath();
console.log("\n完成。");
