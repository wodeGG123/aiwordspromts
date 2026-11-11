#!/usr/bin/env node
/**
 * A 方案：收紧 v3 提示词里关于 `npc_state_updates` 的表述。
 *
 * ⚠️ 背景（2026-11-09 线上事故）：
 *    结算提交时引擎做严格全等比较
 *    （runtime.mjs: `JSON.stringify(patch.npc_state_updates) === JSON.stringify(fx.npc_updates)`），
 *    提示词却同时教 AI「关系阶梯」「移动一级」「失败但继续可以留 npc_state_updates 后果」，
 *    结算模板示例本身还写了一个非空 NPC 变更。
 *    结果：全库 1747 个 result 里 1717 个授权为空，AI 却几乎必然写出非空数组，
 *    结算被拒 → 状态不推进 → 玩家卡在当前轮（线上 3 次 `NPC变化未获授权`）。
 *
 * 本脚本改的是提示词的**源头**：v3 数据包的 `src/prompts.mjs`。
 * 数据包目录不进版本库（.gitignore），所以脚本放在这里便于复现与审计；
 * 改完依次执行：
 *   node tools/fix_npc_updates_prompt.mjs     # 改数据包 src/prompts.mjs
 *   node 猎魔人世界_.../tools/rebuild.mjs      # 重新生成 01_共享积木/*.txt
 *   node tools/sync_v3.mjs                     # 同步到 src/engine/vendor/v3/
 *
 * ⚠️ 已经执行过一次后再执行会因「源文本与预期不符」而中止（幂等保护）。
 *    需要改别的措辞时，直接改数据包里的 src/prompts.mjs 更合适。
 *
 * 用法：node tools/fix_npc_updates_prompt.mjs [--check]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "猎魔人世界_八章完整交互包_20261101_v3");
const promptsPath = path.join(packageDir, "src/prompts.mjs");

/** A1：共享契约段（5 个模板各一处）——把「逐字采用」升级为可执行的空数组规则。 */
const A1_OLD = "npc_state_updates必须逐字采用结果npc_updates。";
const A1_NEW =
  "npc_state_updates必须逐字采用结果npc_updates（settlement_preview或effective_event_options中对应outcome的数组，条目顺序、npc名称与state全部照抄）；" +
  "该授权数组为空时必须输出npc_state_updates: []，即使剧情中出现了某个NPC、发生了救援或关系改善，也不得依据剧情自行新增或推断任何NPC状态。";

/** A2：结算模板规则段——删掉「关系阶梯/移动一级」这类引导 AI 自行推导关系的措辞。 */
const A2_OLD =
  "##npc_state_updates.state只允许met、trusted、cooperative、neutral、wary、hostile、departed、dead，并表示结算后的绝对状态。同一NPC每次结算最多出现一次。" +
  "关系阶梯为hostile→wary→neutral→cooperative→trusted；met只表示见过，进行“改善/恶化一级”时按neutral作为关系起点；" +
  "departed与dead为存在终态，普通关系变化不得改变或恢复。副本只写“改善/恶化一级”时沿关系阶梯移动一级；明确指定结果时可直达目标。只有真实改变才输出。";
const A2_NEW =
  "##npc_state_updates是结果授权字段，不是叙事自由字段。取值必须逐字复制settlement_preview中当前outcome对应结果的npc_updates数组：" +
  "授权为空数组时输出npc_state_updates: []；授权非空时逐条复制，条目格式为npc与state两个键、npc写角色资产名、state写关系状态。" +
  "授权里没有的NPC、状态或条目一律不得出现，也不得因为剧情里发生了救援、争执或关系改善而自行补写。" +
  "state只允许met、trusted、cooperative、neutral、wary、hostile、departed、dead。同一NPC每次结算最多出现一次。" +
  "departed与dead为存在终态，普通关系变化不得改变或恢复。";

/** A3：失败但继续段——把 npc_state_updates 从「可自由使用的后果载体」里摘掉。 */
const A3_OLD =
  "##失败但继续时，至少通过add_flags、npc_state_updates、summary资源变化或关闭独特奖励留下一个可被后续读取的真实后果；不得只写气氛性受伤。";
const A3_NEW =
  "##失败但继续时，至少通过add_flags、summary资源变化或关闭独特奖励留下一个可被后续读取的真实后果；不得只写气氛性受伤。" +
  "npc_state_updates不是可以自由使用的后果载体，只有本次结果授权非空时才按授权复制，不得为了留下后果而自造NPC状态。";

/** A4：结算模板示例——把非空示例改为空数组（98% 的结果授权为空）。 */
const A4_OLD = String.raw`    npc_state_updates:\n      - npc: \"村长艾德\"\n        state: \"trusted\"\n`;
const A4_NEW = String.raw`    npc_state_updates: []\n`;

const EDITS = [
  { key: "A1 共享契约段", old: A1_OLD, new: A1_NEW, expect: 5 },
  { key: "A2 结算模板规则段", old: A2_OLD, new: A2_NEW, expect: 1 },
  { key: "A3 失败但继续段", old: A3_OLD, new: A3_NEW, expect: 1 },
  { key: "A4 结算模板示例", old: A4_OLD, new: A4_NEW, expect: 1 }
];

async function main() {
  const checkOnly = process.argv.includes("--check");
  let source;
  try {
    source = await readFile(promptsPath, "utf8");
  } catch {
    console.error(
      `[fix:npc] 找不到数据包目录：${packageDir}\n` +
      "        数据包本体不进版本库，需要时把 v3 数据包放回该目录再执行。"
    );
    process.exit(1);
  }

  const counts = EDITS.map(edit => ({
    key: edit.key,
    old: edit.old,
    new: edit.new,
    count: source.split(edit.old).length - 1,
    expect: edit.expect,
    alreadyApplied: source.includes(edit.new)
  }));

  // 幂等：已应用过的改动，其旧文本命中数应为 0。
  const pending = counts.filter(entry => entry.count > 0);
  const applied = counts.filter(entry => entry.count === 0 && entry.alreadyApplied);

  for (const entry of counts) {
    const status = entry.count === entry.expect
      ? "PENDING"
      : entry.count === 0 && entry.alreadyApplied
        ? "APPLIED"
        : "MISMATCH";
    console.log(`[fix:npc] ${entry.key} 命中 ${entry.count} 次（期望 ${entry.expect}）${status}`);
    if (status === "MISMATCH") {
      console.error("[fix:npc] 源文本与预期不符，未做任何修改。请先核对 prompts.mjs 是否已被改动。");
      process.exit(1);
    }
  }

  if (pending.length === 0) {
    console.log("[fix:npc] 全部改动均已应用，无需重复写入。");
    return;
  }

  if (checkOnly) {
    console.log(`[fix:npc] --check：${pending.length} 处待应用，未写入。`);
    return;
  }

  for (const entry of pending) {
    source = source.split(entry.old).join(entry.new);
  }
  await writeFile(promptsPath, source, "utf8");
  console.log(
    "[fix:npc] 已写入数据包 src/prompts.mjs。接下来依次执行：\n" +
    "        node 猎魔人世界_八章完整交互包_20261101_v3/tools/rebuild.mjs\n" +
    "        node tools/sync_v3.mjs"
  );
}

await main();
