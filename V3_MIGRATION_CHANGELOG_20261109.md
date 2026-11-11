# v3 八章连续冒险 · 改动说明文档

> 数据包：`猎魔人世界_八章完整交互包_20261101_v3`（版本 `2026.11.01.3`）
> 方案依据：`V3_MIGRATION_PLAN_20261108.md`（方案 C：Stateless Server Reducer + Client Save Authority）
> 涉及仓库：`aiwordspromts`（AI 服务端）、`aiwords`（Flutter 客户端）
> 文档日期：2026-11-09

---

## 目录

1. [总览](#1-总览)
2. [架构与状态权威](#2-架构与状态权威)
3. [服务端改动（aiwordspromts）](#3-服务端改动aiwordspromts)
4. [客户端改动（aiwords）](#4-客户端改动aiwords)
5. [核心流程时序](#5-核心流程时序)
6. [关键不变量与踩坑清单](#6-关键不变量与踩坑清单)
   - [6.2 C15 详解：`NPC变化未获授权` 事故](#62-c15-详解npc变化未获授权事故2026-11-09-线上)
7. [验证结果](#7-验证结果)
8. [遗留事项与后端待配合项](#8-遗留事项与后端待配合项)

---

## 1. 总览

### 1.1 改��范围

| 仓库 | 改动类型 | 文件数 | 行数变化 |
|---|---|---|---|
| `aiwordspromts` | 服务端适配层 + 测试 | 5 | +226 / -4 |
| `aiwords` | 客户端 v3 层 + 战斗层 + UI | 20 | +2832（新文件）/ +306 / -201 |

### 1.2 阶段完成情况

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | Docker 修复 + `v3_engine.mjs` + `v3_catalog.mjs` + capabilities 增补 | ✅ 完成 |
| P1 | `v3_adapter.mjs`：校验 + 预迁移 + prompt 装配 + `advanceV3` + SSE `event: state` + `transitionV3` | ✅ 完成 |
| P2 | 服务端单测 `v3_adapter.test.mjs` + `server_v3.test.mjs` | ✅ 完成（153 全绿） |
| P3 | 客户端模型层 `adventure_models.dart` | ✅ 完成 |
| P4 | 客户端 `adventure_store` / `adventure_controller` / `adventure_v3_api` / `adventure_operations` | ✅ 完成 |
| **P5** | **客户端 UI：campaign 页 + story 页 + 撤退按钮 + 奖励弹窗** | ✅ **本轮完成** |
| **P6** | **奖励邮件链路 + `confirm_reward` operation** | 🟡 **本轮完成客户端侧**，邮件接口待后端 |
| **P7** | **旧副本入口下线 + 旧存档清理** | ✅ **本轮完成** |
| **P8** | **C15 线上事故修复：`NPC变化未获授权`（提示词收紧 A + 服务端权威归一化 B）** | ✅ **本轮完成** |

### 1.3 本轮（P8）线上事故修复

| 项 | 内容 |
|---|---|
| 事故 | 结算被引擎以 `NPC变化未获授权` 拒绝，SSE 只发 `event: error` 不发 `event: state`，玩家卡在当前轮（线上 3 次） |
| 根因 | 引擎要求 `npc_state_updates` 与事件表授权**严格全等**，但 1717/1747 个 result 授权是 `[]`；而提示词同时教 AI「关系阶梯」「移动一级」，结算示例本身还写了非空 NPC 变更 |
| 修复 A | 收紧提示词：删「关系阶梯/移动一级」、示例改 `[]`、契约段明确「授权为空必须输出 `[]`」、失败段摘掉该字段 |
| 修复 B | 服务端 `normalizeSettlementNpcUpdates()` 以事件表授权强制覆盖 AI 输出（只改这一个字段，其余字段仍严格校验） |
| 验证 | 真实事故 trace 重放 3/3 通过；服务端 161 测试全绿；八章全量模拟 648 次 AI 交互通过 |
| 详见 | [§6.2](#62-c15-详解npc变化未获授权事故2026-11-09-线上) |

### 1.3 改动的核心目标

把「旧的单线 AI 冒险副本」替换为「八章连续冒险 campaign」，同时：

- **状态推进全部由服务端 v3 引擎权威计算**，客户端不再复刻任何断言（`commitSettlement` 等）；
- 客户端持有唯一权威存档副本，负责持久化 / 串行 / 拦截过期回包；
- 服务端从「无状态 SSE 转发器」升级为「无状态 Reducer」——收到存档 + operation，算出下一版存档返回。

---

## 2. 架构与状态权威

### 2.1 双通道设计

```
┌─────────────────────────── 客户端 (aiwords) ───────────────────────────┐
│  持有 adventure 存档 + revision (CAS)                                   │
│  持有 applied_request_ids / world_story_state（原样回传）                │
└───────────────┬──────────────────────────────────┬─────────────────────┘
                │ AI 通道                           │ 控制通道
                │ POST /api/chat                   │ POST /api/adventure/transition
                │ {package_version, adventure, operation}                    │
                ▼                                   ▼
┌─────────────────────────── 服务端 (aiwordspromts) ──────────────────────┐
│  1. 校验（包版本 / revision / 游标 / operation↔模板）                     │
│  2. 预迁移（selectOption / acceptBattleResult / nextRound）              │
│  3. 装配 prompt（v3 引擎 prepareAiMessages）                             │
│  4. 调模型 → 解析 YAML → 五模板 Schema 校验                             │
│  5. 推进状态（acceptNewEvent / acceptResolution / commitSettlement）     │
│  6. 返回下一版 adventure                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键点**：服务端**不落盘**、**不持有会话状态**。它是纯函数式 Reducer：`(adventure, operation, aiOutput) → adventure'`。

### 2.2 为什么这样切分

| 问题 | 方案 |
|---|---|
| 服务端无状态 → 无法判定「过期 revision」 | 客户端用 `request_guard`（`session_revision` + `run_id` + `state_version`）比对并丢弃迟到回包 |
| 客户端要展示结算摘要，但不该自己解析 YAML | 服务端在 SSE `event: state` 里**附带权威校验后的 `output` 文档**，客户端直接展示 |
| 客户端事件目录是 schedule-only，算不出经济额度 | 服务端在 `continue` 时**权威注入 `reward_state`** |

---

## 3. 服务端改动（aiwordspromts）

### 3.1 `src/engine/v3_adapter.mjs`（+69 行）

#### 3.1.1 新增 `dailyRewardCycleId()`（D6 / R9）

```javascript
export function dailyRewardCycleId(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `daily:${year}-${month}-${day}`;
}
```

- **D6**：奖励周期按自然日 `daily:YYYY-MM-DD`，跨零点自然进入新周期；终身键（`lifetime:`）不随周期清除。
- **R9**：以**服务端**日期为准，规避客户端时区与服务端不一致导致的周期错乱。客户端也可通过 `args.rewardCycleId` 显式覆盖（离线补登场景）。

#### 3.1.2 新增 `buildRewardStateForContinue()`（D10 + D6）

服务端在 `continue` 动作中构造权威 `reward_state` 并注入：

```javascript
function buildRewardStateForContinue(current, args) {
  const runtime = current.runtime;
  // 续玩进行中的 run：引擎走 copy(s) 分支，不需要新账本。
  if (runtime && runtime.run_status === "ongoing") return null;

  const records = current.campaign.chapter_results?.length ?? 0;
  const targetIndex = runtime && runtime.run_status === "cleared" ? records + 1 : records;
  const chapter = R.chapters[targetIndex];
  if (!chapter) return null;

  const cycleId = args.rewardCycleId || dailyRewardCycleId();

  // 跨周期重建：保留 lifetime 键
  const previous = args.previousRewardState;
  const usablePrevious = previous
    && previous.chapter_id === chapter.id
    && previous.cycle_id !== cycleId
    ? previous : null;

  try {
    return E.createRewardState({ chapterId: chapter.id, cycleId, ...(usablePrevious ? { previous: usablePrevious } : {}) });
  } catch {
    return null;  // 构造失败时不注入，让引擎用自己的错误信息说明缺什么
  }
}
```

**为什么必须服务端构造**：

1. 客户端事件目录是 schedule-only（D10），**没有**章节 economy 配置，算不出 `gold_gain_cap` / 各 `*_slots` 额度；
2. `createRewardState` 要求 `cycle_id` 是自然日周期（D6），两端时区可能不一致（R9）。

**注入点**（`transitionV3` 的 `continue` 分支）：

```javascript
if (continueArgs.rewardState === undefined) {
  const injected = buildRewardStateForContinue(current, continueArgs);
  if (injected) continueArgs.rewardState = injected;
}
```

客户端**可以**显式覆盖 `rewardState`（服务端只在缺失时注入），这样离线补登场景仍可精确对齐。

#### 3.1.3 新增 `normalizeSettlementNpcUpdates()`（C15 / B 方案）

服务端在信任边界把结算输出里的 `npc_state_updates` 强制对齐到事件表授权值：

```javascript
export function normalizeSettlementNpcUpdates(runtime, output) {
  const patch = output?.event_details?.story_patch;
  if (!patch || !Array.isArray(patch.npc_state_updates)) {
    return { output, changed: false, repair: null };
  }
  let authorized;
  try {
    authorized = R.settlementEffect(runtime, patch.outcome).effect.npc_updates ?? [];
  } catch {
    return { output, changed: false, repair: null };  // 授权取不到 → 不动手
  }
  if (JSON.stringify(patch.npc_state_updates) === JSON.stringify(authorized)) {
    return { output, changed: false, repair: null };
  }
  const normalized = structuredClone(output);
  normalized.event_details.story_patch.npc_state_updates = structuredClone(authorized);
  return { output: normalized, changed: true, repair: { /* ...痕迹... */ } };
}
```

接入点：`advanceV3()`（真实推进）与 `shadowValidateOutput()`（影子校验）—— 两者必须同口径，
否则影子结果会与真实推进结果矛盾。详见 [§6.2](#62-c15-详解npc变化未获授权事故2026-11-09-线上)。

#### 3.1.4 其他（此前轮次已完成，本次未改）

- `premigrateV3()`：按 operation 做预迁移（见 [§5](#5-核心流程时序)）。
- `advanceV3()`：AI 输出校验通过后推进状态；**校验失败绝不推进任何状态**。
- `transitionV3()`：控制通道 6 个 action（`create` / `continue` / `close_chapter` / `restart` / `confirm_reward` / `view`）。
- v3 引擎抛的是原生 `Error`，适配层统一包装为 `V3ContractError`（含 `code` / `details`），让客户端能区分「参数非法」与「服务端故障」。

### 3.2 `src/server/routes.mjs`（+22 行）

SSE `event: state` 里**附带权威校验后的 AI 文档**：

```javascript
writeSseEvent(res, "state", JSON.stringify({
  adventure: advanced.adventure,
  state_version: advanced.adventure?.runtime?.state_version ?? null,
  revision: advanced.adventure?.revision ?? null,
  request_guard: prepared.requestGuard,
  changed: advanced.changed,
  output: advanced.output ?? aiOutput   // ← C15：下发归一化后的版本
}));
```

> ⚠️ **C15**：下发的不再是原始 `aiOutput`，而是归一化后的 `advanced.output`。
> 否则客户端展示的 NPC 状态会与服务端存档不一致。

另外，归一化触发时打 `output_repaired` 日志（用于观察 A 方案的收敛效果）：

```javascript
if (advanced.repair) {
  log("output_repaired", {
    field: advanced.repair.field,
    event_id: advanced.repair.event_id,
    outcome: advanced.repair.outcome,
    ai_value: advanced.repair.ai_value,
    authorized_value: advanced.repair.authorized_value
  });
}
```

**收益**：
- 客户端**不需要**再实现一套 YAML 解析 + 五模板断言，直接展示服务端校验过的结构；
- 避免两端解析口径漂移（客户端自解析可能对 `summary` / `story_patch` 的字段理解与服务端不一致）。

### 3.3 `src/tests/v3_adapter.test.mjs`（+134 行）

新增 3 个 `confirm_reward` 相关用例：

| 用例 | 覆盖点 |
|---|---|
| `confirm_reward 把 pending 奖励回执标记为 granted` | 正常确认；断言 `state_version +1`、`granted_permanent_rewards` 追加 |
| `confirm_reward 拒绝不匹配的奖励本体与非法状态` | 未知 `claim_key` 抛 `没有对应的奖励预留` |
| `close_chapter 在存在 pending 奖励回执时被拒绝` | 引擎硬校验（见 [§6](#6-关键不变量与踩坑清单) C8） |

测试用 CH01_E012 的 option 1（direct）构造真实奖励预留——该选项会预留一件永久材料「剑核心」。

### 3.4 `src/tests/server_v3.test.mjs`（+5 行）

HTTP 端到端用例的适配调整。

---

## 4. 客户端改动（aiwords）

### 4.1 新增文件总览

| 文件 | 行数 | 职责 |
|---|---|---|
| `lib/pages/adventure/adventure_v3_story_page.dart` | 1237 | 章内运行时剧情页（相位机 + 打字机 + 战斗 + 奖励 + 终章） |
| `lib/pages/adventure/adventure_campaign_page.dart` | 789 | 八章总览页（章节卡 + 入口编排 + 只读归档） |
| `lib/adventure/v3/adventure_v3_output.dart` | 386 | 五模板展示模型 |
| `lib/adventure/v3/adventure_v3_entry.dart` | 162 | 入口参数装配（campaign_id / run_id / team / relics） |
| `lib/pages/adventure/adventure_battle_seed.dart` | 143 | v3 剧情战斗我方出战种子装配 |
| `lib/adventure/v3/adventure_v3_session.dart` | 115 | 应用级会话单例 + 奖励结算统一入口 |

### 4.2 `adventure_v3_story_page.dart`（P5 核心）

#### 4.2.1 相位机

```
 start / next_round
      │  服务端 acceptNewEvent
      ▼
 awaiting_choice ──choose(检定)──► awaiting_settlement_commit
      │                                    │ settle_check
      │                                    ▼
      │                              commitSettlement（结算完成）
      │
      └──choose(战斗事件)──► awaiting_battle_result
                                   │ battle_result(victory/defeat/retreat)
                                   ▼
                            commitSettlement（结算完成）

 choose(直选结算) ──► 服务端直接 commitSettlement（pending 清空）
```

#### 4.2.2 主要方法

| 方法 | 说明 |
|---|---|
| `_bootstrap()` | 恢复存档 → 同步场景 → `_driveFromPending()` |
| `_driveFromPending()` | 按 `pending.phase` 分派；`pending == null` 说明是**直选结算**，直接走「结算后」分支 |
| `_requestNewEvent()` | 发 `start` / `next_round`；前置校验 `completedEventCount == currentRound`（C1） |
| `_showEvent()` | 展示场景 / BGM / 旁白 / 选项 |
| `_handleSettlementCommit()` | 检定 → 播分析 → 自动 `settle_check`；战斗 → 播开场 → 等玩家打完 |
| `_handleBattlePending()` | 从 `resolution_output.enemies` 造战斗种子 |
| `_onOptionSelected()` | 发 `choose`（`selected_option` 原样复制） |
| `_settleCheck()` | 发 `settle_check` |
| `_runBattle()` | 本地战斗 → 发 `battle_result`（victory/defeat/retreat） |
| `_afterSettlement()` | 摘要 → 奖励 → 章末判断 → 下一轮 |
| `_handleChapterEnd()` | `finale` → `close_chapter` → 回总览页 |

#### 4.2.3 关键设计点

**① 状态权威**：客户端**不推算** `state_version` / `completed_events` / 轮数，也不在本地判定胜负。一切以服务端返回的 `adventure` 为准。

**② 场景映射**（v3 场景名 ↔ 客户端素材名有差异）：

```dart
const Map<String, String> aliases = <String, String>{
  '吸血鬼庄园': '吸血鬼城堡',
  '魔王城堡': '恶魔城堡',
};
```

外加白名单 + 兜底图（`assets/images/home_bg.png`），避免拼出不存在的资源路径。

**③ BGM 白名单**：v3 的 23 个场景只有 12 个有对应 BGM，其余统一回落到 `幽暗森林.mp3`。

**④ 结算摘要来源**：优先用服务端 `output.summary`；缺失时退回 `_lastOutput`（直选结算场景）。

**⑤ 奖励确认后重读运行态**：`confirm_reward` 会让 `state_version +1`（C10），因此 `_afterSettlement()` 里在 `_handleRewards()` **之后**重新读取 `runtime`，避免用旧快照判断 `run_status`。

**⑥ 场景切换时的 BGM 保护**：战斗前 `_stopBgm()`，战斗后 `_resumeBgm(savedBgm)`。

### 4.3 `adventure_campaign_page.dart`（P5）

- 八章卡：状态（`已通关` / `待回顾` / `失败` / `进行中` / `可进入` / `未解锁`）、`critical_npcs`、`recap` 文本；
- 主按钮按 `view.continue_kind` 切换文案：`开始冒险` / `继续冒险` / `进入下一章`；
- 「从第一章重开」确认文案**协议固定，不得改写**：

```dart
const String kAdventureV3RestartConfirmText =
    '将从第一章重新开始，本次局内道具与剧情进度不继承，已到账永久资源保留';
```

- 最近 3 次**只读**归档展示（D12）；
- **状态权威**：章节卡状态一律来自服务端 `view`（`AdventureView`），客户端**不自行推算**「哪一章可进入」。

### 4.4 `adventure_v3_session.dart`（P6 关键）

新增 `settlePendingRewards()`——**关章前必调**：

```dart
Future<int> settlePendingRewards() async {
  // 1. 尝试创建奖励邮件并领取（D2）
  // 2. 无论邮件是否创建成功，都向服务端 confirm_reward 确认 granted（D9）
  // 3. 邮件没发出去的条目保留在本地待发队列，等接口上线后用同一 claim_key 补发
}
```

调用点有 **3 处**（缺一不可）：

| 调用点 | 原因 |
|---|---|
| `_afterSettlement()`（结算后） | 及时确认回执，减少 pending 堆积 |
| `_enterChapter()`（进入下一章前） | `promoteChapter` 硬校验「无 pending 奖励回执」 |
| `_handleChapterEnd()`（关章前） | `closeAdventureChapter` 硬校验同上 |

### 4.5 `adventure_v3_output.dart`

五模板展示模型：

| 模板 | 解析出的内容 |
|---|---|
| 新一轮事件 | `steps` + `options`（`AdventureV3OptionView`） |
| 战斗事件 | `enemies`（仅 `name` 字段，数值由客户端用默认模板补齐） |
| 检定 | `analysis` + `result`（`大成功` / `成功` / `失败`） |
| 结算 | `steps` + `summary` + `story_patch` |
| 终章 | `content` |

**设计约束**：`AdventureV3OptionView` **只用于展示**，提交时必须用 `AdventurePendingInteraction.optionById()` 拿到的原样副本——引擎按 `JSON.stringify` 逐字节比对，任何字段增删都会导致 `selected_option不一致`。

### 4.6 `adventure_v3_entry.dart`

| 方法 | 说明 |
|---|---|
| `newCampaignId()` | `camp-<microseconds>` |
| `newRunId()` | `run-<campaign>-<chapter>-<microseconds>`；**每章必须全新**（引擎校验 `!used_run_ids.includes(runId)`） |
| `newSeed()` | `DateTime.now().millisecondsSinceEpoch % 2147483647` |
| `buildTeam()` | 上阵阵容 → 已拥有前 4 张 → 占位队伍（全属性 0） |
| `buildRelics()` | 从本地待发队列取「已到账」的圣物条目 |
| `buildContinueArgs()` | 组装 `continue` 入参 |

**圣物继承注意**：v3 的 `promoteChapter` 只搬运局内道具（tools），**圣物不随章节自动继承**，必须在进入下一章时由客户端显式回传。

### 4.7 模型层修正（`adventure_models.dart`）

#### ① `AdventureRuntime` 补两个字段

```dart
/// `world_story_state`：跨章世界快照的**原样副本**。
/// ⚠️ 服务端 validateRequest 会校验
///    campaign_id === world_story_state.campaign_id 与
///    campaign_revision === world_story_state.revision，
///    缺失或改写会直接被拒（`跨章存档版本不一致`）。
final Map<String, dynamic> worldStoryState;

/// `applied_request_ids`：已提交结算的 request_id 列表。
/// ⚠️ 服务端用它做幂等（`重复结算`）。必须原样回传。
final List<String> appliedRequestIds;
```

这两个字段缺失会导致**所有请求被服务端拒绝**，是本次最关键的模型层修复。

#### ② `AdventureSseState` 补 `output`

```dart
/// 服务端权威校验后的 AI 文档（五模板之一）。
/// ⚠️ 客户端**不需要**再自行解析 YAML。
final Map<String, dynamic>? output;
```

### 4.8 战斗层改造（D7 撤退）

#### `battle_core.dart`

```dart
enum BattleOutcome {
  result,    // 普通胜负（胜利 / 失败）
  retreat,   // 玩家主动撤退（D7）
}

class BattleResult {
  const BattleResult({
    required this.allyWin,
    required this.resultText,
    this.outcome = BattleOutcome.result,   // 旧玩法默认 result，向后兼容
  });
  bool get isRetreat => outcome == BattleOutcome.retreat;
}
```

#### `battle_playback.dart`

- 抽出 `_settleToFinalState()`（原 `forceFinish` 里的终态落定逻辑），由 `forceFinish` / `forceRetreat` / `skipToEnd` 共用；
- 新增 `forceRetreat()`：结果为 `allyWin: false` + `resultText: '已撤退'` + `outcome: retreat`。

**注意**：撤退时 `allyWin` 是 `false`（因为不是胜利），但 `outcome` 区分开了——客户端据此提交 `battle_result = retreat` 而不是 `defeat`。

#### `battle_scene.dart` / `story_battle_page.dart`

- 新增 `showRetreatButton` 参数（默认 `false`，只有 v3 剧情战斗开启）；
- 「撤退」按钮**二次确认**（避免误触），文案：「确定要撤退吗？撤退会放弃本次战斗的胜利收益。」

### 4.9 P7：旧副本下线 + 旧存档清理

#### 入口下线（D4）

| 位置 | 改动 |
|---|---|
| `main_shell_page.dart` | 删除「冒险副本」卡片，只保留「章节闯关」「试炼之塔」「冒险」 |
| `main.dart` | 删除 `/dungeon-list` 路由与 import |
| `task_destination.dart` | 删除 `('冒险副本', push('/dungeon-list'))` 规则；「冒险副本」描述现在匹配到 `('冒险', push('/adventure'))` |

`dungeon_list_page.dart` / `dungeon_list_controller.dart` **保留未删**——它们仍被 `adventure_story_page.dart` 引用，删除会破坏编译。

#### 旧存档清理（D11）

```dart
/// 旧版（v4）存档的 key 前缀（D11：检测到即清除）。
static const String legacyKeyPrefix = 'adventure_runtime_v1';

Future<void> _purgeLegacySaves(SharedPreferences preferences) async {
  final List<String> keys = preferences
      .getKeys()
      .where((String key) => key.startsWith(legacyKeyPrefix))
      .toList(growable: false);
  for (final String key in keys) {
    await preferences.remove(key);
  }
}
```

- v3 存档 key：`adventure_v3_save`
- v4 存档 key：`adventure_runtime_v1:<run_id>`
- 两者互不冲突；`load()` 时按前缀批量清除旧 key，避免旧状态在新版客户端里复活。

### 4.10 `adventure_operations.dart` 补充

- 新增 `AdventureV3ContinueArgsBuilder`（`continue` 入参构造器）；

  **⚠️ `rewardState` 不由客户端构造**（D10 + D6），服务端在 `continue` 时自动注入权威账本。

- `adventureV3NextAction()` 补 `awaiting_battle_result` 分支。

### 4.11 `adventure_reward_service.dart` 补充

| 新增 | 说明 |
|---|---|
| `needsMailDelivery` getter | `isGranted && mailId 为空` —— 服务端已确认但邮件未创建（D9 兜底态） |
| `upsertPending(item)` | 按 `claim_key` 幂等覆盖写入 |
| `deliver(item)` | 创建邮件 → 领取附件；失败**不抛异常**，保持「待发放」状态 |

修复：`deliver()` 里 `mailId` 的空安全（`String?` → `String` 的类型提升），消除 `argument_type_not_assignable`。

---

## 5. 核心流程时序

### 5.1 服务端预迁移表

| operation | 装配前必须完成的服务端迁移 | AI 输出后的推进 |
|---|---|---|
| `start` | 无 | `acceptNewEvent` |
| `next_round` | `nextRound()`（推进轮数、扣补给） | `acceptNewEvent` |
| `choose` | `selectOption()` | `acceptResolution` |
| `choose`（直选结算） | `selectOption()` | `commitSettlement`（**直接**） |
| `settle_check` | 无（`resolution_output` 已在存档中） | `commitSettlement` |
| `battle_result` | `acceptBattleResult()` | `commitSettlement` |
| `finale` | 无 | 不改状态（归档走控制通道） |

> ⚠️ **direct（直选结算）选项走 `choose` + 结算模板，必须直接 `commitSettlement`**。若误走 `acceptResolution`，phase 会被置为 `awaiting_battle_result` 而卡死。
>
> ⚠️ `nextRound` 由服务端在 `next_round` 请求的装配前执行：它会 `current_round+1`、supply 扣减并可能触发硬失败。客户端不持有引擎，无法自行推进。

### 5.2 完整一局（玩家视角）

```
主界面「冒险」
  └→ AdventureCampaignPage（八章总览）
       ├→ [开始冒险]   create(campaignId) → continue(runId, team, relics) → StoryPage
       ├→ [继续冒险]   refreshView() → continue(空参，续玩原 run) → StoryPage
       ├→ [进入下一章] settlePendingRewards() → continue(新 runId) → StoryPage
       └→ [从第一章重开] restart(新 campaignId) → 旧 campaign 进归档

StoryPage:
  start / next_round → 服务端 acceptNewEvent → 展示 steps + options
    ↓ 玩家选一个选项
  choose(selected_option 原样复制)
    ├─ 检定   → 服务端 acceptResolution(phase=awaiting_settlement_commit)
    │            → 客户端播 analysis → settle_check → 服务端 commitSettlement
    ├─ 战斗   → 服务端 acceptResolution(phase=awaiting_battle_result)
    │            → 客户端本地战斗 → battle_result(victory/defeat/retreat)
    │            → 服务端 acceptBattleResult → commitSettlement
    └─ 直选   → 服务端直接 commitSettlement（pending 清空）
    ↓ 结算完成
  settlePendingRewards()（发奖 + confirm_reward）
    ↓
  run_status != 'ongoing'？
    ├─ 是 → finale（终章回顾）→ close_chapter（归档 recap）→ 回总览页
    └─ 否 → next_round → 回到顶部
```

### 5.3 奖励发放时序（D2 + D9）

```
commitSettlement 成功
  → 服务端返回 nextAdventure（含 reward_requests[].status = pending）
  → 客户端 AdventureV3RewardService 处理：
      for each pending request:
        call POST /api/v1/adventure-campaign/rewards/mail
          ├─ 200 created        → 记录 mail_id → POST /api/v1/mails/{id}/claim → status=granted
          ├─ 200 already_created → 直接标记可领取
          └─ 网络失败/404(D9)   → 进本地「待发队列」，UI 显示「待发放」
  → 服务端 confirm_reward（action=confirm_reward）
      └─ status=granted → reward_state.granted_permanent_rewards 追加
                         → relic 类型加入 current_package.relics
  → D9 兜底：邮件没发出去的条目仍留在本地队列，
    等接口上线后用**同一 claim_key** 重试（幂等，不会重复发信）
```

---

## 6. 关键不变量与踩坑清单

这一节是本次迁移中**实测踩到并已修正**的坑，后续维护务必对照检查。

| # | 结论 | 症状 / 报错 |
|---|---|---|
| **C1** | `next_round` 的前置是「上一轮已完成」：`nextRound()` 要求 `completed_events.length === current_round` 且 `current_round < 章轮数` | 新开存档直接发 `next_round` → `必须完成本轮且不得重复推进` |
| **C2** | `next_round` 的预迁移是必需的：若不先 `nextRound()`，prompt 里的 `current_round`/`supply_value` 与目标轮不符 | AI 生成的快照对不上 `acceptNewEvent` 的校验 |
| **C3** | `view` 是只读控制通道动作 | 返回八章卡视图且不改变存档 revision |
| **C4** | `getAdventureView()` 也会跑 `check()` | 存档不一致时抛错；适配层必须包装成 `V3ContractError`，否则错误码退化成 `TRANSITION_FAILED` |
| **C5** | 无状态服务端无法判定「过期 revision」 | 过期判定必须由客户端用 `request_guard` 做 |
| **C6** | **战斗事件模板无 `event_id` 字段** | v3 parser 要求 root 恰好是 `{event_details, combat_start, enemies}`；多写 `event_id` → `root字段不匹配` |
| **C7** | `choose` 的 `selected_option` 校验发生在预迁移**之后** | 少传/改写字段 → `selected_option不一致`；客户端必须保存完整 `event_output` |
| **C8** | **`close_chapter` / `promoteChapter` 硬校验「无 pending 奖励回执」** | `reward_requests` 存在 `status == 'pending'` → `章节关闭前先同步已有奖励回执`。**必须**在进章/关章前先 `confirm_reward` 全部条目 |
| **C9** | **直选结算服务端一次性完成结算** | `commitSettlement` 后 `pending_interaction` 已清空，客户端收到 SSE `state` 时 `pending == null`，应直接走「结算后」分支，**不要**再请求一次事件 |
| **C10** | **`confirm_reward` 会让 `state_version` +1** | 确认回执后运行态版本号变化，客户端必须以服务端返回值为准，不能缓存旧 `state_version` |
| **C11** | 旧 v4 存档 key 前缀是 `adventure_runtime_v1:<run_id>` | v3 用 `adventure_v3_save`，两者不冲突；D11 清理按前缀批量删 |
| **C12** | **`current_team` 的 `profession`/`gender`/`race`/`personality` 是必需字段**，缺失时给空字符串而不是省略键 | 省略键 → 服务端 `runtime_contract.mjs` 判定 `current_team[0].profession缺失`，整个请求被拒 |
| **C13** | **测试里判定终局不要用中文子串包含匹配** | 顶栏调试胶囊「战斗胜利」也含「胜利」，`find.textContaining('胜利')` 在战斗开始前就成立 ⇒ 等待循环空转 ⇒ 战报条目为空。必须锚定唯一来源（战报标题的 `resultText`） |
| **C14** | **`pending_interaction` 为 null 时必须显式输出 `null` key，不能省略** | 引擎用严格比较 `r.pending_interaction === null` 判断「当前没有待处理交互」。Dart 端省略该 key ⇒ 回传后变成 `undefined` ⇒ `start` / `next_round` 被误判为 **`新事件状态非法`**（错误信息完全指不到真实原因） |
| **C15** | **`story_patch.npc_state_updates` 是严格全等字段，不是叙事自由字段** | 引擎用 `JSON.stringify(patch.npc_state_updates) === JSON.stringify(fx.npc_updates)` 逐字节比对（顺序敏感）。授权为空数组时必须输出 `[]`，多写一条就抛 **`NPC变化未获授权`** → 结算被拒 → 状态不推进 → 玩家卡在当前轮。见 §6.2 |

### 6.2 C15 详解：`NPC变化未获授权` 事故（2026-11-09 线上）

**症状**：结算提交被引擎拒绝，SSE 只发 `event: error` 不发 `event: state`，玩家卡在当前轮无法继续。线上 3 次：
`CH01_E001`（AI 写 `[{村长艾德, trusted}]` / `[{村长艾德, cooperative}]`）、
`CH01_E002`（AI 写 `[{托娃, met}]`，「托娃」甚至不是资产表角色）。

**根因**：三方口径打架，而提示词是唯一可被 AI 读到的「口径」：

| 位置 | 说法 | 效果 |
|---|---|---|
| 引擎 `runtime.mjs` | 严格全等，顺序敏感 | 98% 的 result 授权是 `[]`，AI 必须写 `[]` |
| 结算模板规则段 | 「关系阶梯…移动一级…只有真实改变才输出」 | **教 AI 自行推导关系状态** |
| 结算模板示例 | `npc_state_updates: [{村长艾德, trusted}]` | **示例本身就是非空**，AI 直接照抄 |
| 「失败但继续」段 | 「至少通过 add_flags、**npc_state_updates**、summary 资源变化…留下后果」 | 暗示可以自由使用该字段 |

数据侧的事实：全库 **1747 个 result 里只有 30 个有 `npc_updates`，1717 个是空数组**
（章节规则原话：「NPC关系变化只执行结果npc_updates，默认空数组」）。
即：**AI 几乎必然犯错**，而这一个字段的偏差会让整局冒险卡死。

**修复（A + B 组合）**：

| | 改动 | 文件 |
|---|---|---|
| **A** | 删掉「关系阶梯/移动一级/改善或恶化一级」等引导自行推导的措辞 | 数据包 `src/prompts.mjs` → `tools/fix_npc_updates_prompt.mjs` |
| **A** | 结算模板示例改为 `npc_state_updates: []`（对齐 98% 的真实授权） | 同上 |
| **A** | 契约段明确「授权为空时**必须**输出 `[]`，即使剧情里有救援或关系改善也不得自造」 | 同上（5 个模板各一处） |
| **A** | 「失败但继续」段把 `npc_state_updates` 从「后果载体」里摘掉 | 同上 |
| **B** | 服务端在信任边界强制对齐：`normalizeSettlementNpcUpdates()` 以事件表授权覆盖 AI 输出 | `src/engine/v3_adapter.mjs` |
| **B** | 归一化后下发 `output`（避免客户端展示与服务端存档口径漂移） | `src/server/routes.mjs` |
| **B** | 触发归一化时打 `output_repaired` 日志（观察 A 的收敛效果） | `src/server/routes.mjs` |

**B 的设计约束**（刻意不做过度兜底）：

1. **只改这一个字段**。其余字段（`summary` / `add_flags` / `route_delta` / `memory_notes`…）仍走引擎原校验，写错照样被拒——避免掩盖真实缺陷。
2. **只覆盖，不合并**。引擎要求全等，合并语义不存在。
3. **授权解析失败时不动手**。此时交回引擎抛它自己的错误信息，不用兜底逻辑掩盖「事件/选项/outcome 本身非法」这类更严重的问题。
4. **影子校验同口径**。`shadowValidateOutput()` 用同一归一化逻辑，否则影子结果会与真实推进结果矛盾。

**运维手段**：
- `npm run replay:npc-incident` —— 用 `logs/ai-trace` 里的**真实失败输出**重放，验证结算能提交。
- `npm run check:npc-prompt` —— 校验数据包提示词的收紧状态（幂等）。


### 6.1 客户端侧硬性约束

| 约束 | 说明 |
|---|---|
| `selected_option` 必须**原样复制** | 引擎用 `JSON.stringify(op.selected_option) === JSON.stringify(p.selected_option)` 逐字节比对，任何字段增删都会导致整局卡死 |
| `world_story_state` / `applied_request_ids` 必须**原样回传** | 缺失 → `跨章存档版本不一致` / `重复结算` |
| `pending_interaction` 为 null 时必须输出 **`"pending_interaction": null`** | 省略 key → 引擎严格 `=== null` 判定失败 → `新事件状态非法`（见 C14） |
| `reward_state` **不由客户端构造** | 客户端事件目录是 schedule-only，算不出经济额度 |
| 每章必须**全新 run_id** | 引擎校验 `!used_run_ids.includes(runId)` |
| 续玩进行中的 run **不能传 run_id** | 引擎会拒绝：`续玩只能恢复原run，不能新开本章` |
| 圣物**不随章节自动继承** | `promoteChapter` 只搬运 tools，客户端须显式回传 `relics` |
| 队伍 1–4 人 | 空队伍被拒：`队伍数量越界` |

---

## 7. 验证结果

### 7.1 服务端

```
$ npm test
ℹ tests 154
ℹ suites 27
ℹ pass 154
ℹ fail 0
```

（原有 150 + 新增 3 个 `confirm_reward` 用例 + 1 个 `pending_interaction` 缺省回归用例）

### 7.1.1 C15 修复后的增量验证

```
$ npm test
ℹ tests 161
ℹ suites 28
ℹ pass 161
ℹ fail 0
```

（新增 7 条：`v3_adapter.test.mjs` 6 条归一化用例 + `server_v3.test.mjs` 1 条 HTTP 端到端用例）

**真实事故重放**（`npm run replay:npc-incident`，读取 `logs/ai-trace` 里的真实失败输出）：

```
✔ settle_check-3-4-1794194255476003__1794194255481.json
  事件 CH01_E001 / 选项 1 → 结算已提交
  已归一化 npc_state_updates：
    AI 写入：[{"npc":"村长艾德","state":"trusted"}]
    授权值：[]
✔ settle_check-3-4-1794224473509803__1794224473514.json   （cooperative）
✔ settle_check-6-9-1794224555231202__1794224533.json      （托娃 / met）
[replay] 全部事故 trace 均已成功提交结算。
```

**数据包八章全量模拟**（`node 猎魔人世界_.../tools/rebuild.mjs`）：

```json
{ "ok": true, "chapters": 8, "standard_events": 234, "ai_exchanges": 648,
  "event_definitions": 273, "templates": ["新一轮事件","检定","结算","战斗事件","终章"] }
```

**vendor 同步校验**：`npm run check:v3` → `vendor 一致（8 个文件）`。


### 7.2 客户端静态检查

```
$ flutter analyze
No issues found!
```

### 7.3 客户端测试

```
$ flutter test
00:47 +1726: All tests passed!
```

**全部 1726 条通过，0 失败**（原 1722 + 新增 4 条 v3 存档序列化回归用例）。

本次修复了 5 个**改动前就存在**的失败（已用 `git stash` 对比基线逐条确认与本次 v3 迁移无关）：

| # | 文件 | 用例 | 根因 | 修法 |
|---|---|---|---|---|
| F1 | `test/adventure/adventure_runtime_yaml_test.dart` | `AdventureTeamBuilder omits profession/gender/race when cardMap has no values` | 生产代码在 commit `996c118` 起**已改为始终输出** `profession`/`gender`/`race`（v3 提示词与 `runtime_contract.mjs` 都把它们列为**必需字段**，省略键会被服务端契约校验拒绝），但测试仍断言旧行为 | 更新测试：断言三个键**存在且为空串**，并注明省略键会被契约校验拒绝 |
| F2 | `test/dev/battle_test_page_test.dart` | 战报眼睛开关 + 终局自动展开并展示胜负标题 | 见 F5 | 改用 `_battleFinished()` 判定 |
| F3 | `test/dev/battle_test_page_test.dart` | 战斗中战报展开时，新条目揭示后自动滚到底部 | 见 F5 | 改用 `_battleFinished()` 判定 |
| F4 | `test/dev/battle_test_page_test.dart` | 战报技能元数据只列战斗消费的字段，未使用/空值字段不展示 | 见 F5 | 改用 `_battleFinished()` 判定 |
| F5 | `test/dev/battle_test_page_test.dart` | 战报按时间线列出被动触发、周期扣血与行动挂上的 BUFF | **共因**：等待条件 `find.textContaining('胜利')` 会被顶栏**「战斗胜利」调试胶囊**命中（该胶囊由 commit `996c118` 引入、随 `fc9180d` 合并进来），条件在战斗开始前就成立 ⇒ 循环体一次都不执行 ⇒ 战报条目始终为空 | 新增 `_battleFinished()` 辅助函数，只匹配战报标题专用的 `我方胜利` / `敌方胜利`（`BattleResult.resultText`），三处等待循环统一改用它 |

> ⚠️ **教训**：这类「用中文子串等待某个状态」的写法，在 UI 上出现同义文案时会静默空转。
> 判定终局应锚定**唯一来源**（此处是战报面板标题的 `resultText`），不要用包含匹配。

**新增/修改的 2 个测试**（随 P7 入口下线同步调整）：

- `test/main_shell_page_test.dart` —— 删除 `冒险副本 → /dungeon-list` 断言；
- `test/services/task/task_destination_test.dart` —— `玩AI冒险副本一次` 现在期望 `/adventure`。

---

## 8. 遗留事项与后端待配合项

### 8.1 阻塞项（不阻塞上线，但功能降级）

**D9 发奖接口未上线**

```
POST /api/v1/adventure-campaign/rewards/mail
```

当前行为：
- 客户端按契约调用 → 404 → 自动降级为**本地「待发放」队列**；
- 剧情**不阻塞**（照常推进）；
- UI 显示「待发放」状态。

接口上线后：客户端用**同一 `claim_key`** 重试即可补发（幂等，不会重复发信）。

**回执确认是例外**——即使邮件没发出去，客户端也会向服务端 `confirm_reward` 确认 `granted`，以解除 C8 的章节交接阻塞。

### 8.2 服务端已就绪、无需后端配合

| 项 | 状态 |
|---|---|
| `confirm_reward` 控制通道 action | ✅ 服务端已实现并有单测覆盖 |
| `dailyRewardCycleId` 奖励周期 | ✅ 服务端权威下发 |
| `reward_state` 注入 | ✅ 服务端按章节配置构造 |
| SSE `event: state` 附带 `output` | ✅ 已上线 |
| C15 `npc_state_updates` 服务端权威归一化 | ✅ 已上线（`output_repaired` 日志可观测） |
| C15 提示词收紧（A 方案） | ✅ 已同步 vendor（`npm run check:v3` 通过） |

### 8.3 后续建议（可选）

| # | 建议 | 优先级 |
|---|---|---|
| 0 | 观察 `output_repaired` 日志频率：若线上仍频繁触发，说明模型对「授权为空→`[]`」的服从度不足，需要在提示词里进一步前置该约束（例如把 `settlement_preview` 的授权数组直接列进 user prompt） | 中 |
| 1 | 后端实现 `POST /api/v1/adventure-campaign/rewards/mail`（见 [§8.1](#81-阻塞项不阻塞上线但功能降级)） | 高 |
| 2 | 端到端联调：完整跑完 CH01（24 轮）→ 章末归档 → 进入 CH02 | 高 |
| 3 | ~~修掉 5 个既有失败测试~~ → **已完成**（见 [§7.3](#73-客户端测试)） | ✅ 已完成 |
| 4 | 限流评估（R3）：AI 请求量 700–900/局 vs 限流 30/分钟 | 中 |
| 5 | 清理 `dungeon_list_page.dart` 等旧副本代码（需先解耦 `adventure_story_page.dart`） | 低 |

---

## 附录 A：改动文件清单

### A.1 `aiwordspromts`

| 文件 | 改动 |
|---|---|
| `src/engine/v3_adapter.mjs` | +69：`dailyRewardCycleId()`、`buildRewardStateForContinue()`、`continue` 注入点；**+63（C15）**：`normalizeSettlementNpcUpdates()`、`advanceV3`/`shadowValidateOutput` 归一化接入 |
| `src/server/routes.mjs` | +6：SSE `event: state` 附带 `output`；**+16（C15）**：`output_repaired` 日志、下发改用归一化后的 `output` |
| `src/tests/v3_adapter.test.mjs` | +134：3 个 `confirm_reward` 用例；**+165（C15）**：6 个归一化用例 |
| `src/tests/server_v3.test.mjs` | +5：HTTP 端到端用例调整；**+92（C15）**：结算自造 NPC 状态的端到端回归用例 |
| `tools/fix_npc_updates_prompt.mjs` | **新增（C15）**：A 方案提示词收紧脚本（幂等，带 `--check`） |
| `tools/replay_npc_incident.mjs` | **新增（C15）**：用真实失败 trace 重放验证修复 |
| `src/engine/vendor/v3/src/prompts.mjs` | **+5/-5（C15）**：提示词收紧后由 `npm run sync:v3` 同步 |
| `package.json` | **+3（C15）**：`fix:npc-prompt` / `check:npc-prompt` / `replay:npc-incident` 脚本 |
| `V3_MIGRATION_PLAN_20261108.md` | +16：P2/P5/P7 状态更新、新增实测结论 C8–C11、客户端文件清单扩充 |
| `V3_MIGRATION_CHANGELOG_20261109.md` | **新增 C15 与 §6.2**：事故根因、A+B 修复方案、验证结果 |

### A.1.1 数据包侧改动（不进版本库）

| 文件 | 改动 |
|---|---|
| `猎魔人世界_八章完整交互包_20261101_v3/src/prompts.mjs` | **A 方案**：删「关系阶梯/移动一级」、示例改 `[]`、契约段加「授权为空必须输出 `[]`」、失败段摘掉 `npc_state_updates` |
| `猎魔人世界_八章完整交互包_20261101_v3/01_共享积木/引擎_*.txt` | 由 `tools/rebuild.mjs` 重新生成（5 个模板） |
| `猎魔人世界_八章完整交互包_20261101_v3/发布清单.json` | 由 `tools/rebuild.mjs` 重新生成 |

### A.2 `aiwords`（新增）

| 文件 | 行数 |
|---|---|
| `lib/pages/adventure/adventure_v3_story_page.dart` | 1237 |
| `lib/pages/adventure/adventure_campaign_page.dart` | 789 |
| `lib/adventure/v3/adventure_v3_output.dart` | 386 |
| `lib/adventure/v3/adventure_v3_entry.dart` | 162 |
| `lib/pages/adventure/adventure_battle_seed.dart` | 143 |
| `lib/adventure/v3/adventure_v3_session.dart` | 115 |

### A.3 `aiwords`（修改）

| 文件 | 改动摘要 |
|---|---|
| `lib/adventure/v3/adventure_models.dart` | +31：`worldStoryState` / `appliedRequestIds` / `AdventureSseState.output` |
| `lib/adventure/v3/adventure_operations.dart` | +52：`AdventureV3ContinueArgsBuilder`、`awaiting_battle_result` 分支 |
| `lib/adventure/v3/adventure_reward_service.dart` | +58：`needsMailDelivery` / `upsertPending` / `deliver` + 类型修复 |
| `lib/adventure/v3/adventure_store.dart` | +25：D11 旧存档批量清理 |
| `lib/battle/battle_core.dart` | +36：`BattleOutcome` 枚举、`BattleResult.outcome` / `isRetreat` / `copyWith` |
| `lib/pages/battle/battle_playback.dart` | +38：抽出 `_settleToFinalState()`、新增 `forceRetreat()` |
| `lib/pages/battle/battle_scene.dart` | +57：`showRetreatButton` + 撤退二次确认弹窗 |
| `lib/pages/battle/story_battle_page.dart` | +6：透传 `showRetreatButton` |
| `lib/pages/adventure_page.dart` | -190：改为薄壳，委托 `AdventureCampaignPage` |
| `lib/pages/main_shell_page.dart` | -7/+7：旧「冒险副本」入口下线（D4） |
| `lib/main.dart` | -2：删除 `/dungeon-list` 路由（D4） |
| `lib/services/task/task_destination.dart` | -1：删除 `冒险副本` 跳转规则（D4） |
| `test/main_shell_page_test.dart` | -1：同步入口断言 |
| `test/services/task/task_destination_test.dart` | +3/-1：同步任务跳转断言 |
| `test/adventure/adventure_runtime_yaml_test.dart` | 修正过期断言：`profession`/`gender`/`race` 改为「存在且为空串」（F1 / C12） |
| `test/dev/battle_test_page_test.dart` | 新增 `_battleFinished()` 辅助函数，三处等待循环改用它（F2–F5 / C13） |

---

## 附录 B：术语表

| 术语 | 含义 |
|---|---|
| **campaign** | 一次完整的冒险（八章连续），由 `campaign_id` 标识 |
| **run / 章** | campaign 下的单章，由 `run_id` 标识，每章必须全新 |
| **round / 轮** | 章内的回合序号，`current_round` 从 1 开始 |
| **event** | 轮次内的事件，`event_id` 唯一 |
| **option** | 事件下的可选项，有 `检定` / `战斗事件` / `结算` 三种 `template_name` |
| **pending_interaction** | 当前待处理交互，三态 `phase`：`awaiting_choice` / `awaiting_battle_result` / `awaiting_settlement_commit` |
| **state_version** | 运行态版本号，每次状态推进 +1，客户端**不得**自行推算 |
| **revision** | 全会话计数器，`adventure.revision` |
| **claim_key** | 永久奖励幂等键，格式 `{cycle|lifetime}:{chapter}:{event}:{type}` |
| **D2 / D9** | 永久奖励通道 = 邮件；发奖交付边界 = spec_stub + 本地待发队列 |
| **D4 / D11 / D12** | 旧副本共存 / 旧存档处理 / 历史归档 |
