// 探针 3：章末 finish 分布、调度空档、direct 路径的完整回放。
import * as R from "../src/engine/vendor/v3/src/runtime.mjs";

// ── 1. 章末事件的 outcome → finish 映射 ─────────────────────
console.log("=== 1. 章末事件各 outcome 的 finish ===");
for (const c of R.chapters) {
  const e = R.events[c.ending.event_id];
  const rows = [];
  for (const o of e.options) {
    const m = Object.entries(o.results).map(([k, v]) => `${k}→${v.finish}`).join(",");
    rows.push(`opt${o.id}(${o.resolution_type}): ${m}`);
  }
  console.log(`  ${c.id} ${e.event_id} count=${c.count}`);
  for (const r of rows) console.log(`      ${r}`);
}

// ── 2. 每章每轮是否都有可调度事件 ─────────────────────────
console.log("\n=== 2. 调度空档检查（每章每轮是否至少一个候选事件）===");
for (const c of R.chapters) {
  const gaps = [];
  for (let round = 1; round <= c.count; round += 1) {
    const done = new Set();
    const all = Object.values(R.events).filter(
      e => e.chapter_id === c.id && round >= e.schedule.round_min && round <= e.schedule.round_max && !done.has(e.event_id)
    );
    const fixed = all.filter(e => e.schedule.fixed);
    const ids = (fixed.length ? fixed : all).map(e => e.event_id).sort();
    if (ids.length === 0) gaps.push(round);
  }
  console.log(`  ${c.id} count=${c.count} 空档轮次: ${gaps.length ? gaps.join(",") : "无"}`);
}

// ── 3. 隐藏事件的前置 flag 归属 ────────────────────────────
console.log("\n=== 3. 隐藏事件 ===");
for (const e of Object.values(R.events)) {
  if (e.kind !== "hidden") continue;
  console.log(`  ${e.event_id} round ${e.schedule.round_min}-${e.schedule.round_max} 需要 ${JSON.stringify(e.requires)}`);
}

// ── 4. 候选事件数分布（fixed 优先）──────────────────────────
console.log("\n=== 4. 每轮候选事件数（fixed 优先）分布 ===");
const dist = {};
for (const c of R.chapters) {
  for (let round = 1; round <= c.count; round += 1) {
    const all = Object.values(R.events).filter(
      e => e.chapter_id === c.id && round >= e.schedule.round_min && round <= e.schedule.round_max
    );
    const fixed = all.filter(e => e.schedule.fixed);
    const n = (fixed.length ? fixed : all).length;
    dist[n] = (dist[n] ?? 0) + 1;
  }
}
console.log("  ", dist);

// ── 5. 章末是否可能以 ongoing 收尾（影响 nextRound 是否会抛错）──
console.log("\n=== 5. 章末结算后 run_status 可能值 ===");
for (const c of R.chapters) {
  const e = R.events[c.ending.event_id];
  const finishes = new Set();
  for (const o of e.options) for (const r of Object.values(o.results)) finishes.add(r.finish);
  console.log(`  ${c.id}: ${[...finishes].join("/")} ${finishes.has("ongoing") ? "⚠️ 存在 ongoing" : ""}`);
}
