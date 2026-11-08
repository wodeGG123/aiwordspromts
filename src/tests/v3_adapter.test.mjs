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
});
