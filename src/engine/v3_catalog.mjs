// v3 章节与事件目录（供 /api/capabilities 与客户端对齐）。
//
// 只导出服务端需要的元数据；事件选项与结算结果由引擎在运行时权威计算，
// 不在这里展开（避免把 273 个事件的完整定义搬到线上响应里）。

import { chapters, events, version } from "./v3_engine.mjs";

/** 章节清单。字段名与客户端 `AdventureChapterSummary` 一一对应。 */
export function chapterSummaries() {
  return chapters.map(chapter => ({
    id: chapter.id,
    index: chapter.index,
    name: chapter.name,
    count: chapter.count,
    goal: chapter.goal,
    gold_gain_cap: chapter.economy.gold_gain_cap,
    material_slots: chapter.economy.material_slots,
    relic_slots: chapter.economy.relic_slots,
    bond_slots: chapter.economy.bond_slots,
    equipment_slots: chapter.economy.equipment_slots
  }));
}

/** 章节总量统计，供 capabilities 快速展示。 */
export function catalogStats() {
  const all = Object.values(events);
  return {
    package_version: version,
    chapter_count: chapters.length,
    standard_rounds: chapters.reduce((total, chapter) => total + chapter.count, 0),
    event_count: all.length,
    hidden_event_count: all.filter(event => event.kind === "hidden").length
  };
}

/** 永久奖励信号 ID（v3 economy.mjs SIGNALS）。 */
export const PERMANENT_REWARD_SIGNALS = Object.freeze({
  material: 900050,
  relic: 900060,
  bond: 900061,
  equipment: 900062
});

/** 战斗结果枚举。 */
export const BATTLE_RESULTS = Object.freeze(["victory", "defeat", "retreat"]);

/** 冒险运行模式：v3 禁止 replay，只有 story。 */
export const PLAY_MODES = Object.freeze(["story"]);
