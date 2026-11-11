/**
 * 端到端演练：模拟一个「完全不听话」的模型，跑完 v3 的五个模板。
 *
 * 用途：验证「权威填空表 + 服务端归一化」能把垃圾输出救回来，
 * 让玩家不再卡在某个轮次。
 *
 * 用法：node tools/replay_authoritative_flow.mjs
 */
import * as R from "../src/engine/vendor/v3/src/runtime.mjs";
import * as A from "../src/engine/vendor/v3/src/adventure.mjs";
import {
  advanceV3,
  parseV3Output,
  prepareV3Prompt,
  V3_PACKAGE_VERSION
} from "../src/engine/v3_adapter.mjs";

const ATTRS = [
  "strength", "agility", "intelligence", "constitution", "physique", "dexterity",
  "perception", "knowledge", "survival", "social", "authority", "deception"
];

const attributes = Object.fromEntries(ATTRS.map(key => [key, 12]));
const team = ["星穹法师", "熔岩矮人王"].map((name, index) => ({
  instance_id: `i${index}`,
  card_id: `c${index}`,
  name,
  quality: 3,
  profession: "法师",
  gender: "男",
  race: "人族",
  personality: "睿智",
  attributes
}));

let adventure = A.createAdventure("replay_demo");
adventure = A.continueAdventure(adventure, {
  expectedRevision: adventure.revision,
  runId: "replay_run_1",
  seed: 7,
  team,
  gold: 500,
  diamond: 0,
  relics: [],
  rewardState: R.createRewardState({ chapterId: "CH01", cycleId: "replay_cycle" })
});

const body = operation => ({
  package_version: V3_PACKAGE_VERSION,
  adventure,
  operation
});

/** 模型完全不听话的输出：所有机器字段都写错。 */
const GARBAGE = {
  newEvent: `event_details:
  template_name: "新一轮事件"
  event_id: "TOTALLY_WRONG"
  current_round: 999
  supply_value: 999
  corruption_value: 999
  current_theme: "模型自编的主题"
  current_type: "模型自编的类型"
  scene_name: "模型自编的场景"
  steps:
    - narration: "队伍推开门，尘土飞扬。"
    - dialogues:
      - npc: "村长艾德"
        speech: "你们来得正好。"
  options:
    - text: "模型自造的选项"
      id: 1
      template_name: "战斗事件"
      visible: true
      available: true
`,
  check: `event_details:
  template_name: "检定"
  analysis: "模型自己写的检定过程。"
  result: "超级大成功"
`,
  battle: `event_details:
  template_name: "战斗事件"
  current_round: 42
  supply_value: 42
  corruption_value: 42
  current_theme: "模型自编的主题"
  current_type: "模型自编的类型"
  scene_name: "模型自编的场景"
  steps:
    - narration: "史莱姆扑了上来。"
combat_start: true
enemies:
  - name: "模型自造的敌人"
  - name: "另一个自造的敌人"
`,
  settlement: `event_details:
  template_name: "结算"
  event_id: "WRONG_EVENT"
  current_round: 999
  supply_value: -5
  corruption_value: 777
  current_theme: "模型自编的主题"
  current_type: "模型自编的类型"
  scene_name: "模型自编的场景"
  steps:
    - narration: "尘埃落定。"
  summary:
    - summary: "模型编的描述"
    - type: "item"
      id: 123456
      count: 7
  story_patch:
    completed_event_id: "WRONG_EVENT"
    selected_option_id: 99
    outcome: "victory"
    run_archetype: "模型编的"
    run_modifier_ids:
      - "MOD_FAKE"
    add_flags:
      - "FAKE_FLAG"
    remove_flags:
      - "FAKE_FLAG_2"
    route_delta:
      combat: 9
      scheme: 9
      cleanse: 9
    npc_state_updates:
      - npc: "托娃"
        state: "trusted"
    memory_notes:
      - "模型编的记忆"
    unresolved_hooks_added:
      - "模型编的悬念"
    unresolved_hooks_resolved:
      - "根本不存在的悬念"
  final_chapter: true
`
};

function log(step, detail) {
  console.log(`\n[${step}] ${detail}`);
}

// ── 1. start：新一轮事件 ────────────────────────────────
log("1/5", "start → 新一轮事件（模型输出全错）");
let operation = {
  request_id: "replay-1",
  type: "start",
  expected_template_name: "新一轮事件"
};
let prepared = prepareV3Prompt(body(operation));
let output = parseV3Output(GARBAGE.newEvent, operation, prepared.premigratedAdventure.runtime);
console.log("  归一化后 event_id:", output.event_details.event_id);
console.log("  归一化后 快照:", output.event_details.current_round, output.event_details.supply_value, output.event_details.corruption_value);
console.log("  归一化后 选项:", output.event_details.options.map(o => `${o.id}:${o.template_name}`).join(", "));
let advanced = advanceV3(prepared.premigratedAdventure, operation, output);
adventure = advanced.adventure;
console.log("  ✅ 推进成功，pending =", adventure.runtime.pending_interaction.phase);

// ── 2. choose：检定 ────────────────────────────────────
const pending = adventure.runtime.pending_interaction;
const selectedOption = pending.event_output.event_details.options.find(o => o.template_name === "检定");
console.log("\n[2/5] choose → 检定（模型输出全错）");
operation = {
  request_id: "replay-2",
  type: "choose",
  expected_template_name: "检定",
  event_id: pending.event_id,
  option_id: selectedOption.id,
  selected_option: selectedOption
};
prepared = prepareV3Prompt(body(operation));
output = parseV3Output(GARBAGE.check, operation, prepared.premigratedAdventure.runtime);
console.log("  归一化后 result:", output.event_details.result);
console.log("  保留的 analysis:", output.event_details.analysis);
advanced = advanceV3(prepared.premigratedAdventure, operation, output);
adventure = advanced.adventure;
console.log("  ✅ 推进成功，pending =", adventure.runtime.pending_interaction.phase);

// ── 3. settle_check：结算 ──────────────────────────────
console.log("\n[3/5] settle_check → 结算（模型输出全错）");
// ⚠️ check_result 必须与 pending 里的检定输出一致：
//    第 2 步的检定结果被归一化成了「失败」，所以这里必须提交「失败」。
operation = {
  request_id: "replay-3",
  type: "settle_check",
  expected_template_name: "结算",
  event_id: pending.event_id,
  option_id: selectedOption.id,
  check_result: "失败"
};
prepared = prepareV3Prompt(body(operation));
output = parseV3Output(GARBAGE.settlement, operation, prepared.premigratedAdventure.runtime);
console.log("  归一化后 outcome:", output.event_details.story_patch.outcome);
console.log("  归一化后 flags:", JSON.stringify(output.event_details.story_patch.add_flags));
console.log("  归一化后 npc:", JSON.stringify(output.event_details.story_patch.npc_state_updates));
console.log("  归一化后 final_chapter:", output.event_details.final_chapter);
advanced = advanceV3(prepared.premigratedAdventure, operation, output);
adventure = advanced.adventure;
console.log("  ✅ 推进成功，pending =", adventure.runtime.pending_interaction);
console.log("  ✅ 已完成事件:", adventure.runtime.story_state.completed_events.map(e => e.event_id).join(", "));

// ── 4. next_round：新一轮事件（第 2 轮）──────────────────
console.log("\n[4/5] next_round → 新一轮事件（模型输出全错）");
operation = {
  request_id: "replay-4",
  type: "next_round",
  expected_template_name: "新一轮事件"
};
prepared = prepareV3Prompt(body(operation));
output = parseV3Output(GARBAGE.newEvent, operation, prepared.premigratedAdventure.runtime);
console.log("  归一化后 event_id:", output.event_details.event_id);
console.log("  归一化后 快照:", output.event_details.current_round, output.event_details.supply_value, output.event_details.corruption_value);
advanced = advanceV3(prepared.premigratedAdventure, operation, output);
adventure = advanced.adventure;
console.log("  ✅ 推进成功，pending =", adventure.runtime.pending_interaction.phase);

// ── 5. choose：直选结算 ────────────────────────────────
const pending2 = adventure.runtime.pending_interaction;
const directOption = pending2.event_output.event_details.options.find(o => o.template_name === "结算");
console.log("\n[5/5] choose → 结算（直选，模型输出全错）");
operation = {
  request_id: "replay-5",
  type: "choose",
  expected_template_name: "结算",
  event_id: pending2.event_id,
  option_id: directOption.id,
  selected_option: directOption
};
prepared = prepareV3Prompt(body(operation));
output = parseV3Output(GARBAGE.settlement, operation, prepared.premigratedAdventure.runtime);
console.log("  归一化后 outcome:", output.event_details.story_patch.outcome);
advanced = advanceV3(prepared.premigratedAdventure, operation, output);
adventure = advanced.adventure;
console.log("  ✅ 推进成功，pending =", adventure.runtime.pending_interaction);
console.log("  ✅ run_status =", adventure.runtime.run_status);
console.log("  ✅ 已完成事件数 =", adventure.runtime.story_state.completed_events.length);

console.log("\n=== 全流程通过：完全不听话的模型也没有卡住任何一轮 ===");
