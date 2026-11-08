#!/usr/bin/env node
// 生成客户端可发布的事件目录（schedule + asset_scope only，D10）。
//
// 用法：
//   node tools/gen_v3_catalog.mjs            # 写入客户端目录
//   node tools/gen_v3_catalog.mjs --check    # 只校验是否与包一致（CI 用）
//
// ⚠️ 只导出 schedule / asset_scope / 静态元数据；
//    options 与 results 由服务端 v3 引擎权威计算，绝不下发。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chapters, events, version } from "../src/engine/vendor/v3/src/data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const target = path.resolve(
  root,
  "../aiwords/lib/adventure/v3/adventure_catalog_data.dart"
);

const catalog = {
  package_version: version,
  template_contract_version: "five-template-v3",
  schema_version: "chapter-event-schedule-v1",
  chapters: chapters.map(chapter => ({
    id: chapter.id,
    index: chapter.index,
    name: chapter.name,
    count: chapter.count,
    goal: chapter.goal,
    thread: chapter.thread,
    initial_supply: chapter.initial_supply,
    stages: chapter.stages.map(stage => ({
      id: stage.id,
      name: stage.name,
      start: stage.start,
      end: stage.end,
      scene_id: stage.scene_id
    })),
    ending_event_id: chapter.ending.event_id,
    hidden_plans: chapter.hidden_plan.map(plan => ({
      event_id: plan.event_id,
      plan: plan.plan,
      hint: plan.hint,
      title: plan.title
    })),
    import_flags: chapter.import_flags,
    export_flags: chapter.export_flags
  })),
  events: Object.values(events)
    .map(event => ({
      event_id: event.event_id,
      chapter_id: event.chapter_id,
      kind: event.kind,
      title: event.title,
      weight: event.weight,
      priority: event.priority,
      schedule: {
        round_min: event.schedule.round_min,
        round_max: event.schedule.round_max,
        stages: event.schedule.stages,
        fixed: event.schedule.fixed === true,
        repeatable: event.schedule.repeatable === true
      },
      asset_scope: {
        roles: event.asset_scope.roles,
        scenes: event.asset_scope.scenes
      },
      enemy_names: event.enemy_names,
      requires: { all_flags: event.requires.all_flags }
    }))
    .sort((left, right) => left.event_id.localeCompare(right.event_id))
};

const json = JSON.stringify(catalog);

const dart = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// 由 \`node tools/gen_v3_catalog.mjs\` 从
// 猎魔人世界_八章完整交互包_20261101_v3 (package_version ${version}) 生成。
// 重新生成：cd aiwordspromts && node tools/gen_v3_catalog.mjs
//
// ⚠️ 只包含 schedule + asset_scope 静态元数据（D10）。
//    options / results 由服务端 v3 引擎权威计算，不下发到客户端。

/// 客户端内置的 v3 事件目录 JSON。
const String adventureV3CatalogJson = r'''
${json}
''';
`;

if (checkOnly) {
  let current = "";
  try {
    current = await readFile(target, "utf8");
  } catch {
    console.error(`✖ 缺少生成文件：${target}`);
    process.exit(1);
  }
  if (current !== dart) {
    console.error("✖ 客户端事件目录与 v3 包不一致，请运行：node tools/gen_v3_catalog.mjs");
    process.exit(1);
  }
  console.log("✔ 客户端事件目录与 v3 包一致");
  process.exit(0);
}

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, dart, "utf8");
const sizeKb = (Buffer.byteLength(dart, "utf8") / 1024).toFixed(1);
console.log(
  `✔ 已生成 ${target}\n  package_version=${version} chapters=${catalog.chapters.length} events=${catalog.events.length} size=${sizeKb}KB`
);
