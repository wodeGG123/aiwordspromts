#!/usr/bin/env node
/**
 * 事故重放：用 logs/ai-trace 里的**真实失败输出**验证 A+B 修复是否生效。
 *
 * ⚠️ 背景（2026-11-09 线上事故）：
 *    3 次 settle_check 因「NPC变化未获授权」被拒，状态不推进，玩家卡在当前轮。
 *    本脚本读取真实 trace，把当时的 AI 输出原样喂给修复后的 advanceV3，
 *    确认结算能提交、状态能推进。
 *
 * 用法：node tools/replay_npc_incident.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRestrictedYaml } from "../src/engine/vendor/v3/parser/adventure_yaml_stream_parser.mjs";
import { advanceV3 } from "../src/engine/v3_adapter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const traceDir = path.join(root, "logs/ai-trace");

const files = (await readdir(traceDir)).filter(name => name.endsWith(".json")).sort();
const targets = [];

for (const name of files) {
  const trace = JSON.parse(await readFile(path.join(traceDir, name), "utf8"));
  if (trace.error?.message !== "NPC变化未获授权") continue;
  targets.push({ name, trace });
}

if (targets.length === 0) {
  console.log("[replay] 没有找到「NPC变化未获授权」的真实 trace（可能已被清理）。");
  process.exit(0);
}

console.log(`[replay] 找到 ${targets.length} 条事故 trace。\n`);

let failed = 0;
for (const { name, trace } of targets) {
  const raw = trace.ai_response?.output;
  if (!raw) {
    console.log(`✖ ${name}\n  缺少 AI 输出，跳过。`);
    failed += 1;
    continue;
  }

  // 复现当次请求的 runtime：从 trace 的 user prompt 里取回程序运行态输入。
  const userPrompt = trace.ai_request.messages.find(m => m.role === "user")?.content ?? "";
  const yamlBody = userPrompt.replace(/^#本次程序运行态输入\n/, "");
  const runtime = parseRestrictedYaml(yamlBody);

  // 复现 operation：trace 只记了 operation 类型，事件/选项从 pending 快照取。
  const pending = runtime.pending_interaction;
  const operation = {
    request_id: `replay_${name}`,
    type: trace.operation,
    expected_template_name: "结算",
    event_id: pending.event_id,
    option_id: pending.option_id
  };

  // 复现 premigrated：settle_check 不做预迁移，直接用 trace 里的 runtime。
  // ⚠️ trace 的 user prompt 是**裁剪后**的运行态输入（引擎在装配时会删掉
  //    applied_request_ids / reward_requests / chapter_journal 等内部字段），
  //    这里必须补齐，否则 commitSettlement 会读不到幂等键表。
  runtime.applied_request_ids ??= [];
  runtime.reward_requests ??= [];
  const adventure = {
    schema_version: 3,
    revision: 0,
    campaign: runtime.world_story_state,
    runtime
  };

  try {
    const output = parseRestrictedYaml(raw);
    const advanced = advanceV3(adventure, operation, output);
    const committed = advanced.adventure.runtime.story_state.completed_events;
    console.log(`✔ ${name}`);
    console.log(`  事件 ${pending.event_id} / 选项 ${pending.option_id} → 结算已提交`);
    console.log(`  completed_events = ${committed.length}，run_status = ${advanced.adventure.runtime.run_status}`);
    if (advanced.repair) {
      console.log(`  已归一化 npc_state_updates：`);
      console.log(`    AI 写入：${JSON.stringify(advanced.repair.ai_value)}`);
      console.log(`    授权值：${JSON.stringify(advanced.repair.authorized_value)}`);
    } else {
      console.log("  未触发归一化（AI 输出本已符合授权）。");
    }
  } catch (error) {
    failed += 1;
    console.log(`✖ ${name}`);
    console.log(`  仍然失败：${error.message}`);
  }
  console.log();
}

if (failed > 0) {
  console.error(`[replay] ${failed} 条 trace 仍然失败。`);
  process.exit(1);
}
console.log("[replay] 全部事故 trace 均已成功提交结算。");
