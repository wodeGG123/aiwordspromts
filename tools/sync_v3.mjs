#!/usr/bin/env node
/**
 * 把 v3 数据包的引擎源码同步到 src/engine/vendor/v3/。
 *
 * 为什么不直接 import 包目录：
 *   1. 包目录 142MB（含发布清单、资产、模拟产物），进镜像过大；
 *   2. Dockerfile 需要 COPY 一个中文目录名，跨平台与 CI 都不友好；
 *   3. 服务端只需要引擎本体（src/）与流式解析器（parser/），共约 2.2MB。
 *
 * 用法：
 *   node tools/sync_v3.mjs            # 同步
 *   node tools/sync_v3.mjs --check    # 校验 vendor 与包一致（CI 用）
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(root, "猎魔人世界_八章完整交互包_20261101_v3");
const vendorDir = path.join(root, "src/engine/vendor/v3");

// 只同步服务端运行时真正需要的两个目录。
const SOURCE_DIRS = ["src", "parser"];

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, base)));
      continue;
    }
    files.push(path.relative(base, full));
  }
  return files.sort();
}

async function digest(file) {
  const buf = await readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const checkOnly = process.argv.includes("--check");

  let packageStat;
  try {
    packageStat = await stat(packageDir);
  } catch {
    console.error(`[sync:v3] 找不到数据包目录：${packageDir}`);
    process.exit(1);
  }
  if (!packageStat.isDirectory()) {
    console.error(`[sync:v3] 数据包路径不是目录：${packageDir}`);
    process.exit(1);
  }

  const expected = new Map();
  for (const dir of SOURCE_DIRS) {
    const full = path.join(packageDir, dir);
    let names;
    try {
      names = await listFiles(full);
    } catch {
      console.error(`[sync:v3] 数据包缺少目录：${dir}`);
      process.exit(1);
    }
    for (const name of names) {
      expected.set(path.join(dir, name), path.join(packageDir, dir, name));
    }
  }

  if (checkOnly) {
    const actual = new Map();
    try {
      for (const name of await listFiles(vendorDir)) {
        actual.set(name, path.join(vendorDir, name));
      }
    } catch {
      console.error("[sync:v3] vendor 目录不存在，请执行 node tools/sync_v3.mjs");
      process.exit(1);
    }

    const problems = [];
    for (const [name, source] of expected) {
      const target = actual.get(name);
      if (!target) {
        problems.push(`缺失：${name}`);
        continue;
      }
      if ((await digest(source)) !== (await digest(target))) {
        problems.push(`内容不一致：${name}`);
      }
    }
    for (const name of actual.keys()) {
      if (!expected.has(name)) problems.push(`多余文件：${name}`);
    }
    if (problems.length > 0) {
      console.error("[sync:v3] vendor 与数据包不一致：");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(`[sync:v3] vendor 一致（${expected.size} 个文件）`);
    return;
  }

  await rm(vendorDir, { recursive: true, force: true });
  await mkdir(vendorDir, { recursive: true });
  for (const dir of SOURCE_DIRS) {
    await cp(path.join(packageDir, dir), path.join(vendorDir, dir), { recursive: true });
  }
  console.log(`[sync:v3] 已同步 ${expected.size} 个文件到 src/engine/vendor/v3/`);
}

main().catch(error => {
  console.error("[sync:v3] 同步失败：", error);
  process.exit(1);
});
