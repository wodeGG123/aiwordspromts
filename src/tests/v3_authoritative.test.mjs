import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as R from "../engine/vendor/v3/src/runtime.mjs";
import * as A from "../engine/vendor/v3/src/adventure.mjs";
import {
  advanceV3,
  parseV3Output,
  prepareV3Prompt,
  V3_PACKAGE_VERSION
} from "../engine/v3_adapter.mjs";
import {
  applyAuthoritativeFill,
  buildAuthority,
  buildCheckAuthority,
  buildSettlementAuthority,
  checkDifficultyFor,
  checkSuffixFor,
  normalizeOptionText,
  authorityPromptBlock
} from "../engine/v3_authoritative.mjs";

const ATTRIBUTE_KEYS = [
  "strength", "agility", "intelligence", "constitution", "physique", "dexterity",
  "perception", "knowledge", "survival", "social", "authority", "deception"
];

function fixtureTeam() {
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, 20]));
  return ["星穹法师", "熔岩矮人王", "花岗岩像鬼", "实习牧师"].map((name, index) => ({
    instance_id: `qa_${index}`,
    card_id: `card_${index}`,
    name,
    quality: 4,
    profession: ["法师", "战士", "坦克", "法师"][index],
    gender: "男",
    race: "人族",
    personality: "睿智",
    attributes
  }));
}

function newAdventure(campaignId = "test_campaign_auth") {
  const adventure = A.createAdventure(campaignId);
  return A.continueAdventure(adventure, {
    expectedRevision: adventure.revision,
    runId: `test_run_${campaignId}`,
    seed: 1001,
    team: fixtureTeam(),
    gold: 1000,
    diamond: 0,
    relics: [],
    rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "test_cycle" })
  });
}

function requestBody(adventure, operation) {
  return {
    package_version: V3_PACKAGE_VERSION,
    adventure,
    operation
  };
}

const TEMPLATE_BY_RESOLUTION = {
  check: "检定",
  battle: "战斗事件",
  direct: "结算"
};

/** 用事件表真实选项构造一份合法的新事件输出。 */
function newEventOutput(runtime, event) {
  return {
    event_details: {
      template_name: "新一轮事件",
      event_id: event.event_id,
      current_round: runtime.current_round,
      supply_value: runtime.supply_value,
      corruption_value: runtime.corruption_value,
      current_theme: event.title,
      current_type: "主线事件",
      scene_name: R.assets.scenes[event.asset_scope.scenes[0]].name,
      steps: [{ narration: "队伍抵达现场。" }],
      options: event.options.map(option => ({
        text: option.text,
        id: option.id,
        template_name: TEMPLATE_BY_RESOLUTION[option.resolution_type],
        visible: true,
        available: true,
        ...(option.resolution_type === "check"
          ? { check_type: "常规检定", check_difficulty: Math.min(20, option.base_difficulty) }
          : {})
      }))
    }
  };
}

/** 造一个「AI 完全不听话」的输出：机器字段全错、字段类型也错。 */
function garbageNewEvent() {
  return {
    event_details: {
      template_name: "新一轮事件",
      event_id: "TOTALLY_INVALID_EVENT",
      current_round: 999,
      supply_value: -5,
      corruption_value: 777,
      current_theme: "模型自己编的主题",
      current_type: "模型自己编的类型",
      scene_name: "模型自己编的场景",
      steps: [{ narration: "队伍踏进陌生的巷子。" }],
      options: [
        { text: "模型自造选项", id: 42, template_name: "结算", visible: false, available: false }
      ]
    }
  };
}

/** 把存档推进到指定轮数（每轮走「直选结算」跳过战斗）。 */
function advanceRounds(adventure, rounds) {
  let runtime = adventure.runtime;
  for (let round = 1; round <= rounds; round += 1) {
    const eventId = `CH01_E${String(round).padStart(3, "0")}`;
    const event = R.events[eventId];
    runtime = R.acceptNewEvent(runtime, newEventOutput(runtime, event));
    const directOption = event.options.find(o => o.resolution_type === "direct");
    runtime = R.selectOption(runtime, directOption.id);
    runtime = R.commitSettlement(runtime, referenceSettlement(runtime, "resolved"), {
      requestId: `settle_${round}`,
      expectedVersion: runtime.state_version
    });
    runtime = R.nextRound(runtime);
  }
  return runtime;
}

/** 造一份合法的结算输出（供 advanceRounds 使用）。 */
function referenceSettlement(runtime, outcome) {
  const { event, effect } = R.settlementEffect(runtime, outcome);
  const resources = Object.fromEntries(
    Object.entries(effect.resources).filter(([, value]) => value !== 0)
  );
  const entries = [
    ...effect.items.map(item => ({ type: "item", ...item })),
    ...(Object.keys(resources).length ? [{ type: "player_attr", ...resources }] : [])
  ];
  const hard =
    runtime.corruption_value + (effect.resources.corruption ?? 0) >= 100 ||
    runtime.supply_value + (effect.resources.supply ?? 0) <= 0 ||
    runtime.team_status === "defeated";
  const status = hard ? "failed" : effect.finish;
  const currentFlags = runtime.story_state.story_flags;
  return {
    event_details: {
      template_name: "结算",
      event_id: event.event_id,
      current_round: runtime.current_round,
      supply_value: runtime.supply_value,
      corruption_value: runtime.corruption_value,
      current_theme: event.title,
      current_type: "事件结算",
      scene_name: runtime.pending_interaction.scene_name,
      steps: [{ narration: "行动有了结果。" }],
      summary: entries.length
        ? entries
        : [{ summary: "无物品或数值变化" }],
      story_patch: {
        completed_event_id: event.event_id,
        selected_option_id: runtime.pending_interaction.option_id,
        outcome,
        run_archetype: runtime.story_state.run_archetype,
        run_modifier_ids: runtime.story_state.run_modifier_ids,
        add_flags: effect.add_flags.filter(f => !currentFlags.includes(f)),
        remove_flags: effect.remove_flags.filter(f => currentFlags.includes(f)),
        route_delta: effect.route_delta,
        npc_state_updates: effect.npc_updates,
        memory_notes: [],
        unresolved_hooks_added: [],
        unresolved_hooks_resolved: []
      },
      final_chapter: status !== "ongoing"
    }
  };
}

/** 找到 CH01 里含战斗选项的事件（战斗事件在第 5 轮才出现）。 */
function findBattleEvent() {
  for (const event of Object.values(R.events)) {
    if (event.chapter_id !== "CH01") continue;
    if (!event.options.some(o => o.resolution_type === "battle")) continue;
    if (!event.enemy_names?.length) continue;
    return event;
  }
  throw new Error("找不到含战斗选项的事件");
}

describe("v3 权威填空表：提示词注入", () => {
  it("start 的 user prompt 含权威填空表，且列出候选事件与选项块", () => {
    const adventure = newAdventure();
    const prepared = prepareV3Prompt(requestBody(adventure, {
      request_id: "s1", type: "start", expected_template_name: "新一轮事件"
    }));
    assert.match(prepared.userPrompt, /#本次权威填空表/);
    assert.match(prepared.userPrompt, /event_id: "CH01_E001"/);
    assert.match(prepared.userPrompt, /check_difficulty: \d+/);
    // 快照值必须来自 runtime，而不是模型。
    assert.match(prepared.userPrompt, new RegExp(`current_round: ${adventure.runtime.current_round}`));
    assert.match(prepared.userPrompt, new RegExp(`supply_value: ${adventure.runtime.supply_value}`));
  });

  it("结算的权威填空表逐字给出 story_patch 机器字段", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const withPending = R.acceptNewEvent(adventure.runtime, newEventOutput(adventure.runtime, event));
    const checkOption = event.options.find(o => o.resolution_type === "check");
    const selected = R.selectOption(withPending, checkOption.id);
    const settled = R.acceptResolution(selected, {
      event_details: { template_name: "检定", analysis: "测试。", result: "成功" }
    });

    const authority = buildSettlementAuthority(settled, {
      expected_template_name: "结算", type: "settle_check"
    });
    assert.ok(authority);
    assert.equal(authority.outcome, "success");
    assert.equal(authority.event_id, "CH01_E001");
    assert.equal(authority.selected_option_id, checkOption.id);
    assert.equal(authority.final_chapter, false);

    const block = authorityPromptBlock(authority);
    assert.match(block, /outcome: "success"/);
    assert.match(block, /completed_event_id: "CH01_E001"/);
    assert.match(block, new RegExp(`selected_option_id: ${checkOption.id}`));
    assert.match(block, new RegExp(`run_archetype: "${adventure.runtime.story_state.run_archetype}"`));
    assert.match(block, /route_delta:/);
    assert.match(block, /final_chapter 必须是 false/);
    assert.match(block, /- "MOD_GHOST_TIDE"/);
    assert.match(block, /- "MOD_FRACTURED_TRUST"/);
  });

  it("结算填空表：空数组必须写成同行 []，不能是裸键", () => {
    // ⚠️ 2026-11-09 线上事故（Round 24 choose）：
    //    填空表把空的 remove_flags 写成裸键 `remove_flags:`，
    //    模型逐字复制后，受限 YAML 解析器直接判 YAML_CHILD_INDENT，整份输出被丢弃。
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const withPending = R.acceptNewEvent(adventure.runtime, newEventOutput(adventure.runtime, event));
    const checkOption = event.options.find(o => o.resolution_type === "check");
    const selected = R.selectOption(withPending, checkOption.id);
    const settled = R.acceptResolution(selected, {
      event_details: { template_name: "检定", analysis: "测试。", result: "成功" }
    });
    const operation = {
      request_id: "s-empty-array",
      type: "settle_check",
      expected_template_name: "结算",
      event_id: event.event_id,
      option_id: checkOption.id,
      check_result: "成功"
    };
    const prepared = prepareV3Prompt(requestBody({ ...adventure, runtime: settled }, operation));
    const authority = buildSettlementAuthority(settled, operation);
    assert.ok(authority);

    const block = authorityPromptBlock(authority);
    // ⚠️ 关键不变量：**空数组必须内联写成 `key: []`**。
    //    权威填空表里若出现裸键（`remove_flags:` 后面什么都不写），
    //    模型逐字复制后，受限 YAML 解析器会判 YAML_CHILD_INDENT，整份输出被丢弃。
    //    （非空数组用裸键是安全的：模型会自己补出缩进后的列表项。）
    assert.match(block, /^remove_flags: \[\]$/m);
    assert.match(block, /^npc_state_updates: \[\]$/m);
    // 空数组的键一律不得以裸键形式出现。
    assert.doesNotMatch(block, /^remove_flags:$/m);
    assert.doesNotMatch(block, /^npc_state_updates:$/m);
    // 非空数组仍然是裸键 + 列表项（模型会补缩进）。
    assert.match(block, /^add_flags:$/m);
  });
});

describe("v3 权威填空表：服务端归一化", () => {
  it("新一轮事件：AI 全错也能被救回", () => {
    const adventure = newAdventure();
    const operation = {
      request_id: "s-garbage", type: "start", expected_template_name: "新一轮事件"
    };
    const prepared = prepareV3Prompt(requestBody(adventure, operation));
    const { document, repairs } = applyAuthoritativeFill(
      garbageNewEvent(), prepared.premigratedAdventure.runtime, operation
    );
    const details = document.event_details;
    assert.equal(details.event_id, "CH01_E001");
    assert.equal(details.current_round, adventure.runtime.current_round);
    assert.equal(details.supply_value, adventure.runtime.supply_value);
    assert.equal(details.corruption_value, adventure.runtime.corruption_value);
    assert.equal(details.scene_name, R.assets.scenes.scene_village.name);
    assert.equal(details.options.length, R.events.CH01_E001.options.length);
    assert.ok(details.options.every(o => o.id !== 42));
    assert.ok(repairs.length > 0);
  });

  it("新一轮事件：归一化后的输出能被引擎接受并推进状态", () => {
    const adventure = newAdventure();
    const operation = {
      request_id: "s-advance", type: "start", expected_template_name: "新一轮事件"
    };
    const prepared = prepareV3Prompt(requestBody(adventure, operation));
    const parsed = parseV3Output(
      R.yaml(garbageNewEvent()), operation, prepared.premigratedAdventure.runtime
    );
    const advanced = advanceV3(prepared.premigratedAdventure, operation, parsed);
    assert.equal(advanced.adventure.runtime.pending_interaction.phase, "awaiting_choice");
    assert.equal(advanced.adventure.runtime.pending_interaction.event_id, "CH01_E001");
  });

  it("结算：AI 写错的 flags/route_delta/npc/summary/final_chapter 全部被纠正", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const withPending = R.acceptNewEvent(adventure.runtime, newEventOutput(adventure.runtime, event));
    const checkOption = event.options.find(o => o.resolution_type === "check");
    const selected = R.selectOption(withPending, checkOption.id);
    const settled = R.acceptResolution(selected, {
      event_details: { template_name: "检定", analysis: "测试。", result: "成功" }
    });
    const operation = {
      request_id: "s-settle",
      type: "settle_check",
      expected_template_name: "结算",
      event_id: event.event_id,
      option_id: checkOption.id,
      check_result: "成功"
    };
    const prepared = prepareV3Prompt(requestBody({ ...adventure, runtime: settled }, operation));

    const garbageSettlement = {
      event_details: {
        template_name: "结算",
        event_id: "WRONG_EVENT",
        current_round: 999,
        supply_value: -1,
        corruption_value: 999,
        current_theme: "",
        current_type: "",
        scene_name: "",
        steps: [],
        summary: [{ summary: "模型编的描述" }, { type: "item", id: 123456, count: 7 }],
        story_patch: {
          completed_event_id: "WRONG_EVENT",
          selected_option_id: 99,
          outcome: "victory",
          run_archetype: "模型编的",
          run_modifier_ids: ["MOD_FAKE"],
          add_flags: ["FAKE_FLAG"],
          remove_flags: ["FAKE_FLAG2"],
          route_delta: { combat: 9, scheme: 9, cleanse: 9 },
          npc_state_updates: [{ npc: "托娃", state: "trusted" }],
          memory_notes: ["模型编的记忆"],
          unresolved_hooks_added: ["模型编的悬念"],
          unresolved_hooks_resolved: ["不存在的悬念"]
        },
        final_chapter: true
      }
    };

    const { document } = applyAuthoritativeFill(
      garbageSettlement, prepared.premigratedAdventure.runtime, operation
    );
    const details = document.event_details;
    assert.equal(details.event_id, "CH01_E001");
    assert.equal(details.current_round, adventure.runtime.current_round);
    assert.equal(details.supply_value, adventure.runtime.supply_value);
    assert.equal(details.corruption_value, adventure.runtime.corruption_value);
    assert.equal(details.final_chapter, false);
    assert.equal(details.story_patch.outcome, "success");
    assert.equal(details.story_patch.selected_option_id, checkOption.id);
    assert.equal(details.story_patch.run_archetype, adventure.runtime.story_state.run_archetype);
    assert.deepEqual(details.story_patch.run_modifier_ids, adventure.runtime.story_state.run_modifier_ids);
    assert.deepEqual(details.story_patch.npc_state_updates, []);
    assert.deepEqual(details.story_patch.unresolved_hooks_resolved, []);
    // memory_notes 是叙事字段，保留模型值。
    assert.deepEqual(details.story_patch.memory_notes, ["模型编的记忆"]);
    // summary 的 item 列表必须与授权一致（模型自造的 123456 被剔除）。
    assert.equal(details.summary.filter(x => x.type === "item").length, 0);
  });

  it("归一化后的结算能被引擎接受并推进状态", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const withPending = R.acceptNewEvent(adventure.runtime, newEventOutput(adventure.runtime, event));
    const checkOption = event.options.find(o => o.resolution_type === "check");
    const selected = R.selectOption(withPending, checkOption.id);
    const settled = R.acceptResolution(selected, {
      event_details: { template_name: "检定", analysis: "测试。", result: "成功" }
    });
    const operation = {
      request_id: "s-advance-settle",
      type: "settle_check",
      expected_template_name: "结算",
      event_id: event.event_id,
      option_id: checkOption.id,
      check_result: "成功"
    };
    const prepared = prepareV3Prompt(requestBody({ ...adventure, runtime: settled }, operation));

    const garbageSettlement = {
      event_details: {
        template_name: "结算",
        event_id: "WRONG",
        current_round: 999,
        supply_value: 0,
        corruption_value: 0,
        current_theme: "t",
        current_type: "t",
        scene_name: "s",
        steps: [{ narration: "结果落定。" }],
        summary: [{ summary: "描述" }],
        story_patch: {
          completed_event_id: "WRONG",
          selected_option_id: 99,
          outcome: "victory",
          run_archetype: "x",
          run_modifier_ids: ["a", "b"],
          add_flags: ["FAKE"],
          remove_flags: [],
          route_delta: { combat: 1, scheme: 1, cleanse: 1 },
          npc_state_updates: [{ npnpc: "托娃", state: "trusted" }],
          memory_notes: [],
          unresolved_hooks_added: [],
          unresolved_hooks_resolved: []
        },
        final_chapter: true
      }
    };

    const parsed = parseV3Output(
      R.yaml(garbageSettlement), operation, prepared.premigratedAdventure.runtime
    );
    assert.ok(Array.isArray(parsed.__repairs) && parsed.__repairs.length);
    const advanced = advanceV3(prepared.premigratedAdventure, operation, parsed);
    assert.equal(advanced.adventure.runtime.pending_interaction, null);
    assert.equal(advanced.adventure.runtime.run_status, "ongoing");
  });

  it("战斗事件：AI 自造敌人被事件表替换", () => {
    const adventure = newAdventure();
    const runtime = advanceRounds(adventure, 4);
    const event = findBattleEvent();
    const withPending = R.acceptNewEvent(runtime, newEventOutput(runtime, event));
    const battleOption = event.options.find(o => o.resolution_type === "battle");
    const selectedOption = withPending.pending_interaction.event_output.event_details.options
      .find(o => o.id === battleOption.id);
    const operation = {
      request_id: "s-battle",
      type: "choose",
      expected_template_name: "战斗事件",
      event_id: event.event_id,
      option_id: battleOption.id,
      selected_option: selectedOption
    };
    const prepared = prepareV3Prompt(
      requestBody({ ...adventure, runtime: withPending }, operation)
    );

    const garbageBattle = {
      event_details: {
        template_name: "战斗事件",
        current_round: 42,
        supply_value: 42,
        corruption_value: 42,
        current_theme: "模型编的主题",
        current_type: "模型编的类型",
        scene_name: "模型编的场景",
        steps: [{ narration: "战斗开始。" }]
      },
      combat_start: true,
      enemies: [{ name: "模型编的敌人" }]
    };
    const { document } = applyAuthoritativeFill(
      garbageBattle, prepared.premigratedAdventure.runtime, operation
    );
    assert.deepEqual(
      document.enemies.map(e => e.name),
      event.enemy_names.slice(0, 4)
    );
    assert.equal(document.event_details.scene_name, withPending.pending_interaction.scene_name);
    assert.equal(document.event_details.current_round, runtime.current_round);
  });

  it("检定：非法结果被收敛为失败，analysis 保留模型值", () => {    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const withPending = R.acceptNewEvent(adventure.runtime, newEventOutput(adventure.runtime, event));
    const checkOption = event.options.find(o => o.resolution_type === "check");
    const selectedOption = withPending.pending_interaction.event_output.event_details.options
      .find(o => o.id === checkOption.id);
    const operation = {
      request_id: "s-check",
      type: "choose",
      expected_template_name: "检定",
      event_id: event.event_id,
      option_id: checkOption.id,
      selected_option: selectedOption
    };
    const prepared = prepareV3Prompt(requestBody({ ...adventure, runtime: withPending }, operation));
    const garbageCheck = {
      event_details: {
        template_name: "检定",
        analysis: "模型写的检定过程。",
        result: "超级成功"
      }
    };
    const { document } = applyAuthoritativeFill(
      garbageCheck, prepared.premigratedAdventure.runtime, operation
    );
    assert.equal(document.event_details.result, "失败");
    assert.equal(document.event_details.analysis, "模型写的检定过程。");
  });
});

describe("v3 权威填空表：派生规则", () => {
  it("选项文案强制补回检定后缀（玩法关键信息不能丢）", () => {
    const checkOption = {
      text: "先控制眼前的危险",
      template_name: "检定",
      check_mode: "standard_fixed",
      attribute: "social"
    };
    // AI 漏掉后缀 → 补上。
    assert.equal(
      normalizeOptionText("先控制眼前的危险", checkOption),
      "先控制眼前的危险（社交检定）"
    );
    // AI 已经带了正确后缀 → 原样保留。
    assert.equal(
      normalizeOptionText("先控制眼前的危险（社交检定）", checkOption),
      "先控制眼前的危险（社交检定）"
    );
    // AI 带错了后缀 → 以程序真值为准。
    assert.equal(
      normalizeOptionText("先控制眼前的危险（感知检定）", checkOption),
      "先控制眼前的危险（社交检定）"
    );
    // AI 没写文案 → 用事件表原文。
    assert.equal(
      normalizeOptionText(null, checkOption),
      "先控制眼前的危险（社交检定）"
    );
    // 非检定选项不加后缀。
    assert.equal(
      normalizeOptionText("撤离", { text: "撤离", template_name: "结算" }),
      "撤离"
    );
  });

  it("检定难度按档位修正并限制 0-20", () => {
    const base = { base_difficulty: 8 };
    assert.equal(checkDifficultyFor({ run_difficulty: "normal" }, base), 8);
    assert.equal(checkDifficultyFor({ run_difficulty: "hard" }, base), 10);
    assert.equal(checkDifficultyFor({ run_difficulty: "nightmare" }, base), 12);
    assert.equal(checkDifficultyFor({ run_difficulty: "nightmare" }, { base_difficulty: 19 }), 20);
    assert.equal(checkDifficultyFor({ run_difficulty: "normal" }, { base_difficulty: 30 }), 20);
  });

  it("检定后缀区分常规与隐藏", () => {
    assert.equal(checkSuffixFor({ check_mode: "standard_fixed", attribute: "social" }), "（社交检定）");
    assert.equal(checkSuffixFor({ check_mode: "standard_auto", attribute: "perception" }), "（感知检定）");
    assert.equal(checkSuffixFor({ check_mode: "hidden_attribute", attribute: "intelligence" }), "（隐藏检定）");
    assert.equal(checkSuffixFor({ check_mode: "hidden_context" }), "（隐藏检定）");
  });

  it("检定权威块给出 roll、腐化惩罚与阈值", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const withPending = R.acceptNewEvent(adventure.runtime, newEventOutput(adventure.runtime, event));
    const checkOption = event.options.find(o => o.resolution_type === "check");
    const selected = R.selectOption(withPending, checkOption.id);
    const authority = buildCheckAuthority(selected);
    assert.equal(authority.roll, (Math.abs(1001) + selected.current_round * 7 + checkOption.id * 13) % 21);
    assert.equal(authority.corruption_penalty, 0);
    assert.equal(authority.difficulty, Math.min(20, checkOption.base_difficulty));
    assert.equal(authority.great_success_threshold, authority.difficulty + 10);
  });

  it("buildAuthority 按 operation 分派到对应模板", () => {
    const adventure = newAdventure();
    assert.equal(
      buildAuthority(adventure.runtime, { expected_template_name: "新一轮事件" })?.template_name,
      "新一轮事件"
    );
    assert.equal(
      buildAuthority(adventure.runtime, { expected_template_name: "检定" })?.template_name,
      "检定"
    );
    assert.equal(
      buildAuthority(adventure.runtime, { expected_template_name: "战斗事件" })?.template_name,
      "战斗事件"
    );
    // 结算在没有 pending 时返回 null（不猜）。
    assert.equal(buildAuthority(adventure.runtime, { expected_template_name: "结算" }), null);
  });
});
