// v3 引擎的统一出口。
//
// 目的：屏蔽 vendor 目录的深层路径，让业务代码只依赖 `./vendor/v3/...`，
// 便于将来升级数据包版本时只改这一处。
//
// ⚠️ vendor 目录由 `node tools/sync_v3.mjs` 从
//    `猎魔人世界_八章完整交互包_20261101_v3/` 的 `src/` 与 `parser/` 同步而来。
//    不要手工编辑 vendor 下的文件；改引擎应改数据包源文件后重新同步。

export * as runtime from "./vendor/v3/src/runtime.mjs";
export * as adventure from "./vendor/v3/src/adventure.mjs";
export * as economy from "./vendor/v3/src/economy.mjs";
export * as review from "./vendor/v3/src/review.mjs";

export {
  version as PACKAGE_VERSION,
  version,
  chapters,
  events,
  items,
  assets,
  rewardCatalog
} from "./vendor/v3/src/data.mjs";

export {
  parseRestrictedYaml,
  validateAdventureTemplate,
  AdventureYamlStreamParser,
  PARSER_STREAMING_CONTRACT,
  STREAMING_CONTRACT_VERSION
} from "./vendor/v3/parser/adventure_yaml_stream_parser.mjs";
