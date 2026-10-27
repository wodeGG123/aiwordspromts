/**
 * 重新生成 02_按状态预切片 与 03_完整流程模拟 的提示词产物，并重建发布清单。
 *
 * 为什么要脚本化：
 *   引擎包一改（增删规则段落、替换输出约束、去 demo），
 *   预切片的引擎积木、完整拼装示例、完整流程模拟的 system prompt 就全部过期。
 *   手工同步 15 个大文件极易漏改，而「验证完整模拟」会按生产入口逐字比对，
 *   漏改必然报错。这里把生成过程固化，保证产物永远等于生产入口的输出。
 *
 * 覆盖范围：
 *   1. 02_按状态预切片/<目录>/01_引擎积木.txt            ← buildEngineContext(模板名)
 *   2. 02_按状态预切片/<目录>/04_system_prompt_完整拼装示例.txt
 *        ← 引擎积木 + 世界规则积木 + 副本积木 + 最终自检积木（顺序与拼装清单一致）
 *   3. 03_完整流程模拟/<步骤>/01_system_prompt_完整.txt    ← prepareAiMessages 的 systemPrompt
 *   4. 03_完整流程模拟/<步骤>/03_程序到AI_完整拼接prompt.txt
 *        ← prepareAiMessages 的 fullPrompt
 *   5. 发布清单_20260904.json                            ← 全量 bytes + sha256
 *
 * 不覆盖：
 *   - 副本积木（内容取决于副本运行包与具体事件，不由本脚本推导）
 *   - user prompt（运行时态输入，由业务侧提供）
 *   - AI 实际输出（真实模型产物）
 *
 * 用法：node 数据拆分包_20260904/04_验证工具/重新生成预切片与模拟_20260904.mjs [--check]
 *   --check 只比对不写盘，用于 CI 检查产物是否与代码同步。
 */

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildEngineContext } from "../00_源包/冒险模式_通用引擎包_20260904_v5.js";
import { prepareAiMessages } from "../腐化魔王危机_预切片积木入口_20260904.mjs";
import { SLICE_TEMPLATES, SIMULATION_STEPS } from "./流程步骤定义_20260904.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const changes = [];
const unchanged = [];

async function writeIfChanged(relativePath, content) {
  const absolute = path.join(root, relativePath);
  let current = null;
  try {
    current = await readFile(absolute, "utf8");
  } catch {
    current = null;
  }
  if (current === content) {
    unchanged.push(relativePath);
    return;
  }
  changes.push(relativePath);
  if (!checkOnly) await writeFile(absolute, content, "utf8");
}

/** 02_按状态预切片：引擎积木与完整拼装示例。 */
async function regenerateSlices(worldBrick, finalCheckBrick) {
  for (const slice of SLICE_TEMPLATES) {
    const dir = path.join("02_按状态预切片", slice.folder);
    const engineBrick = buildEngineContext(slice.templateName);
    const dungeonBrick = await readFile(path.join(root, dir, "02_副本积木.txt"), "utf8");
    const assembled = [engineBrick, worldBrick, dungeonBrick, finalCheckBrick].join("\n\n");
    await writeIfChanged(path.join(dir, "01_引擎积木.txt"), engineBrick);
    await writeIfChanged(path.join(dir, "04_system_prompt_完整拼装示例.txt"), assembled);
  }
}

/** 03_完整流程模拟：用生产入口重算 system prompt 与完整拼接 prompt。 */
async function regenerateSimulations() {
  for (const step of SIMULATION_STEPS) {
    const dir = path.join("03_完整流程模拟", step.id);
    const userPrompt = await readFile(path.join(root, dir, "02_user_prompt_完整.txt"), "utf8");
    const runtimeYaml = userPrompt.replace(/^#本次程序运行态输入\n/, "");
    const rebuilt = prepareAiMessages({ ...step.options, runtimeYaml });
    await writeIfChanged(path.join(dir, "01_system_prompt_完整.txt"), rebuilt.systemPrompt);
    await writeIfChanged(path.join(dir, "03_程序到AI_完整拼接prompt.txt"), rebuilt.fullPrompt);
  }
}

/** 收集研发包内全部文件（不含隐藏文件与发布清单自身）。 */
async function collectBundleFiles(dir, prefix = "") {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter(entry => !entry.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectBundleFiles(path.join(dir, entry.name), relative));
    } else if (relative !== "发布清单_20260904.json") {
      files.push(relative);
    }
  }
  return files;
}

/** 重建发布清单：每个文件的字节数与 sha256。 */
async function regenerateManifest() {
  const relativePaths = await collectBundleFiles(root);
  const files = [];
  for (const relative of relativePaths) {
    const bytes = await readFile(path.join(root, relative));
    files.push({
      path: relative,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
  const manifestPath = path.join(root, "发布清单_20260904.json");
  const current = JSON.parse(await readFile(manifestPath, "utf8"));
  const next = {
    ...current,
    bundle_version: "2026.09.04.2",
    files
  };
  await writeIfChanged("发布清单_20260904.json", JSON.stringify(next, null, 2) + "\n");
  return next;
}

const worldBrick = await readFile(path.join(root, "01_共享积木/世界规则_固定积木_20260904.txt"), "utf8");
const finalCheckBrick = await readFile(path.join(root, "01_共享积木/最终自检_固定积木_20260904.txt"), "utf8");

await regenerateSlices(worldBrick, finalCheckBrick);
await regenerateSimulations();
const manifest = await regenerateManifest();

process.stdout.write(JSON.stringify({
  ok: true,
  mode: checkOnly ? "check" : "write",
  changed_count: changes.length,
  unchanged_count: unchanged.length,
  changed: changes,
  manifest_file_count: manifest.files.length
}, null, 2) + "\n");

if (checkOnly && changes.length > 0) process.exitCode = 1;
