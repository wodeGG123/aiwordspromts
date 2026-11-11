#!/usr/bin/env node
/**
 * A 方案（补）：收紧 v3 提示词里「空数组」必须写成内联 `[]` 的表述。
 *
 * ⚠️ 背景（2026-11-09 线上事故，Round 24 `choose` 结算）：
 *    模型把空列表写成**裸键**：
 *        remove_flags:
 *        unresolved_hooks_added:
 *    受限 YAML 子集（v3 parser）里，键后面既没有值、也没有缩进子节点时，
 *    `parseRestrictedYaml` 直接抛 `YAML_CHILD_INDENT`
 *    （`键remove_flags缺少缩进为6的子节点`），**整份输出被丢弃**。
 *    而权威归一化发生在解析**之后**，根本没有机会救回来；
 *    玩家点「重新获得剧情」也只会再撞一次同样的错。
 *
 *    正确写法是内联空数组：`remove_flags: []`。
 *
 * 本脚本改的是提示词的**源头**：v3 数据包的 `src/prompts.mjs`。
 * 数据包目录不进版本库（.gitignore），所以脚本放在这里便于复现与审计；
 * 改完依次执行：
 *   node tools/fix_empty_array_prompt.mjs      # 改数据包 src/prompts.mjs
 *   node 猎魔人世界_.../tools/rebuild.mjs      # 重新生成 01_共享积木/*.txt
 *   node tools/sync_v3.mjs                     # 同步到 src/engine/vendor/v3/
 *
 * ⚠️ 已经执行过一次后再执行会因「源文本与预期不符」而中止（幂等保护）。
 *
 * 用法：node tools/fix_empty_array_prompt.mjs [--check]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "猎魔人世界_八章完整交互包_20261101_v3");
const promptsPath = path.join(packageDir, "src/prompts.mjs");

/** A1：共享「YAML硬规则」段（5 个模板各一处）——明确空集合必须内联写 `[]`。 */
const A1_OLD =
  "##缩进只用2个空格，禁止制表符、重复键、占位符、注释与多文档分隔符。";
const A1_NEW =
  "##缩进只用2个空格，禁止制表符、重复键、占位符、注释与多文档分隔符。" +
  "空数组必须写成同一行的空数组形式（例如remove_flags: []），" +
  "禁止只写键名后留空（如remove_flags: 后直接换行）；" +
  "后者会被程序判为非法协议文档并整份丢弃。" +
  "空对象同理写成同一行的{}。";

/** A2：结算模板规则段——把「使用空数组」翻译成具体写法。 */
const A2_OLD =
  "##story_patch每次都输出固定字段。没有新增或移除内容时使用空数组；" +
  "route_delta没有变化时三个值均为0；npc_state_updates和memory_notes允许为空数组。";
const A2_NEW =
  "##story_patch每次都输出固定字段。没有新增或移除内容时使用空数组，" +
  "且必须写成同一行的空数组形式（remove_flags: []、unresolved_hooks_added: []、" +
  "unresolved_hooks_resolved: []），不得只写键名后留空；" +
  "route_delta没有变化时三个值均为0；" +
  "npc_state_updates和memory_notes允许为空数组，写法同样是同一行的[]。";

const EDITS = [
  { key: "A1 共享YAML硬规则段", old: A1_OLD, new: A1_NEW, expect: 5 },
  { key: "A2 结算模板规则段", old: A2_OLD, new: A2_NEW, expect: 1 }
];

async function main() {
  const checkOnly = process.argv.includes("--check");
  let source;
  try {
    source = await readFile(promptsPath, "utf8");
  } catch {
    console.error(
      `[fix:empty] 找不到数据包目录：${packageDir}\n` +
        "        数据包本体不进版本库，需要时把 v3 数据包放回该目录再执行。"
    );
    process.exit(1);
  }

  const counts = EDITS.map((edit) => ({
    key: edit.key,
    old: edit.old,
    new: edit.new,
    count: source.split(edit.old).length - 1,
    expect: edit.expect,
    alreadyApplied: source.includes(edit.new)
  }));

  // 幂等：已应用过的改动，其旧文本命中数应为 0。
  const pending = counts.filter((entry) => entry.count > 0);
  const applied = counts.filter((entry) => entry.count === 0 && entry.alreadyApplied);

  for (const entry of counts) {
    const status =
      entry.count === entry.expect
        ? "PENDING"
        : entry.count === 0 && entry.alreadyApplied
          ? "APPLIED"
          : "MISMATCH";
    console.log(`[fix:empty] ${entry.key} 命中 ${entry.count} 次（期望 ${entry.expect}）${status}`);
    if (status === "MISMATCH") {
      console.error("[fix:empty] 源文本与预期不符，未做任何修改。请先核对 prompts.mjs 是否已被改动。");
      process.exit(1);
    }
  }

  if (pending.length === 0) {
    console.log("[fix:empty] 全部改动均已应用，无需重复写入。");
    return;
  }

  if (checkOnly) {
    console.log(`[fix:empty] --check：${pending.length} 处待应用，未写入。`);
    return;
  }

  for (const entry of pending) {
    source = source.split(entry.old).join(entry.new);
  }
  await writeFile(promptsPath, source, "utf8");
  console.log(
    "[fix:empty] 已写入数据包 src/prompts.mjs。接下来依次执行：\n" +
      "        node 猎魔人世界_八章完整交互包_20261101_v3/tools/rebuild.mjs\n" +
      "        node tools/sync_v3.mjs"
  );
}

await main();
