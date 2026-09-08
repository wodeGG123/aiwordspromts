import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AdventureYamlStreamParser } from "./adventure_yaml_stream_parser.mjs";
import { prepareAiMessages } from "../腐化魔王危机_预切片积木入口_20260904.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const steps = [{"id":"01_开局_start","options":{"operationType":"start","expectedTemplateName":"新一轮事件","currentRound":1,"currentSceneId":"scene_village","completedEvents":[],"forcedEventId":"M01","includedEventIds":["M01"]}},{"id":"02_选择检定_choose","options":{"operationType":"choose","expectedTemplateName":"检定","activeEventId":"M01"}},{"id":"03_检定后结算_settle_check","options":{"operationType":"settle_check","expectedTemplateName":"结算","activeEventId":"M01"}},{"id":"04_新一轮_next_round","options":{"operationType":"next_round","expectedTemplateName":"新一轮事件","currentRound":24,"currentSceneId":"scene_castle","completedEvents":["M01","M02","M03","M04","M05"],"forcedEventId":"M06","includedEventIds":["M06"]}},{"id":"05_选择战斗_choose","options":{"operationType":"choose","expectedTemplateName":"战斗事件","activeEventId":"M06"}},{"id":"06_战斗后结算_battle_result","options":{"operationType":"battle_result","expectedTemplateName":"结算","activeEventId":"M06"}},{"id":"07_终章_finale","options":{"operationType":"finale","expectedTemplateName":"终章"}}];
let passCount = 0;
for (const step of steps) {
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
  passCount += 3;
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
for (const folder of ["01_开局_start","02_新一轮_next_round","03_选择检定_choose","04_检定后结算_settle_check","05_选择战斗_choose","06_战斗后结算_battle_result","07_选择直接结算_choose_direct","08_终章_finale"]) {
  const dir = path.join(root, "02_按状态预切片", folder);
  const engineBrick = await readFile(path.join(dir, "01_引擎积木.txt"), "utf8");
  const dungeonBrick = await readFile(path.join(dir, "02_副本积木.txt"), "utf8");
  const recipe = JSON.parse(await readFile(path.join(dir, "03_拼装清单.json"), "utf8"));
  const worldBrick = await readFile(path.resolve(dir, recipe.shared_files[0]), "utf8");
  const finalCheckBrick = await readFile(path.resolve(dir, recipe.shared_files[1]), "utf8");
  const assembledExample = await readFile(path.join(dir, "04_system_prompt_完整拼装示例.txt"), "utf8");
  assert.equal([engineBrick, worldBrick, dungeonBrick, finalCheckBrick].join("\n\n"), assembledExample, folder + " 积木路径或拼装顺序错误");
  passCount += 1;
}
const manifest = JSON.parse(await readFile(path.join(root, "发布清单_20260904.json"), "utf8"));
for (const entry of manifest.files) {
  const bytes = await readFile(path.join(root, ...entry.path.split("/")));
  assert.equal(bytes.length, entry.bytes, entry.path + " 字节数与发布清单不一致");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path + " 哈希与发布清单不一致");
  passCount += 1;
}
process.stdout.write(JSON.stringify({ ok: true, step_count: steps.length, pass_count: passCount }, null, 2) + "\n");
