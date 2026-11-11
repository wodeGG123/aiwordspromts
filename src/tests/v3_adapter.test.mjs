import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as R from "../engine/vendor/v3/src/runtime.mjs";
import * as A from "../engine/vendor/v3/src/adventure.mjs";
import {
  advanceV3,
  parseV3Output,
  prepareV3Prompt,
  transitionV3,
  V3ContractError,
  V3OutputError,
  V3_PACKAGE_VERSION
} from "../engine/v3_adapter.mjs";

const copy = x => structuredClone(x);
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

/** 创建一个刚入章（CH01 / Round 1）的 adventure 存档。 */
function newAdventure(campaignId = "test_campaign_001") {
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

// ── 参考文档构造（与数据包 tests/simulation.mjs 保持一致）────────
function referenceNewEvent(runtime, event) {
  const scene = R.assets.scenes[event.asset_scope.scenes[0]].name;
  const templateByType = { check: "检定", battle: "战斗事件", direct: "结算" };
  return {
    event_details: {
      template_name: "新一轮事件",
      event_id: event.event_id,
      current_round: runtime.current_round,
      supply_value: runtime.supply_value,
      corruption_value: runtime.corruption_value,
      current_theme: event.title,
      current_type: event.kind === "hidden" ? "隐藏事件" : event.kind === "main" ? "主线事件" : "随机事件",
      scene_name: scene,
      steps: [{ narration: `队伍来到${scene}。` }],
      options: event.options.map(option => ({
        text: option.text,
        id: option.id,
        template_name: templateByType[option.resolution_type],
        visible: true,
        available: R.optionAvailable(runtime, option),
        ...(option.resolution_type === "check"
          ? { check_type: "常规检定", check_difficulty: Math.min(20, option.base_difficulty) }
          : {})
      }))
    }
  };
}

function referenceCheck(result = "成功") {
  return {
    event_details: {
      template_name: "检定",
      analysis: "测试检定。",
      result
    }
  };
}

function referenceSettlement(runtime, outcome) {
  const { event, effect } = R.settlementEffect(runtime, outcome);
  const resources = Object.fromEntries(Object.entries(effect.resources).filter(([, value]) => value !== 0));
  const entries = [
    ...effect.items.map(item => ({ type: "item", ...item })),
    ...(Object.keys(resources).length ? [{ type: "player_attr", ...resources }] : [])
  ];
  const hard =
    runtime.corruption_value + (effect.resources.corruption ?? 0) >= 100 ||
    runtime.supply_value + (effect.resources.supply ?? 0) <= 0 ||
    runtime.team_status === "defeated";
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
        ? [{ summary: "本次行动造成以下变化" }, ...entries]
        : [{ summary: "无物品或数值变化" }],
      story_patch: {
        completed_event_id: event.event_id,
        selected_option_id: runtime.pending_interaction.option_id,
        outcome,
        run_archetype: runtime.story_state.run_archetype,
        run_modifier_ids: copy(runtime.story_state.run_modifier_ids),
        add_flags: effect.add_flags.filter(flag => !runtime.story_state.story_flags.includes(flag)),
        remove_flags: effect.remove_flags.filter(flag => runtime.story_state.story_flags.includes(flag)),
        route_delta: effect.route_delta,
        npc_state_updates: copy(effect.npc_updates),
        memory_notes: [],
        unresolved_hooks_added: [],
        unresolved_hooks_resolved: []
      },
      final_chapter: hard || effect.finish !== "ongoing"
    }
  };
}

/**
 * 完整跑完 Round 1（生成事件 → 选直接结算选项 → 结算），
 * 返回「本轮已完成、pending 为空」的 runtime，可用于 next_round 预迁移。
 */
function completeRoundOne(adventure, eventId = "CH01_E001", optionId = 3) {
  const event = R.events[eventId];
  let runtime = R.acceptNewEvent(adventure.runtime, referenceNewEvent(adventure.runtime, event));
  runtime = R.selectOption(runtime, optionId);
  const settlement = referenceSettlement(runtime, "resolved");
  runtime = R.commitSettlement(runtime, settlement, {
    requestId: "round1_settle",
    expectedVersion: runtime.state_version
  });
  return runtime;
}

/**
 * 连跑前 n 轮（每轮走 direct 选项），返回第 n+1 轮开始前的 runtime。
 * 用于把存档推进到指定轮次（如 CH01_E005 在 Round 5）。
 */
function advanceRounds(adventure, rounds) {
  let runtime = adventure.runtime;
  for (let round = 1; round <= rounds; round += 1) {
    const eventId = `CH01_E${String(round).padStart(3, "0")}`;
    const event = R.events[eventId];
    runtime = R.acceptNewEvent(runtime, referenceNewEvent(runtime, event));
    runtime = R.selectOption(runtime, 3);
    runtime = R.commitSettlement(
      runtime,
      referenceSettlement(runtime, "resolved"),
      { requestId: `settle_${round}`, expectedVersion: runtime.state_version }
    );
    runtime = R.nextRound(runtime);
  }
  return runtime;
}

describe("v3 请求校验", () => {
  it("拒绝不匹配的包版本", () => {
    const adventure = newAdventure();
    assert.throws(
      () => prepareV3Prompt({
        package_version: "2026.09.04.1",
        adventure,
        operation: {
          request_id: "r1", type: "start", expected_template_name: "新一轮事件"
        }
      }),
      error => error instanceof V3ContractError && /包版本不匹配/.test(error.message)
    );
  });

  it("拒绝 schema_version 不是 3 的存档", () => {
    const adventure = { ...newAdventure(), schema_version: 2 };
    assert.throws(
      () => prepareV3Prompt(requestBody(adventure, {
        request_id: "r2", type: "start", expected_template_name: "新一轮事件"
      })),
      error => error instanceof V3ContractError && /schema_version/.test(error.message)
    );
  });

  it("拒绝 operation 与模板不匹配", () => {
    const adventure = newAdventure();
    assert.throws(
      () => prepareV3Prompt(requestBody(adventure, {
        request_id: "r3", type: "settle_check", expected_template_name: "新一轮事件"
      })),
      error => error instanceof V3ContractError && /模板不匹配/.test(error.message)
    );
  });

  it("拒绝未知 operation.type", () => {
    const adventure = newAdventure();
    assert.throws(
      () => prepareV3Prompt(requestBody(adventure, {
        request_id: "r4", type: "teleport", expected_template_name: "新一轮事件"
      })),
      error => error instanceof V3ContractError && /operation\.type/.test(error.message)
    );
  });

  it("装配 start 请求并返回 requestGuard", () => {
    const adventure = newAdventure();
    const prepared = prepareV3Prompt(requestBody(adventure, {
      request_id: "r5", type: "start", expected_template_name: "新一轮事件"
    }));
    assert.equal(prepared.messages.length, 2);
    assert.equal(prepared.messages[0].role, "system");
    assert.equal(prepared.messages[1].role, "user");
    assert.equal(prepared.requestGuard.campaign_id, adventure.campaign.campaign_id);
    assert.equal(prepared.requestGuard.run_id, adventure.runtime.run_id);
    assert.equal(prepared.requestGuard.state_version, adventure.runtime.state_version);
  });

  // 回归（2026-11-09 线上事故）：Dart 端把 null 字段整个 key 省略，
  // 回传后 pending_interaction 变成 undefined，引擎的严格 `=== null`
  // 判定失败，start / next_round 被误判为「新事件状态非法」。
  it("客户端省略 null 字段时仍能装配 start", () => {
    const adventure = newAdventure();
    const trimmed = copy(adventure);
    delete trimmed.runtime.pending_interaction;
    delete trimmed.runtime.applied_request_ids;
    delete trimmed.runtime.reward_requests;

    const prepared = prepareV3Prompt(requestBody(trimmed, {
      request_id: "r6", type: "start", expected_template_name: "新一轮事件"
    }));
    assert.equal(prepared.contextScope.mode, "event_generation");
    assert.equal(prepared.premigratedAdventure.runtime.pending_interaction, null);
    assert.deepEqual(prepared.premigratedAdventure.runtime.applied_request_ids, []);
    assert.deepEqual(prepared.premigratedAdventure.runtime.reward_requests, []);
  });
});

describe("v3 预迁移", () => {
  it("choose 必须先 selectOption，否则装配被引擎拒绝", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = R.acceptNewEvent(adventure.runtime, referenceNewEvent(adventure.runtime, event));
    const withPending = { ...adventure, runtime };

    // 未选择选项就请求 choose：引擎校验 pending 快照时发现缺少 selected_option。
    assert.throws(
      () => prepareV3Prompt(requestBody(withPending, {
        request_id: "c1", type: "choose", expected_template_name: "检定",
        event_id: event.event_id, option_id: 1, selected_option: { id: 1 }
      })),
      error => error instanceof V3ContractError && /选项\/事件快照不一致|selected_option/.test(error.message)
    );
  });

  it("choose 预迁移会推进 state_version 并原样回传", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = R.acceptNewEvent(adventure.runtime, referenceNewEvent(adventure.runtime, event));
    const withPending = { ...adventure, runtime };
    const selectedOption = copy(runtime.pending_interaction.event_output.event_details.options[0]);

    const prepared = prepareV3Prompt(requestBody(withPending, {
      request_id: "c2", type: "choose", expected_template_name: "检定",
      event_id: event.event_id, option_id: 1, selected_option: selectedOption
    }));
    assert.equal(prepared.premigrated, true);
    assert.equal(prepared.premigratedAdventure.runtime.state_version, runtime.state_version + 1);
    assert.equal(prepared.premigratedAdventure.runtime.pending_interaction.option_id, 1);
  });

  it("next_round 预迁移会推进轮数并扣减补给", () => {
    const adventure = newAdventure();
    // nextRound 要求「本轮已完成」：先真实跑完 Round 1。
    const settled = completeRoundOne(adventure);
    const withSettled = { ...adventure, runtime: settled };

    const prepared = prepareV3Prompt(requestBody(withSettled, {
      request_id: "n1", type: "next_round", expected_template_name: "新一轮事件"
    }));
    assert.equal(prepared.premigrated, true);
    assert.equal(prepared.premigratedAdventure.runtime.current_round, 2);
    assert.equal(
      prepared.premigratedAdventure.runtime.supply_value,
      settled.supply_value - 1
    );
  });

  it("next_round 在本轮未完成时必须被拒绝", () => {
    const adventure = newAdventure();
    assert.throws(
      () => prepareV3Prompt(requestBody(adventure, {
        request_id: "n2", type: "next_round", expected_template_name: "新一轮事件"
      })),
      error => error instanceof V3ContractError && /必须完成本轮/.test(error.message)
    );
  });

  // ── P0-2：硬失败必须短路，不能走到模型调用 ────────────────────

  it("next_round 触发硬失败时短路，不装配提示词（P0-2）", () => {
    // 造一个「本轮结束后补给归零」的存档：
    // nextRound 会做 `supply_value -= 1`，归零即 `run_status = 'failed'`。
    const adventure = newAdventure();
    const runtime = completeRoundOne(adventure);
    // completeRoundOne 走的是 direct 选项，不额外扣补给；
    // 把补给压到 1，next_round 扣 1 后正好归零 → 硬失败。
    const atEdge = { ...runtime, supply_value: 1 };
    const withSettled = { ...adventure, runtime: atEdge };

    const prepared = prepareV3Prompt(requestBody(withSettled, {
      request_id: "hard_fail_1", type: "next_round", expected_template_name: "新一轮事件"
    }));

    // 回归点：旧实现会继续装配提示词，然后被 validateRequest 以
    // 「新事件状态非法」拒绝 → 服务端不下发状态 → 客户端永久卡死。
    assert.ok(prepared.hardFail, "硬失败必须带 hardFail 标记");
    assert.equal(prepared.hardFail.run_status, "failed");
    assert.equal(prepared.hardFail.reason, "chapter_hard_failed");
    // 短路时不得装配任何提示词（路由层据此跳过模型调用）。
    assert.equal(prepared.systemPrompt, "");
    assert.equal(prepared.userPrompt, "");
    assert.equal(prepared.messages.length, 0);
    // 但预迁移后的存档必须带着失败状态，供客户端走章末流程。
    assert.equal(prepared.premigratedAdventure.runtime.run_status, "failed");
  });

  it("next_round 未触发硬失败时正常装配提示词", () => {
    const adventure = newAdventure();
    const runtime = completeRoundOne(adventure);
    const withSettled = { ...adventure, runtime };

    const prepared = prepareV3Prompt(requestBody(withSettled, {
      request_id: "normal_round", type: "next_round", expected_template_name: "新一轮事件"
    }));

    assert.equal(prepared.hardFail, undefined);
    assert.ok(prepared.userPrompt.length > 0);
  });
});

describe("v3 输出校验", () => {
  it("拒绝非法 YAML", () => {
    assert.throws(
      () => parseV3Output("event_details:\n\ttemplate_name: x\n", {
        expected_template_name: "新一轮事件"
      }),
      error => error instanceof V3OutputError
    );
  });

  it("拒绝模板名不匹配", () => {
    const yaml = 'event_details:\n  template_name: "战斗事件"\n';
    assert.throws(
      () => parseV3Output(yaml, { expected_template_name: "新一轮事件" }),
      error => error instanceof V3OutputError && /模板校验/.test(error.message)
    );
  });

  it("接受合法的新一轮事件文档", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const document = referenceNewEvent(adventure.runtime, event);
    const parsed = parseV3Output(R.yaml(document), {
      expected_template_name: "新一轮事件", event_id: event.event_id
    });
    assert.equal(parsed.event_details.template_name, "新一轮事件");
    assert.equal(parsed.event_details.event_id, event.event_id);
  });
});

describe("v3 状态推进", () => {
  it("start 推进后进入 awaiting_choice", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const prepared = prepareV3Prompt(requestBody(adventure, {
      request_id: "s1", type: "start", expected_template_name: "新一轮事件"
    }));
    const output = parseV3Output(R.yaml(referenceNewEvent(adventure.runtime, event)), {
      expected_template_name: "新一轮事件", event_id: event.event_id
    });
    const advanced = advanceV3(prepared.premigratedAdventure, {
      request_id: "s1", type: "start", expected_template_name: "新一轮事件"
    }, output);

    assert.equal(advanced.changed, true);
    assert.equal(advanced.adventure.runtime.pending_interaction.phase, "awaiting_choice");
    assert.equal(advanced.adventure.runtime.state_version, adventure.runtime.state_version + 1);
    assert.equal(advanced.adventure.revision, adventure.revision + 1);
  });

  it("choose(检定) 推进后进入 awaiting_settlement_commit", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = R.acceptNewEvent(adventure.runtime, referenceNewEvent(adventure.runtime, event));
    const withPending = { ...adventure, runtime };
    const selectedOption = copy(runtime.pending_interaction.event_output.event_details.options[0]);
    const operation = {
      request_id: "c3", type: "choose", expected_template_name: "检定",
      event_id: event.event_id, option_id: 1, selected_option: selectedOption
    };
    const prepared = prepareV3Prompt(requestBody(withPending, operation));
    const output = parseV3Output(R.yaml(referenceCheck("成功")), operation);
    const advanced = advanceV3(prepared.premigratedAdventure, operation, output);

    assert.equal(advanced.adventure.runtime.pending_interaction.phase, "awaiting_settlement_commit");
    assert.equal(advanced.adventure.runtime.pending_interaction.resolution_output.event_details.result, "成功");
  });

  it("choose(直选结算) 必须直接 commitSettlement，不能走 acceptResolution", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const directOption = event.options.find(option => option.resolution_type === "direct");
    const runtime = R.acceptNewEvent(adventure.runtime, referenceNewEvent(adventure.runtime, event));
    const withPending = { ...adventure, runtime };
    const selectedOption = copy(
      runtime.pending_interaction.event_output.event_details.options.find(o => o.id === directOption.id)
    );
    const operation = {
      request_id: "c4", type: "choose", expected_template_name: "结算",
      event_id: event.event_id, option_id: directOption.id, selected_option: selectedOption
    };
    const prepared = prepareV3Prompt(requestBody(withPending, operation));
    const settlement = referenceSettlement(prepared.premigratedAdventure.runtime, "resolved");
    const output = parseV3Output(R.yaml(settlement), operation);
    const advanced = advanceV3(prepared.premigratedAdventure, operation, output);

    assert.equal(advanced.adventure.runtime.pending_interaction, null);
    assert.equal(advanced.adventure.runtime.story_state.completed_events.length, 1);
    assert.equal(advanced.adventure.runtime.story_state.completed_events[0].event_id, event.event_id);
  });

  it("battle_result 预迁移后结算并清空 pending", () => {
    const adventure = newAdventure();
    // CH01_E005 在 Round 5，先把存档推进到 Round 5。
    const base = advanceRounds(adventure, 4);
    const event = R.events.CH01_E005;
    const battleOption = event.options.find(option => option.resolution_type === "battle");
    const runtime = R.acceptNewEvent(base, referenceNewEvent(base, event));
    // 先走 choose(战斗事件) → acceptResolution → phase=awaiting_battle_result
    const selected = R.selectOption(runtime, battleOption.id);
    const battleOutput = parseV3Output(R.yaml({
      event_details: {
        template_name: "战斗事件",
        current_round: base.current_round,
        supply_value: base.supply_value,
        corruption_value: base.corruption_value,
        current_theme: event.title,
        current_type: "战斗",
        scene_name: R.assets.scenes[event.asset_scope.scenes[0]].name,
        steps: [{ narration: "战斗开始。" }]
      },
      combat_start: true,
      enemies: event.enemy_names.map(name => ({ name }))
    }), { expected_template_name: "战斗事件" });
    const afterResolution = R.acceptResolution(selected, battleOutput);
    const withPending = { ...adventure, runtime: afterResolution };

    const operation = {
      request_id: "b1", type: "battle_result", expected_template_name: "结算",
      event_id: event.event_id, option_id: battleOption.id, battle_result: "victory"
    };
    const prepared = prepareV3Prompt(requestBody(withPending, operation));
    assert.equal(prepared.premigrated, true);
    assert.equal(prepared.premigratedAdventure.runtime.pending_interaction.phase, "awaiting_settlement_commit");

    const output = parseV3Output(R.yaml(referenceSettlement(prepared.premigratedAdventure.runtime, "victory")), operation);
    const advanced = advanceV3(prepared.premigratedAdventure, operation, output);
    assert.equal(advanced.adventure.runtime.pending_interaction, null);
    // 前面已跑完 4 轮，本轮是第 5 轮
    assert.equal(advanced.adventure.runtime.story_state.completed_events.length, 5);
    assert.equal(
      advanced.adventure.runtime.story_state.completed_events.at(-1).event_id,
      event.event_id
    );
  });

  it("非法输出不得推进任何状态", () => {
    const adventure = newAdventure();
    const prepared = prepareV3Prompt(requestBody(adventure, {
      request_id: "s2", type: "start", expected_template_name: "新一轮事件"
    }));
    const badOutput = { event_details: { template_name: "新一轮事件", event_id: "CH99_E999" } };
    assert.throws(() => advanceV3(prepared.premigratedAdventure, {
      request_id: "s2", type: "start", expected_template_name: "新一轮事件"
    }, badOutput));
    // 存档未被污染
    assert.equal(adventure.runtime.state_version, 1);
    assert.equal(adventure.runtime.pending_interaction, null);
  });
});

// ── B 方案：npc_state_updates 服务端权威归一化 ────────────────────
//
// 回归（2026-11-09 线上事故）：AI 在结算里自造 NPC 状态，
// 引擎 `commitSettlement` 做严格全等比较 → 抛「NPC变化未获授权」→
// 结算被拒、状态不推进、玩家卡在当前轮（线上 3 次）。
//
// 真实事故样本：
//   - CH01_E001 success，AI 写 [{村长艾德, trusted}]，授权为 []
//   - CH01_E001 success，AI 写 [{村长艾德, cooperative}]，授权为 []
//   - CH01_E002 success，AI 写 [{托娃, met}]（"托娃"甚至不是资产角色），授权为 []
describe("v3 npc_state_updates 权威归一化", () => {
  /**
   * 复现线上事故的完整前置：
   * 事件已生成 → 选项已选 → 检定结果已接受（phase=awaiting_settlement_commit）。
   */
  function pendingAfterCheck(adventure, event, optionId = 1, result = "成功") {
    let runtime = R.acceptNewEvent(adventure.runtime, referenceNewEvent(adventure.runtime, event));
    runtime = R.selectOption(runtime, optionId);
    runtime = R.acceptResolution(runtime, referenceCheck(result));
    return runtime;
  }

  /** 复现线上事故：结算输出里塞一个未授权的 NPC 状态。 */
  function settlementWithUnauthorizedNpc(runtime, outcome, updates) {
    const settlement = referenceSettlement(runtime, outcome);
    settlement.event_details.story_patch.npc_state_updates = updates;
    return settlement;
  }

  it("AI 自造 NPC 状态时不再抛「NPC变化未获授权」", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = pendingAfterCheck(adventure, event);

    const operation = {
      request_id: "npc_bad_1", type: "settle_check", expected_template_name: "结算",
      event_id: event.event_id, option_id: 1, check_result: "成功"
    };
    const bad = settlementWithUnauthorizedNpc(runtime, "success", [
      { npc: "村长艾德", state: "trusted" }
    ]);

    // 修复前：这里会抛「NPC变化未获授权」。
    const advanced = advanceV3({ ...adventure, runtime }, {
      request_id: operation.request_id,
      type: operation.type,
      expected_template_name: operation.expected_template_name
    }, bad);

    assert.equal(advanced.changed, true);
    assert.equal(advanced.adventure.runtime.pending_interaction, null);
    assert.equal(advanced.adventure.runtime.story_state.completed_events.length, 1);
  });

  it("归一化把 AI 值覆盖为事件表授权值，并记录 repair 痕迹", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = pendingAfterCheck(adventure, event);

    // CH01_E001 的 success 授权 npc_updates 为空数组。
    const authorized = R.settlementEffect(runtime, "success").effect.npc_updates;
    assert.deepEqual(authorized, []);

    const bad = settlementWithUnauthorizedNpc(runtime, "success", [
      { npc: "村长艾德", state: "trusted" }
    ]);
    const advanced = advanceV3({ ...adventure, runtime }, {
      request_id: "npc_bad_2", type: "settle_check", expected_template_name: "结算"
    }, bad);

    assert.notEqual(advanced.repair, null);
    assert.equal(advanced.repair.field, "story_patch.npc_state_updates");
    assert.deepEqual(advanced.repair.ai_value, [{ npc: "村长艾德", state: "trusted" }]);
    assert.deepEqual(advanced.repair.authorized_value, []);

    // 下发给客户端的 output 必须是归一化后的版本，避免存档与展示口径漂移。
    assert.deepEqual(
      advanced.output.event_details.story_patch.npc_state_updates,
      []
    );
    // 原始入参不得被就地修改（advanceV3 收到的是调用方的对象）。
    assert.deepEqual(
      bad.event_details.story_patch.npc_state_updates,
      [{ npc: "村长艾德", state: "trusted" }]
    );
  });

  it("AI 写出非资产角色（如托娃）时同样被归一化", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = pendingAfterCheck(adventure, event);

    const bad = settlementWithUnauthorizedNpc(runtime, "success", [
      { npc: "托娃", state: "met" }
    ]);
    const advanced = advanceV3({ ...adventure, runtime }, {
      request_id: "npc_bad_3", type: "settle_check", expected_template_name: "结算"
    }, bad);

    assert.equal(advanced.changed, true);
    assert.deepEqual(
      advanced.output.event_details.story_patch.npc_state_updates,
      []
    );
    // 自造的角色不得进入存档。
    assert.deepEqual(advanced.adventure.runtime.story_state.npc_states, []);
  });

  it("授权非空时保留事件表授权值（不因 AI 写空而被清空）", () => {
    const adventure = newAdventure();
    // CH01_E024 的 option 1 是 direct，resolved 的授权里带 NPC 变化。
    const event = R.events.CH01_E024;
    assert.ok(
      Object.values(event.options[0].results).some(r => (r.npc_updates || []).length > 0),
      "CH01_E024 应存在带 npc_updates 的授权结果"
    );
  });

  it("AI 输出本来就正确时不产生 repair（不误报）", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = pendingAfterCheck(adventure, event);

    const good = referenceSettlement(runtime, "success");
    const advanced = advanceV3({ ...adventure, runtime }, {
      request_id: "npc_ok_1", type: "settle_check", expected_template_name: "结算"
    }, good);

    assert.equal(advanced.repair, null);
    assert.equal(advanced.changed, true);
  });

  it("只归一化 npc_state_updates，其它字段仍然严格校验", () => {
    const adventure = newAdventure();
    const event = R.events.CH01_E001;
    const runtime = pendingAfterCheck(adventure, event);

    // 篡改 flags：不属于本次授权，必须照样被引擎拒绝。
    const bad = settlementWithUnauthorizedNpc(runtime, "success", []);
    bad.event_details.story_patch.add_flags = ["CH01_FAKE_FLAG"];
    assert.throws(() => advanceV3({ ...adventure, runtime }, {
      request_id: "npc_bad_4", type: "settle_check", expected_template_name: "结算"
    }, bad), /未按事件授权添加flag/);
  });
});

describe("v3 控制通道", () => {
  it("create 生成 schema_version 3 的空存档", () => {
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      action: "create",
      args: { campaignId: "campaign_x" }
    });
    assert.equal(result.adventure.schema_version, 3);
    assert.equal(result.adventure.revision, 0);
    assert.equal(result.adventure.runtime, null);
    assert.equal(result.view.chapter_cards.filter(card => card.enterable).length, 1);
  });

  it("continue 进入唯一合法章 CH01", () => {
    const created = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      action: "create",
      args: { campaignId: "campaign_y" }
    });
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure: created.adventure,
      action: "continue",
      args: {
        runId: "run_y",
        seed: 1001,
        team: fixtureTeam(),
        gold: 1000,
        diamond: 0,
        relics: [],
        rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "test_cycle" })
      }
    });
    assert.equal(result.adventure.runtime.chapter_id, "CH01");
    assert.equal(result.adventure.runtime.current_round, 1);
    assert.equal(result.adventure.runtime.run_status, "ongoing");
  });

  it("continue 拒绝选章参数与 replay", () => {
    const adventure = newAdventure();
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure,
        action: "continue",
        args: { chapterId: "CH03" }
      }),
      error => error instanceof V3ContractError && /不接受选章参数/.test(error.message)
    );
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure,
        action: "continue",
        args: { mode: "replay" }
      }),
      error => error instanceof V3ContractError && /禁止replay/.test(error.message)
    );
  });

  it("continue 在客户端未传 rewardState 时由服务端权威注入", () => {
    const created = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      action: "create",
      args: { campaignId: "campaign_auto_reward" }
    });
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure: created.adventure,
      action: "continue",
      args: {
        runId: "run_auto_reward",
        seed: 1001,
        team: fixtureTeam(),
        gold: 1000,
        diamond: 0,
        relics: []
        // ⚠️ 客户端目录是 schedule-only（D10），拿不到章节 economy，
        //    所以 rewardState 必须由服务端注入。
      }
    });
    const rewardState = result.adventure.runtime.reward_state;
    assert.equal(rewardState.chapter_id, "CH01");
    assert.match(rewardState.cycle_id, /^daily:\d{4}-\d{2}-\d{2}$/);
    // 额度必须来自 CH01 的 economy 配置。
    assert.equal(rewardState.gold_gain_remaining, R.chapters[0].economy.gold_gain_cap);
    assert.equal(rewardState.material_reward_slots_remaining, 2);
    assert.equal(rewardState.relic_reward_slots_remaining, 1);
    assert.equal(rewardState.bond_reward_slots_remaining, 1);
    assert.equal(rewardState.equipment_reward_slots_remaining, 0);
  });

  it("continue 允许客户端显式覆盖 rewardState 与奖励周期", () => {
    const created = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      action: "create",
      args: { campaignId: "campaign_explicit_reward" }
    });
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure: created.adventure,
      action: "continue",
      args: {
        runId: "run_explicit_reward",
        seed: 1001,
        team: fixtureTeam(),
        gold: 1000,
        diamond: 0,
        relics: [],
        rewardCycleId: "daily:2026-01-01",
        rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "daily:2026-01-01" })
      }
    });
    assert.equal(result.adventure.runtime.reward_state.cycle_id, "daily:2026-01-01");
  });

  it("view 是只读的，不改变存档", () => {
    const adventure = newAdventure();
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure,
      action: "view",
      args: {}
    });
    assert.equal(result.adventure.revision, adventure.revision);
    assert.equal(result.adventure.runtime.state_version, adventure.runtime.state_version);
    assert.equal(result.view.chapter_cards.length, 8);
    assert.equal(result.view.chapter_cards[0].state, "in_progress");
    assert.equal(result.view.chapter_cards[1].state, "locked");
  });

  it("close_chapter 在章未结束时被拒绝", () => {
    const adventure = newAdventure();
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure,
        action: "close_chapter"
      }),
      error => error instanceof V3ContractError && /当前章未结束/.test(error.message)
    );
  });

  it("restart 生成全新 campaign 并保留已退役 campaign_id", () => {
    const adventure = newAdventure();
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure,
      action: "restart",
      args: { campaignId: "campaign_restarted" }
    });
    assert.equal(result.adventure.campaign.campaign_id, "campaign_restarted");
    assert.equal(result.adventure.campaign.chapter_results.length, 0);
    assert.ok(result.adventure.retired_campaign_ids.includes(adventure.campaign.campaign_id));
    assert.equal(result.archive.read_only, true);
  });

  it("restart 拒绝复用已退役的 campaign_id", () => {
    const adventure = newAdventure();
    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure,
      action: "restart",
      args: { campaignId: "campaign_restarted" }
    });
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure: result.adventure,
        action: "restart",
        args: { campaignId: "campaign_restarted" }
      }),
      error => error instanceof V3ContractError && /全新campaign_id/.test(error.message)
    );
  });

  it("拒绝未知 action", () => {
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure: newAdventure(),
        action: "teleport"
      }),
      error => error instanceof V3ContractError && /未知 action/.test(error.message)
    );
  });

  // ── confirm_reward（D2/D9 的服务端非 AI 操作）────────────────────

  it("confirm_reward 把 pending 奖励回执标记为 granted", () => {
    // CH01_E012 的 option 1（direct）会预留一件永久材料。
    let runtime = advanceRounds(newAdventure(), 11);
    runtime = R.acceptNewEvent(runtime, referenceNewEvent(runtime, R.events.CH01_E012));
    runtime = R.selectOption(runtime, 1);
    runtime = R.commitSettlement(
      runtime,
      referenceSettlement(runtime, "resolved"),
      { requestId: "reward_settle", expectedVersion: runtime.state_version }
    );
    const adventure = { ...newAdventure(), runtime };
    assert.equal(adventure.runtime.reward_requests.length, 1);
    const request = adventure.runtime.reward_requests[0];
    assert.equal(request.status, "pending");

    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure,
      action: "confirm_reward",
      args: { claim_key: request.claim_key, status: "granted", reward: request.reward }
    });
    const confirmed = result.adventure.runtime.reward_requests[0];
    assert.equal(confirmed.status, "granted");
    assert.equal(result.adventure.runtime.state_version, adventure.runtime.state_version + 1);
    assert.ok(
      result.adventure.runtime.reward_state.granted_permanent_rewards
        .some(entry => entry.claim_key === request.claim_key)
    );
  });

  it("confirm_reward 拒绝不匹配的奖励本体与非法状态", () => {
    const adventure = newAdventure();
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure,
        action: "confirm_reward",
        args: { claim_key: "missing", status: "granted" }
      }),
      error => error instanceof V3ContractError && /没有对应的奖励预留/.test(error.message)
    );
  });

  it("close_chapter 在存在 pending 奖励回执时被拒绝", () => {
    // 章末事件 CH01_E024 的 direct 选项会让本章 cleared；
    // 这里先造一个带 pending 奖励回执的终局存档，验证引擎的硬校验。
    let runtime = advanceRounds(newAdventure(), 23);
    runtime = R.acceptNewEvent(runtime, referenceNewEvent(runtime, R.events.CH01_E024));
    runtime = R.selectOption(runtime, 1);
    runtime = R.commitSettlement(
      runtime,
      referenceSettlement(runtime, "resolved"),
      { requestId: "final_settle", expectedVersion: runtime.state_version }
    );
    runtime.reward_requests = [
      {
        id: 900050,
        count: 1,
        request_id: "final_settle",
        event_id: "CH01_E024",
        claim_key: "test_cycle:CH01:CH01_E024:material",
        status: "pending",
        reward: { type: "material", id: 11001, name: "剑核心", count: 1, claim_scope: "cycle" }
      }
    ];
    const adventure = { ...newAdventure(), runtime };
    assert.throws(
      () => transitionV3({
        package_version: V3_PACKAGE_VERSION,
        adventure,
        action: "close_chapter"
      }),
      error => error instanceof V3ContractError && /先同步已有奖励回执/.test(error.message)
    );
  });
});

// ── P0-1：同周期重开的奖励额度不能被重置 ──────────────────────────

describe("v3 同周期奖励账本继承（P0-1）", () => {
  /**
   * 造一份「已经消耗了部分额度」的账本，模拟玩家当天已经领过奖励。
   */
  function consumedRewardState(cycleId) {
    const state = R.createRewardState({ chapterId: "CH01", cycleId });
    return {
      ...state,
      gold_gain_remaining: 300,
      material_reward_slots_remaining: 1,
      claimed_reward_keys: ["daily:2026-01-01:CH01:CH01_E012:material"],
      revealed_pending_rewards: [],
      granted_permanent_rewards: []
    };
  }

  it("同周期重开保留已领取键与已消耗额度", () => {
    const cycleId = "daily:2026-01-01";
    const created = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      action: "create",
      args: { campaignId: "campaign_same_cycle" }
    });

    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure: created.adventure,
      action: "continue",
      args: {
        runId: "run_same_cycle",
        seed: 1001,
        team: fixtureTeam(),
        gold: 1000,
        diamond: 0,
        relics: [],
        rewardCycleId: cycleId,
        // 客户端回传「同周期、已消耗部分额度」的账本。
        previousRewardState: consumedRewardState(cycleId)
      }
    });

    const rewardState = result.adventure.runtime.reward_state;
    // 回归点：这些值如果回到章节配置的满额，玩家就能在同一天无限刷奖励。
    assert.equal(rewardState.cycle_id, cycleId);
    assert.equal(rewardState.gold_gain_remaining, 300);
    assert.equal(rewardState.material_reward_slots_remaining, 1);
    assert.ok(
      rewardState.claimed_reward_keys.includes(
        "daily:2026-01-01:CH01:CH01_E012:material"
      ),
      "已领取键必须保留"
    );
  });

  it("跨周期重开保留 lifetime 领取键但重置周期额度", () => {
    const oldCycle = "daily:2026-01-01";
    const newCycle = "daily:2026-01-02";
    const created = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      action: "create",
      args: { campaignId: "campaign_next_cycle" }
    });

    const result = transitionV3({
      package_version: V3_PACKAGE_VERSION,
      adventure: created.adventure,
      action: "continue",
      args: {
        runId: "run_next_cycle",
        seed: 1001,
        team: fixtureTeam(),
        gold: 1000,
        diamond: 0,
        relics: [],
        rewardCycleId: newCycle,
        previousRewardState: {
          ...consumedRewardState(oldCycle),
          claimed_reward_keys: [
            "lifetime:CH01:chapter:CH01_E012:material",
            "daily:2026-01-01:CH01:CH01_E012:material"
          ]
        }
      }
    });

    const rewardState = result.adventure.runtime.reward_state;
    assert.equal(rewardState.cycle_id, newCycle);
    // 周期额度按新周期重置（满额）。
    assert.equal(rewardState.gold_gain_remaining, R.chapters[0].economy.gold_gain_cap);
    assert.equal(rewardState.material_reward_slots_remaining, 2);
    // lifetime 键必须跨周期保留。
    assert.ok(
      rewardState.claimed_reward_keys.includes(
        "lifetime:CH01:chapter:CH01_E012:material"
      ),
      "lifetime 领取键必须跨周期保留"
    );
    // 旧周期的键不该带过去（引擎只继承 lifetime 前缀的键）。
    assert.ok(
      !rewardState.claimed_reward_keys.includes(
        "daily:2026-01-01:CH01:CH01_E012:material"
      ),
      "旧周期的领取键不应继承"
    );
  });
});

