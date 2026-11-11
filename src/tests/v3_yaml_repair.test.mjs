import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairBareEmptyListKeys, parseV3Output } from "../engine/v3_adapter.mjs";
import { parseRestrictedYaml } from "../engine/vendor/v3/parser/adventure_yaml_stream_parser.mjs";

/**
 * 回归测试：裸键空集合导致整份 AI 输出被丢弃。
 *
 * ⚠️ 背景（2026-11-09 线上事故，Round 24 `choose` 结算）：
 *    模型把空列表写成裸键：
 *        remove_flags:
 *        unresolved_hooks_added:
 *    受限 YAML 子集里，键后面既没有值、也没有缩进子节点时，
 *    `parseRestrictedYaml` 抛 `YAML_CHILD_INDENT`，整份输出被丢弃。
 *    而权威归一化发生在解析**之后**，根本没有机会救回来。
 */

describe("裸键空集合修复", () => {
  it("把白名单里的裸键补成内联 []", () => {
    const yaml = [
      "event_details:",
      "  template_name: \"结算\"",
      "  story_patch:",
      "    add_flags:",
      "      - \"VILLAGE_SAVED\"",
      "    remove_flags:",
      "    route_delta:",
      "      combat: 0",
      "    unresolved_hooks_added:",
      "    unresolved_hooks_resolved:",
      "      - \"某个悬念\""
    ].join("\n");

    const repaired = repairBareEmptyListKeys(yaml);
    // ⚠️ add_flags 下面本来就有子节点，不属于空集合，**不会**被改。
    assert.deepEqual(repaired.repaired.sort(), [
      "remove_flags",
      "unresolved_hooks_added"
    ]);
    assert.match(repaired.yaml, /add_flags:\n {6}- "VILLAGE_SAVED"/);
    assert.match(repaired.yaml, /remove_flags: \[\]/);
    assert.match(repaired.yaml, /unresolved_hooks_added: \[\]/);
  });

  it("非白名单的裸键不动（不掩盖真实缺陷）", () => {
    const yaml = ["event_details:", "  template_name: \"结算\"", "  未知字段:"].join("\n");
    const repaired = repairBareEmptyListKeys(yaml);
    assert.deepEqual(repaired.repaired, []);
    assert.match(repaired.yaml, /未知字段:$/m);
  });

  it("本来就有子节点的键不被误改", () => {
    const yaml = [
      "event_details:",
      "  story_patch:",
      "    remove_flags:",
      "      - \"OLD_FLAG\""
    ].join("\n");
    const repaired = repairBareEmptyListKeys(yaml);
    assert.deepEqual(repaired.repaired, []);
    assert.match(repaired.yaml, /remove_flags:\n {6}- "OLD_FLAG"/);
  });

  it("已有内联 [] 的键保持原样", () => {
    const yaml = ["event_details:", "  story_patch:", "    remove_flags: []"].join("\n");
    const repaired = repairBareEmptyListKeys(yaml);
    assert.deepEqual(repaired.repaired, []);
    assert.match(repaired.yaml, /remove_flags: \[\]/);
  });

  it("线上事故样本：修复后能被正常解析并通过模板校验", () => {
    // 取自线上 trace `choose-69-118` 的真实模型输出（去掉超长叙事后保留结构）。
    const yaml = [
      'event_details:',
      '  template_name: "结算"',
      '  event_id: "CH01_E024"',
      '  current_round: 24',
      '  supply_value: 89',
      '  corruption_value: 13',
      '  current_theme: "村庄的清晨"',
      '  current_type: "主线事件结算"',
      '  scene_name: "艾德村庄"',
      '  steps:',
      '    - narration: "村民们在掩护下撤向村口高地。"',
      '  summary:',
      '    - summary: "守住撤离通道。"',
      '  story_patch:',
      '    completed_event_id: "CH01_E024"',
      '    selected_option_id: 1',
      '    outcome: "resolved"',
      '    run_archetype: "underworld"',
      '    run_modifier_ids:',
      '      - "MOD_GHOST_TIDE"',
      '      - "MOD_FRACTURED_TRUST"',
      '    add_flags:',
      '      - "VILLAGE_SAVED"',
      '    remove_flags:',
      '    route_delta:',
      '      combat: 0',
      '      scheme: 1',
      '      cleanse: 0',
      '    npc_state_updates:',
      '      - npc: "村长艾德"',
      '        state: "cooperative"',
      '    memory_notes:',
      '      - "村庄保全"',
      '    unresolved_hooks_added:',
      '    unresolved_hooks_resolved:',
      '      - "旧井窖通道是谁挖通"',
      '  final_chapter: true'
    ].join("\n");

    const operation = {
      request_id: "choose-69-118",
      type: "choose",
      expected_template_name: "结算",
      event_id: "CH01_E024"
    };

    // 修复前：受限 YAML 解析器直接抛 YAML_CHILD_INDENT。
    assert.throws(
      () => parseRestrictedYaml(yaml),
      (error) => error.code === "YAML_CHILD_INDENT"
    );

    // 修复后：正常解析并通过五模板校验。
    const parsed = parseV3Output(yaml, operation, null);
    const patch = parsed.event_details.story_patch;
    assert.deepEqual(patch.remove_flags, []);
    assert.deepEqual(patch.unresolved_hooks_added, []);
    assert.deepEqual(patch.add_flags, ["VILLAGE_SAVED"]);
    assert.deepEqual(patch.unresolved_hooks_resolved, ["旧井窖通道是谁挖通"]);
  });

  it("修复信息会写进错误的 details 里（便于服务端排查）", () => {
    const yaml = [
      'event_details:',
      '  template_name: "结算"',
      '  event_id: "X"',
      '  story_patch:',
      '    未知键:'
    ].join("\n");
    try {
      parseV3Output(yaml, {
        request_id: "r", type: "choose", expected_template_name: "结算"
      }, null);
      assert.fail("应当抛出 V3OutputError");
    } catch (error) {
      assert.equal(error.code, "V3_OUTPUT_INVALID");
      assert.equal(error.details.stage, "yaml_parse");
    }
  });
});
