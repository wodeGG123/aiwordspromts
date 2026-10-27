/**
 * 研发包一致性验证。
 *
 * 三件事：
 *   1. 03_完整流程模拟：system prompt 必须能被生产入口 prepareAiMessages 逐字重建；
 *      AI 实际输出必须能被流式解析器解析，并且符合「五模板输出约束」schema。
 *   2. 02_按状态预切片：引擎积木 + 世界规则积木 + 副本积木 + 最终自检积木
 *      必须按拼装顺序拼成完整示例；引擎积木必须带对应模板的输出约束段且不含 demo 实体。
 *   3. 发布清单：每个文件的字节数与 sha256 必须与清单一致。
 *
 * 任何一条不成立都说明「代码与研发包产物已经漂移」，此时研发同学按包接入会拿到过期提示词。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AdventureYamlStreamParser } from "./adventure_yaml_stream_parser.mjs";
import { prepareAiMessages } from "../腐化魔王危机_预切片积木入口_20260904.mjs";
import { validateTemplateOutput, formatValidationErrors } from "./输出约束校验器.mjs";
import { SIMULATION_STEPS, SLICE_TEMPLATES } from "./流程步骤定义_20260904.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 引擎积木里不允许出现的 demo 实体。它们来自旧版「输出格式模板」段落，
// 一旦回到提示词里，AI 就会原样复用示例角色名、示例事件 ID 与示例奖励 ID。
const FORBIDDEN_ENGINE_FRAGMENTS = Object.freeze([
  "村长艾德",
  "星穹法师",
  "熔岩矮人王",
  "花岗岩像鬼",
  "推倒旧货车封住狭巷"
]);

let passCount = 0;

// ── 1. 完整流程模拟 ────────────────────────────────────────────────
for (const step of SIMULATION_STEPS) {
  const dir = path.join(root, "03_完整流程模拟", step.id);
  const systemPrompt = await readFile(path.join(dir, "01_system_prompt_完整.txt"), "utf8");
  const userPrompt = await readFile(path.join(dir, "02_user_prompt_完整.txt"), "utf8");
  const fullPrompt = await readFile(path.join(dir, "03_程序到AI_完整拼接prompt.txt"), "utf8");
  const output = await readFile(path.join(dir, "04_AI到程序_完整输出.yaml"), "utf8");
  assert.equal(systemPrompt + "\n\n" + userPrompt, fullPrompt, step.id + " system/user拼装不一致");
  const runtimeYaml = userPrompt.replace(/^#本次程序运行态输入\n/, "");
  const rebuilt = prepareAiMessages({ ...step.options, runtimeYaml });
  assert.equal(rebuilt.fullPrompt, fullPrompt, step.id + " 无法由生产入口逐字重建");
  const details = /event_id: "(M\d+)"/.exec(output);
  const scene = /scene_name: "([^"]+)"/.exec(output);
  const parser = new AdventureYamlStreamParser({
    expectedTemplateName: step.options.expectedTemplateName,
    expectedEventId: step.options.expectedTemplateName === "结算" ? details?.[1] : undefined,
    expectedSceneName: ["战斗事件", "结算"].includes(step.options.expectedTemplateName) ? scene?.[1] : undefined,
    allowedEventIds: step.options.expectedTemplateName === "新一轮事件" ? step.options.includedEventIds : undefined
  });
  parser.feedTextFrame(output);
  const parsed = parser.finish().value;
  assert.equal(parsed.event_details.template_name, step.options.expectedTemplateName);

  // 结构契约：AI 实际输出必须符合同一份「五模板输出约束」schema。
  // pending 里的 event_id / scene_name 是程序锁定的值，AI 必须逐字复制。
  const pendingEventId = /pending_interaction:\n(?:.*\n)*?\s+event_id: "([^"]+)"/.exec(userPrompt)?.[1];
  const pendingSceneName = /pending_interaction:\n(?:.*\n)*?\s+scene_name: "([^"]+)"/.exec(userPrompt)?.[1];
  const validation = validateTemplateOutput(parsed, {
    expectedTemplateName: step.options.expectedTemplateName,
    expectedEventId: step.options.expectedTemplateName === "结算" ? pendingEventId : undefined,
    expectedSceneName: ["战斗事件", "结算"].includes(step.options.expectedTemplateName) ? pendingSceneName : undefined,
    flags: { gold_policy_enabled: false, diamond_policy_enabled: false }
  });
  assert.equal(validation.ok, true,
    step.id + " 的 AI 输出不符合五模板输出约束：\n" + formatValidationErrors(validation));
  passCount += 4;
}

assert.match(await readFile(path.join(root, "03_完整流程模拟", "02_选择检定_choose", "02_user_prompt_完整.txt"), "utf8"), /event_output:\n    event_details:/);
passCount += 1;
const chooseCheckInput = await readFile(path.join(root, "03_完整流程模拟", "02_选择检定_choose", "02_user_prompt_完整.txt"), "utf8");
assert.match(chooseCheckInput, /\ncheck_seed: 1001\ncurrent_round:/, "check_seed必须位于runtime顶层");
assert.doesNotMatch(chooseCheckInput, /operation:\n(?:  .*\n)*  check_seed:/, "check_seed不得嵌套在operation内");
passCount += 2;
const checkSettlementInput = await readFile(path.join(root, "03_完整流程模拟", "03_检定后结算_settle_check", "02_user_prompt_完整.txt"), "utf8");
assert.match(checkSettlementInput, /resolution_output:\n    event_details:\n      template_name: "检定"/, "settle_check缺少完整检定输出");
passCount += 1;
const battleSettlementInput = await readFile(path.join(root, "03_完整流程模拟", "06_战斗后结算_battle_result", "02_user_prompt_完整.txt"), "utf8");
assert.match(battleSettlementInput, /resolution_output:\n    event_details:\n      template_name: "战斗事件"/, "battle_result缺少完整战斗输出");
passCount += 1;

// ── 2. 按状态预切片 ────────────────────────────────────────────────
for (const slice of SLICE_TEMPLATES) {
  const dir = path.join(root, "02_按状态预切片", slice.folder);
  const engineBrick = await readFile(path.join(dir, "01_引擎积木.txt"), "utf8");
  const dungeonBrick = await readFile(path.join(dir, "02_副本积木.txt"), "utf8");
  const recipe = JSON.parse(await readFile(path.join(dir, "03_拼装清单.json"), "utf8"));
  const worldBrick = await readFile(path.resolve(dir, recipe.shared_files[0]), "utf8");
  const finalCheckBrick = await readFile(path.resolve(dir, recipe.shared_files[1]), "utf8");
  const assembledExample = await readFile(path.join(dir, "04_system_prompt_完整拼装示例.txt"), "utf8");
  assert.equal([engineBrick, worldBrick, dungeonBrick, finalCheckBrick].join("\n\n"), assembledExample, slice.folder + " 积木路径或拼装顺序错误");
  assert.ok(engineBrick.includes(`#输出约束：${slice.templateName}`),
    slice.folder + " 引擎积木缺少「输出约束：" + slice.templateName + "」段");
  for (const fragment of FORBIDDEN_ENGINE_FRAGMENTS) {
    assert.ok(!engineBrick.includes(fragment), slice.folder + " 引擎积木仍含 demo 实体：" + fragment);
  }
  passCount += 3;
}

// ── 3. 发布清单 ────────────────────────────────────────────────────
const manifest = JSON.parse(await readFile(path.join(root, "发布清单_20260904.json"), "utf8"));
for (const entry of manifest.files) {
  const bytes = await readFile(path.join(root, ...entry.path.split("/")));
  assert.equal(bytes.length, entry.bytes, entry.path + " 字节数与发布清单不一致");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path + " 哈希与发布清单不一致");
  passCount += 1;
}

process.stdout.write(JSON.stringify({
  ok: true,
  step_count: SIMULATION_STEPS.length,
  slice_count: SLICE_TEMPLATES.length,
  pass_count: passCount
}, null, 2) + "\n");
