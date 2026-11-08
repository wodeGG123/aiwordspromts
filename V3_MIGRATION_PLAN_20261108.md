# 猎魔人世界 · 八章连续冒险 v3 改造方案

版本：2026.11.08 · 数据包：`猎魔人世界_八章完整交互包_20261101_v3`（版本 `2026.11.01.3`）
涉及仓库：`aiwordspromts`（AI 服务端）、`aiwords`（Flutter 客户端）

---

## 0. 已确认决策

| 编号 | 决策项 | 结论 |
|---|---|---|
| D1 | 架构与状态权威 | **方案 C**：客户端持有 `adventure` 存档并负责持久化/串行/拦截过期回包；**状态推进计算由服务端 v3 引擎算好后返回**，Dart 端不复刻 `commitSettlement` 等断言 |
| D2 | 永久奖励通道 | **邮件**：客户端在结算后调用游戏后端新增的「创建冒险奖励邮件」接口，走 `mails/{id}/claim` 领取 |
| D3 | 对外协议版本 | **升级** `contracts.runtime`：`adventure-runtime-v4` → `adventure-runtime-v5`（客户端与服务端同版本发布） |
| D4 | 旧副本共存 | **v3 八章替换冒险副本入口**，旧 `adventures` 副本入口下线 |
| D5 | 邮件创建方 | **客户端触发**：客户端以 `claim_key` 调游戏后端新增接口，由该接口创建邮件 |
| D6 | 奖励周期 `cycle_id` | **按自然日**：`daily:YYYY-MM-DD`，跨零点自然进入新周期；终身键（`lifetime:`）不随周期清除 |
| D7 | 战斗 `retreat` | **手动撤退按钮**：战斗页提供「撤退」出口，提交 `battle_result=retreat` |
| D8 | 限流与并发 | **不改**：维持 `RATE_LIMIT_PER_MINUTE=30`、`MAX_CONCURRENT_PER_IP=2`，遇到限流再调 |
| D9 | 发奖交付边界 | **spec_stub**：本次交付客户端调用侧 + 接口契约文档；后端接口未上线前走本地「待发队列」，UI 显示「待发放」 |
| D10 | 客户端事件数据 | **schedule_only**：仅下发 `schedule + asset_scope`；`options/results` 由服务端权威计算 |
| D11 | 旧存档处理 | **直接丢弃**：检测到 v4 格式存档 → 提示「版本已更新」并清空，v3 从 CH01 重开 |
| D12 | 历史归档 | **保留最近 3 次**重开记录（只读） |

---

## 1. 架构总览

### 1.1 数据流（D1 + D10）

```
┌─────────────────────────────────────────────────────────────────┐
│ 客户端 (Flutter)                                                  │
│  adventure_store  ── 持有唯一 adventure 存档（revision CAS 落盘）      │
│         │                                                          │
│         │ POST /api/chat                                          │
│         │ { package_version, adventure, operation }               │
│         ▼                                                          │
│ 服务端 (Node)                                                     │
│  v3_adapter ──► v3 引擎（adventure.mjs / runtime.mjs / economy.mjs） │
│         │  ① validateV3Request                                    │
│         │  ② prepareAdventureMessages → system/user prompt          │
│         │  ③ SSE 转发 AI 流（现有逻辑不变）                          │
│         │  ④ advanceV3(): 按 operation.type 计算 nextRuntime        │
│         ▼                                                          │
│ SSE: data:<五模板分片> … data:[DONE]                                │
│     event: state  data:{ adventure, state_version, request_guard }  │
│         │                                                          │
│         ▼                                                          │
│ 客户端比对 request_guard → 原子落盘 nextAdventure                   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 职责边界

| 层 | 负责 | 不负责 |
|---|---|---|
| 客户端 | adventure 存档持久化、revision 乐观锁、请求串行队列、过期回包丢弃、UI、战斗执行、邮件领取 | 事件效果计算、奖励额度判定、章节游标校验 |
| AI 服务端 | 请求合法性校验、prompt 装配、状态推进计算、下一版 adventure 生成 | 持久化、账号资源发放 |
| 游戏后端 | 账号金币/钻石/圣物/背包、奖励邮件创建与领取、奖励周期额度 | 剧情状态 |

---

## 2. AI 服务端（`aiwordspromts`）

### 2.1 文件清单

| 路径 | 动作 | 说明 |
|---|---|---|
| `src/engine/v3_engine.mjs` | **新增** | 统一 re-export v3 包 API，屏蔽深层路径 |
| `src/engine/v3_adapter.mjs` | **重写**（已初步完成） | 请求分流 + 校验 + 预迁移 + prompt 装配 + `advanceV3()` 状态推进 + `transitionV3()` 控制通道 |
| `src/engine/v3_catalog.mjs` | **新增** | 从 v3 `data.mjs` 导出章节清单，供 `/api/capabilities` |
| `src/engine/v3_adapter.test.mjs` | **新增** | 单测：校验分支、状态推进、过期拒绝 |
| `src/server/constants.mjs` | **修改** | `CONTRACTS.runtime` → `adventure-runtime-v5`；新增 `package_version` |
| `src/server/routes.mjs` | **修改** | `/api/chat` 双通道分流 |
| `src/server/http_utils.mjs` | **修改** | `capabilitiesPayload` 增加 `package_version` / `chapters` / `features` |
| `Dockerfile` | **修改** | ⚠️ 必须 `COPY` v3 包进镜像（见 2.6） |
| `.dockerignore` | **检查** | 确保中文目录未被排除 |
| `src/runtime_contract.mjs` | **保留** | 旧 `runtime_yaml` 通道标记为 legacy，不删（便于回滚与旧客户端排查） |

### 2.2 契约常量

```js
// src/server/constants.mjs
export const CONTRACTS = Object.freeze({
  streaming: "yaml-visible-fields-v3",
  runtime: "adventure-runtime-v5",       // ← 由 v4 升级
  templates: "five-template-v3",
  output: "five-template-v3",
  framing: "fixed_template_quoted_scalar_v1",
  package_version: "2026.11.01.3",       // ← 新增
  campaign: "continuous-eight-chapter-v3" // ← 新增
});
```

> **D3 风险提示**：`runtime` 改名会让**线上已发布的旧客户端**在 `ensureCompatible()` 处直接抛 `UNSUPPORTED_CONTRACT`。需确认：是否需要同时发布旧客户端的兼容补丁，或接受旧客户端立即失效（服务端与客户端必须同版本上线）。

### 2.3 请求分流

```js
// src/server/routes.mjs —— handleChat 内
const isV3 = input && input.adventure !== undefined;
prepared = isV3
  ? prepareV3Prompt(input, { blacklist: config.enablePromptFilter ? config.promptBlacklist : null })
  : preparePromptFromRequest(input, { blacklist: ... });
```

### 2.4 `prepareV3Prompt` 职责

1. **包版本校验**：`package_version === "2026.11.01.3"`，否则 `400 V3_VERSION_MISMATCH`。
2. **存档校验**（v3 `adventure.mjs#check` 已覆盖，转译为 `V3ContractError`）：
   - `adventure.schema_version === 3`
   - `adventure.revision` 为非负整数
   - `campaign.schema_version === 3`
   - `campaign.status ∈ {ongoing, failed, completed, abandoned}`
   - `campaign.chapter_results` 从 CH01 连续排列
   - `runtime.campaign_id === campaign.campaign_id`
   - `runtime.chapter_id` 索引 = `campaign.chapter_results.length + 1`
3. **operation 校验**：`type ∈ {start, next_round, choose, settle_check, battle_result, finale}`；`expected_template_name` 必须在 v3 `matrix[type]` 内。
4. **prompt 装配**：调用 `A.prepareAdventureMessages(adventure, operation, { expectedRevision: adventure.revision })`，取 `systemPrompt` / `userPrompt`。
   - ⚠️ v3 引擎内部会 `delete aiRuntime.reward_requests / applied_request_ids / chapter_journal / terminal_tools`，因此**内部账本不会泄漏给 AI**，但客户端上传的 adventure 本身仍含这些字段（传输体积）。
5. **返回**：`{ messages, systemPrompt, userPrompt, contextScope, requestGuard, requestId, operationType, expectedTemplateName, chapterId, fingerprintSource }`。

### 2.5 `advanceV3()` —— 状态推进（D1 核心）

AI 流结束后，服务端按 `operation.type` 计算下一版 runtime。**注意：预迁移（`selectOption` / `acceptBattleResult`）已在装配 prompt 阶段完成，此处不得重复执行**。

```js
export function advanceV3(premigratedAdventure, operation, aiOutput) {
  const runtime = premigratedAdventure.runtime;   // ← 预迁移后的 runtime
  switch (operation.type) {
    case 'start':
    case 'next_round': {
      const next = R.acceptNewEvent(runtime, aiOutput);
      return A.updateAdventure(premigratedAdventure, next, { expectedRevision: premigratedAdventure.revision });
    }
    case 'choose': {
      const next = R.acceptResolution(runtime, aiOutput);
      return A.updateAdventure(premigratedAdventure, next, { expectedRevision: premigratedAdventure.revision });
    }
    case 'settle_check': {
      const next = R.commitSettlement(runtime, aiOutput, {
        requestId: operation.request_id,
        expectedVersion: runtime.state_version
      });
      return A.updateAdventure(premigratedAdventure, next, { expectedRevision: premigratedAdventure.revision });
    }
    case 'battle_result': {
      // runtime 已预迁移到 awaiting_settlement_commit，直接提交结算
      const next = R.commitSettlement(runtime, aiOutput, {
        requestId: operation.request_id,
        expectedVersion: runtime.state_version
      });
      return A.updateAdventure(premigratedAdventure, next, { expectedRevision: premigratedAdventure.revision });
    }
    case 'finale': {
      // 终章不改状态，仅作为归档素材；归档由 close_chapter 动作触发
      return { adventure: premigratedAdventure, changed: false };
    }
  }
}
```

**⚠️ 关键设计约束**：
- `advanceV3` 必须在 **AI 输出完整校验通过后** 才执行。若 AI 输出非法，**不得推进任何状态**，且必须把 `nextRuntime` 丢弃（v3 要求「失败输出不可作为成功缓存」）。
- 预迁移后的 runtime **必须原样回传客户端**，客户端不得自行推算 `state_version`（见附录 9.3 ③）。
- `start` 只允许 `current_round === 1`；`next_round` 要求上一事件已提交。v3 `validateRequest` 已覆盖，服务端不做额外放行。
- `choose` 的 `operation.selected_option` 必须与引擎内 pending 快照**逐字节相等**（`JSON.stringify` 比对），客户端必须原样复制（见附录 9.3 ①）。

### 2.6 SSE 下行格式（D1 关键改动）

现有 SSE 是纯文本分片（`data: <文本>` … `data: [DONE]`）。v3 需要额外回传结构化状态。

**方案**：在 `[DONE]` 之前追加一个 `event: state` 事件：

```
data: {"event_id":"CH01_E003","scene_name":"艾德村庄",...}
data: {"event_id":"CH01_E003","scene_name":"艾德村庄",...}
event: state
data: {"adventure":{...},"state_version":13,"request_guard":{...}}

data: [DONE]
```

客户端 `adventure_sse_reader.dart` 需支持 `event: state` 分支：
- 收到 `state` 事件 → 解析 JSON → 比对 `request_guard` → 落盘 `adventure`。
- 未收到 `state` 事件（请求失败/取消）→ 保留原存档，UI 提示重试。

**兼容性**：旧客户端的 SSE 读取器会忽略未知事件类型（需确认 `adventure_sse_reader.dart` 实现），因此线上旧客户端不会因 `event: state` 崩溃，但也不会拿到状态（本就失效于 D3）。

### 2.7 Docker 修复（⚠️ 阻塞项）

当前 Dockerfile 只复制 `src`，v3 包在仓库根目录的 `猎魔人世界_八章完整交互包_20261101_v3/`，容器内不存在 → `ERR_MODULE_NOT_FOUND`。

```dockerfile
# 在 COPY src 之后追加
COPY --chown=nodejs:nodejs 猎魔人世界_八章完整交互包_20261101_v3 ./猎魔人世界_八章完整交互包_20261101_v3
```

或（更推荐，避免大目录进镜像）：把 v3 包的 `src/` 复制到 `src/engine/vendor/v3/`，并改 `v3_engine.mjs` 的 import 路径为 `./vendor/v3/*.mjs`。后者镜像更小，但需要同步脚本保证包升级时同步。

**建议**：采用 vendor 方案 + `npm run sync:v3` 脚本（从包目录复制 `src/*.mjs` 到 `src/engine/vendor/v3/`），并在 CI 校验 vendor 与包的哈希一致。

### 2.8 capabilities / health

```js
// capabilitiesPayload 增补
{
  contracts: CONTRACTS,
  package_version: "2026.11.01.3",
  chapters: [
    { id: "CH01", name: "艾德村庄", index: 1, count: 24, gold_gain_cap: 500, equipment_slots: 0 },
    ... CH02..CH08
  ],
  features: {
    continuous_campaign: true,
    chapter_selection: false,
    replay: false,
    chapter_retry: false,
    battle_result: ["victory", "defeat", "retreat"],
    reward_signals: [900050, 900060, 900061, 900062],
    reward_ledger: true,
    chapter_review_facts: true
  },
  provider_chunk_mode: "delta_text",
  server_stream_mode: "incremental_passthrough",
  server_validates_output: true,      // ← 由 false 改为 true（服务端已用 v3 引擎校验）
  limits: { ... }
}
```

### 2.9 限流（D8：暂不改）

保持 `RATE_LIMIT_PER_MINUTE=30`、`MAX_CONCURRENT_PER_IP=2`。已知风险：单次八章约 700–900 次请求。

**建议**：客户端侧对同一 IP 的冒险请求做**串行队列 + 最小间隔节流**（如相邻请求间隔 ≥ 1.5s），避免瞬时打满触发 429。

---

## 3. 游戏后端依赖（本次不实现，仅出契约）

### 3.1 新增接口：创建冒险奖励邮件

```
POST /api/v1/adventure-campaign/rewards/mail
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "claim_key": "daily:2026-11-08:CH01:CH01_E012:relic",
  "reward_type": "relic",          // material | relic | bond | equipment
  "reward_id": 10001,
  "reward_name": "狼牙项链",
  "count": 1,
  "level": 1                       // 仅 relic
}

→ 200
{
  "mail_id": "...",
  "status": "created"              // created | already_created | rejected
}
```

**幂等要求**：同一 `claim_key` 重复调用必须返回 `already_created` 且**不得重复发信**（v3 要求「需重试原 claim_key，不能生成新 key」）。

### 3.2 客户端领取

```
GET  /api/v1/mails                  → 列表
POST /api/v1/mails/{mail_id}/read   → 阅读
POST /api/v1/mails/{mail_id}/claim  → 领取附件（写入背包）
```

### 3.3 奖励周期额度（D6）

`cycle_id = daily:YYYY-MM-DD`（客户端按本地日期生成，需与服务端/后端对齐时区，建议以服务端为准由 `/api/capabilities` 或用户档案下发）。

**额度持有方**：`reward_state` 存在客户端 adventure 存档内，跨重开保留（D1 下服务端每次计算都收到完整 `reward_state`，故额度判定天然在服务端侧完成）。

**终身键**：`claimed_reward_keys` 中 `lifetime:` 前缀的键**不随周期清除**——由客户端在跨日重建 `reward_state` 时保留（对应 v3 `createRewardState.previous` 的 `lifetime:` 过滤逻辑）。

---

## 4. 客户端（`aiwords`）

### 4.1 新增文件 `lib/adventure/v3/`

| 文件 | 职责 |
|---|---|
| `adventure_models.dart` | `AdventureCampaign` / `AdventureChapterResult` / `AdventureReviewFacts` / `AdventureRewardState` / `AdventureRewardRequest` / `AdventureArchive` / `AdventureView` / `AdventureChapterCard` / `AdventureCompletedEvent` |
| `adventure_store.dart` | 唯一存档持久化：`adventure`（最新）+ `archives`（最近 3 次）；写入 CAS `revision` |
| `adventure_controller.dart` | 入口层：`startCampaign` / `continueAdventure` / `closeChapter` / `restartCampaign` / `getView`；串行队列 |
| `adventure_catalog.dart` + `adventure_catalog_data.dart` | 273 个事件的 `schedule + asset_scope`（D10），替代旧 `adventure_event_catalog*` |
| `adventure_reward_service.dart` | `reward_requests` → 调后端发邮件接口 → 本地「待发队列」→ 领取 → `confirmPermanentReward` |
| `adventure_sse_reader.dart`（改造现有） | 支持 `event: state` |
| `adventure_sse_state.dart` | `event: state` 的 DTO |

### 4.2 事件目录生成脚本

新增 `tools/gen_v3_catalog.mjs`（放在 `aiwords` 或 `aiwordspromts/tools`，二选一）：

```js
// 从 v3 data.mjs 导出客户端可发布的 schedule + asset_scope
const out = {
  package_version: data.version,
  template_contract_version: "five-template-v3",
  schema_version: "chapter-event-schedule-v1",
  chapters: data.chapters.map(c => ({ id: c.id, name: c.name, index: c.index, count: c.count })),
  events: Object.values(data.events).map(e => ({
    event_id: e.event_id,
    chapter_id: e.chapter_id,
    kind: e.kind,
    title: e.title,
    weight: e.weight,
    priority: e.priority,
    schedule: e.schedule,
    asset_scope: e.asset_scope,
    enemy_names: e.enemy_names
  }))
};
```

产出约 106KB（gzip 后 ~5KB），落到 `lib/adventure/v3/adventure_catalog_data.dart`。

### 4.3 模型改造 `lib/models/adventure_runtime_models.dart`

| 现状 | 目标 |
|---|---|
| `AdventureStoryState.completedEvents: List<String>` | `List<AdventureCompletedEvent>`（`event_id/option_id/outcome`） |
| `AdventureCurrencyPolicies.goldPolicyJson()` 输出 `enabled/allowed_spend_values/...` | 输出 v3：`allow_gain/allow_cost/max_gain_per_event/max_cost_per_event` |
| `AdventurePackageContext.defaultEngineVersion = '2026.09.04.1'` | `'2026.11.01.3'`；`engineId='adventure.engine.chapter'`；`worldId='world.witchhunter'`；`dungeonId='witchhunter.CHxx'` |
| `AdventureOperation.combatResult` 仅 victory/defeat | 增加 `'retreat'` |
| `AdventureCommittedState` 缺 campaign 维度 | 新增 `campaignId/campaignRevision/worldStoryState/rewardState(强类型)/chapterJournal/terminalTools/rewardRequests` |
| `pendingInteraction['phase']` 存模板名 | 改存 v3 三态枚举：`awaiting_choice / awaiting_battle_result / awaiting_settlement_commit` |

### 4.4 Store 改造 `lib/store/adventure_runtime_store.dart`

- `ensureCompatible()`：`runtime` 期望值 → `adventure-runtime-v5`；新增 `package_version === '2026.11.01.3'` 校验；`features` 校验 `continuous_campaign === true`。
- 请求体：`runtime_yaml` → `{package_version, adventure, operation}`。
- **保留**「3 次自动重发」机制，但重发必须复用**同一份冻结 adventure 快照**（v3：相同逻辑重试复用冻结快照，不重掷、不重选）。
- **`selected_option` 必须从 `pending.event_output.event_details.options` 原样复制**（见附录 9.3 ①），不能重新构造。
- **不得自行推算 `state_version`**，一律采用服务端返回值（见附录 9.3 ③）。
- 新增 `requestGuard` 记录与回包比对：
  ```dart
  if (guard.session_revision != currentAdventure.revision) discard;   // 重开后的迟到回包
  if (guard.run_id != currentAdventure.runtime?.run_id) discard;
  if (guard.state_version != sentStateVersion) discard;
  ```
- **D11 旧存档处理**：`restore()` 时若检测到存档 `schema_version != 3`（或缺 `campaign` 字段）→ 清除本地存档 → 提示「冒险版本已更新，请重新开始」→ 从 CH01 新建。

### 4.5 入口与页面

| 页面 | 动作 |
|---|---|
| `lib/pages/adventure_page.dart` | **替换**：单一「开始/继续冒险」入口 + 八章进度预览（点���/可进入/已通关/失败） |
| **新增** `lib/pages/adventure_campaign_page.dart` | 八章卡列表 + 回顾文本 + `critical_npcs` + 「继续/从第一章重开」 |
| `lib/pages/adventure_story_page.dart` | ① 起点改为 `continueCampaign`；② `finale` 后 `closeChapter` 归档 recap；③ 章节结束进回顾页；④ 战斗支持「撤退」；⑤ 结算后弹奖励确认（走邮件）；⑥ 保留打字机/场景图/BGM/播放缓存 |
| `lib/pages/dungeon_list_page.dart`（D4） | 旧冒险副本入口下线 |

### 4.6 重开确认文案（v3 协议固定）

> 「将从第一章重新开始，本次局内道具与剧情进度不继承，已到账永久资源保留」

### 4.7 奖励确认流程（D2 + D9）
```
commitSettlement 成功
  → 服务端返回 nextAdventure（含 reward_requests[].status = pending）
  → 客户端 AdventureRewardService 处理：
      for each pending request:
        call POST /api/v1/adventure-campaign/rewards/mail
          ├─ 200 created        → 记录 mail_id，进「待领取」
          ├─ 200 already_created → 直接标记可领取
          └─ 网络失败/接口未上线 → 进本地「待发队列」，UI 显示「待发放」
  → 玩家点击「领取」：
      POST /api/v1/mails/{mail_id}/claim
      → 成功后调用服务端 confirmPermanentReward
         （v3 economy.mjs#confirmPermanentReward，需服务端暴露该操作）
  → granted 后：
      - reward_state.granted_permanent_rewards 追加
      - relic 类型加入 current_package.relics
      - 更新账号圣物列表（SessionStore）
```

**⚠️ 需要服务端新增控制通道 action**：`confirmPermanentReward` 不在 v3 `matrix` 的 6 种 operation 内，建议走 `POST /api/adventure/transition` 的 `confirm_reward` action（非 AI 通道，见 9.5）。

**D9 兜底**：后端接口未上线时，奖励不真正入账，UI 显示「待发放」，剧情可继续（不阻塞）。

### 4.8 战斗撤退（D7）

- 战斗页新增「撤退」按钮（长按或二次确认，避免误触）。
- 撤退 → 战斗系统返回 `retreat` → 客户端提交 `operation.type = 'battle_result'`, `battle_result = 'retreat'`。
- v3 映射：`battle_result=retreat` → `patch.outcome` 必须为 `retreat`（服务端 `commitSettlement` 校验 `p.battle_result === patch.outcome`）。
- **注意**：章末战败/撤退按 `finish=failed` 结束整次冒险；普通事件撤退按 `finish=ongoing` 继续。

### 4.9 归档（D12）

`archives` 保留最近 3 次重开记录，只读展示。`archive.read_only = true`，不可「从这里继续」。

---

## 5. 实施顺序

| 阶段 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| P0 | Docker 修复 + `v3_engine.mjs` + `v3_catalog.mjs` + capabilities 增补 | — | ✅ 完成 |
| P1 | `v3_adapter.mjs` 重写：校验 + 预迁移 + prompt 装配 + `advanceV3` + SSE `event: state` + `transitionV3` 控制通道 | P0 | ✅ 完成 |
| P2 | 服务端单测 `v3_adapter.test.mjs` + `server_v3.test.mjs`（HTTP 端到端） | P1 | ✅ 完成（148 测试全绿） |
| P3 | 客户端模型层（`lib/adventure/v3/adventure_models.dart`） | P0 | ✅ 完成 |
| P4 | 客户端 `adventure_store` + `adventure_controller` + `adventure_v3_api` + `adventure_operations` + 事件目录生成 | P3 | ✅ 完成 |
| P5 | 客户端 UI：campaign 页 + story 页接入 + 撤退按钮 + 奖励弹窗 | P4 | ⬜ 未开始 |
| P6 | 奖励邮件链路 + `confirm_reward` operation | P1, P5 | 🟡 服务端就绪 + 客户端 `adventure_reward_service.dart` 就绪；邮件接口待后端 |
| P7 | 旧副本入口下线 + 旧存档清理 | P5 | ⬜ 未开始 |

### 5.1 已落地的关键实现说明

**服务端**

| 文件 | 说明 |
|---|---|
| `tools/sync_v3.mjs` | 把 v3 包 `src/` + `parser/` vendor 到 `src/engine/vendor/v3/`（2.4MB）。`npm run check:v3` 校验哈希一致 |
| `tools/gen_v3_catalog.mjs` | 生成客户端事件目录（schedule + asset_scope only）。`npm run check:v3-catalog` 校验一致 |
| `src/engine/v3_adapter.mjs` | 校验 / 预迁移 / prompt 装配 / `advanceV3` / `transitionV3`。⚠️ v3 引擎抛的是原生 `Error`，适配层统一包装为 `V3ContractError`（含 `view` 分支） |
| `src/engine/v3_catalog.mjs` | 章节清单 + 目录统计 + 奖励信号 + 战斗结果枚举 |
| `src/server/routes.mjs` | `/api/chat` 按 `adventure` 字段分流到 v3；`/api/adventure/transition` 控制通道 |

**客户端**

| 文件 | 说明 |
|---|---|
| `lib/adventure/v3/adventure_models.dart` | v3 存档模型：`AdventureSave` / `AdventureCampaign` / `AdventureRuntime` / `AdventurePendingInteraction`（三态 phase）/ `AdventureRewardState` / `AdventureRewardRequest` / `AdventureView` / `AdventureArchive` / `AdventureRequestGuard` |
| `lib/adventure/v3/adventure_operations.dart` | operation 构造器。⚠️ `choose` 的 `selected_option` **原样复制**自 pending（`optionById`） |
| `lib/adventure/v3/adventure_store.dart` | 唯一持久化入口；CAS 写入；D11 旧存档丢弃；D12 保留最近 3 次归档 |
| `lib/adventure/v3/adventure_controller.dart` | 入口层 + 串行队列；过期回包拦截（`request_guard` 比对） |
| `lib/adventure/v3/adventure_v3_api.dart` | AI 通道（`event: state` 分流）+ 控制通道客户端 |
| `lib/adventure/v3/adventure_reward_service.dart` | 永久奖励发放（D2 邮件 + D9 本地待发队列） |
| `lib/adventure/v3/adventure_catalog.dart` + `_data.dart` | 客户端内置事件目录（生成文件，勿手改） |

### 5.2 实测补充结论（2026-11-08 修正）

| # | 结论 |
|---|---|
| C1 | **`next_round` 的前置是「上一轮已完成」**：`nextRound()` 要求 `completed_events.length === current_round`，且 `current_round < 章轮数`。新开存档直接发 `next_round` 会被拒（`必须完成本轮且不得重复推进`） |
| C2 | **`next_round` 的预迁移是必需的**：虽然 `validateRequest` 只校验 `pending_interaction === null`，但若不先 `nextRound()`，prompt 里的 `current_round`/`supply_value` 会与目标轮不符，AI 生成的快照对不上 `acceptNewEvent` 的校验 |
| C3 | **`view` 是只读控制通道动作**：新增 `action: "view"`，返回八章卡视图且不改变存档revision |
| C4 | **`getAdventureView` 也会跑 `check()`**：存档不一致时同样会抛错，适配层必须把它也包装成 `V3ContractError`，否则错误码退化成 `TRANSITION_FAILED` |
| C5 | **无状态服务端无法判定「过期 revision」**：服务端没有「当前版本」概念，只能校验存档**内部一致性**（`runtime.campaign_revision === campaign.revision`、章游标 = `chapter_results.length + 1`）。过期判定必须由客户端用 `request_guard` 做 |
| C6 | **战斗事件模板无 `event_id` 字段**：v3 parser 对「战斗事件」要求 root 恰好是 `{event_details, combat_start, enemies}`，且 `event_details` 恰好是 `{template_name, current_round, supply_value, corruption_value, current_theme, current_type, scene_name, steps}`——**多写 `event_id` 会报 `root字段不匹配`** |
| C7 | **`choose` 的 `selected_option` 校验发生在预迁移之后**：客户端少传/改写字段会被引擎以 `selected_option不一致` 拒绝；客户端必须保存完整 `event_output` |

---

## 6. 风险清单

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | D3 契约改名导致线上旧客户端全部 `UNSUPPORTED_CONTRACT` | 高 | 确认发布节奏；或服务端临时同时接受 v4/v5（`runtime` 数组） |
| R2 | Docker 未包含 v3 包 | 致命 | P0 阶段修复 + CI 校验 |
| R3 | AI 请求量 700–900/局 vs 限流 30/分钟 | 中 | 客户端串行 + 节流（D8 暂不改限流） |
| R4 | 邮件发奖接口后端未实现 | 中 | D9 本地待发队列兜底，不阻塞剧情 |
| R5 | `confirm_reward` 不在 v3 operation 矩阵内 | 中 | 服务端新增非 AI operation |
| R6 | 客户端 schedule-only 无法本地校验结算效果 | 低 | 服务端权威计算，客户端只展示 |
| R7 | v3 `campaign.revision` 与 `adventure.revision` 双版本语义混淆 | 中 | 严格区分：campaign.revision 跨章、adventure.revision 全会话 |
| R8 | SSE `event: state` 与现有纯文本解析器共存 | 中 | 客户端 reader 显式分流，未知事件忽略 |
| R9 | 客户端时区与 `daily:YYYY-MM-DD` 不一致导致周期错乱 | 低 | 建议服务端下发权威周期标识 |
| R10 | v3 `data.mjs` 1.96MB 进 Node 内存（每进程） | 低 | 单进程常驻，内存占用约 20-40MB，可接受 |

---

## 7. 待后端配合事项（汇总）

1. 新增 `POST /api/v1/adventure-campaign/rewards/mail`（创建奖励邮件，`claim_key` 幂等）。
2. 确认材料 / 因缘 / 装备 / 圣物在邮件附件中的类型映射是否与 v3 `rewardCatalog` 的 id 一致。
3. 提供权威奖励周期标识（避免客户端时区问题）。
4. 旧 `adventures` 副本配置与 `enter/clear` 接口的下线时间点。
5. `chapters` / `adventures` 与 v3 八章的体力、次数消耗关系（v3 无体力消耗定义）。

---

## 8. 附：v3 关键不变量（实现时对照检查）
- `campaign.status`：`ongoing / failed / completed / abandoned`。
- `chapter_results` 从 CH01 连续排列；`ongoing` 下全部 `cleared`。
- `runtime.play_mode` 固定 `story`；`run_difficulty ∈ {normal, hard, nightmare}`。
- `runtime.run_status`：`ongoing / cleared / failed`；`team_status`：`active / defeated`。
- `completed_events` 项：`{event_id, option_id, outcome}`，outcome 七值枚举。
- `story_state.unresolved_hooks` ≤ 3；`memory_notes` 每次新增 ≤ 3。
- `reward_state` 五类额度：gold / material(2) / relic(1) / bond(1) / equipment(0 或 1，CH04/CH08)。
- 永久奖励 `count` 恒为 1；圣物必须 `tier === 1 && level === 1`。
- 硬失败优先级：`supply ≤ 0 || corruption ≥ 100 || team_status === defeated` 高于 `cleared`。
- 跨章仅保留 `carry_through_chapter > 已通关章序号` 的物品。
- 失败时 `terminal_tools` 存审计快照，`current_package.tools` 清空。

---

## 9. 附录：v3 引擎实测结论（2026-11-08 验证）

以下结论均由**直接调用 v3 包 API** 实测得出，不是文档推断。实现时以此为准。

### 9.1 各 operation 的状态前置条件（决定服务端处理顺序）

| operation | 装配 prompt 前必须已完成的状态迁移 | 实测结果 |
|---|---|---|
| `start` | 无（runtime 初始即可） | ✅ |
| `next_round` | **可先 `nextRound()` 也可不**——`validateRequest` 只校验 `pending_interaction === null`，未推进也能装配 | ✅ 两种都通过 |
| `choose` | **必须先 `selectOption(runtime, option_id)`** | ❌ 未选 → `选项/事件快照不一致` |
| `settle_check` | **必须先 `acceptResolution(检定输出)`**（phase → `awaiting_settlement_commit`） | ✅ 装配通过 |
| `battle_result` | **必须先 `acceptResolution(战斗输出)` + `acceptBattleResult(result)`**（phase → `awaiting_battle_result` → `awaiting_settlement_commit`） | ❌ 缺 `acceptBattleResult` → `结算phase错误` |

**⚠️ 关键结论：服务端不能"一次 AI 请求 → 一次状态推进"。**

真实时序是**两段**：

```
① 选择/检定/战斗阶段
   客户端 → 服务端：operation=choose（含 selected_option）
   服务端：selectOption → 装配 prompt → AI → acceptResolution
   服务端 → 客户端：nextRuntime(phase=awaiting_battle_result 或 awaiting_settlement_commit)

② 结算阶段
   客户端 → 服务端：operation=settle_check / battle_result
   服务端：装配 prompt → AI → commitSettlement
   服务端 → 客户端：nextRuntime(phase=null, completed_events+1)
```

**这正好契合客户端现有的两段式交互骨架**（先选选项 → 出战/检定 → 再结算），因此 `adventure_story_page.dart` 的交互流程可保留，只需把状态推进的责任方从客户端换成服务端。

### 9.2 服务端可独立完成的非 AI 迁移（全部实测通过）

| 迁移 | API | 实测结果 |
|---|---|---|
| 新建冒险 | `createAdventure(campaignId)` | ✅ revision=0 |
| 进入章节 | `continueAdventure(s, {expectedRevision, runId, seed, team, gold, diamond, relics, rewardState})` | ✅ CH01 round=1 supply=100 |
| 续玩当前章 | `continueAdventure(s, {expectedRevision})`（不传 runId） | ✅ 保留原 run_id / round / pending |
| 拒绝选章 | 传 `chapterId` | ✅ `继续入口不接受选章参数` |
| 拒绝 replay | 传 `mode: 'replay'` | ✅ `禁止replay` |
| 章节归档 | `closeAdventureChapter(s, {expectedRevision, finaleOutput})` | ✅ recap_source=ai，runtime=null，results=1 |
| 推进下一章 | `continueAdventure` 于已归档 adventure | ✅ 自动选 CH02，supply 重置 100，archetype 换新 |
| 视图 | `getAdventureView(s)` | ✅ CH01=cleared/enterable=false；CH02=in_progress/enterable=true；CH03-08=locked |
| 整次重开 | `restartAdventure(s, {campaignId, expectedRevision})` | ✅ key_items 清空、retired_campaign_ids+1、used_run_ids 保留、archive.read_only=true |
| 重开后退回 CH01 | `continueAdventure` 于新 adventure | ✅ chapter=CH01，tools=[] |
| 奖励预留 | `commitSettlement` 内部 | ✅ 生成 `reward_requests`，claim_key=`daily:2026-11-08:CH01:CH01_E012:material` |
| 奖励确认 | `economy.mjs#confirmPermanentReward(r, {claim_key, status:'granted', reward})` | ✅ granted 追加，幂等重复确认 OK |
| 信号不进背包 | `current_package.tools` 检查 | ✅ 无 `id >= 900050` 的条目 |
| 跨周期保留终身键 | `createRewardState({chapterId, cycleId, previous})` | ✅ 新周期仅保留 `lifetime:` 前缀键，material 额度重置为 2 |

### 9.3 实测发现的三个必查点

**① `choose` 的 `selected_option` 必须与引擎内快照逐字节相等**

客户端必须从 `pending_interaction.event_output.event_details.options` **原样复制**选中的选项对象，不能重新构造（字段顺序、附加字段都要一致）：

```json
{"text":"先控制眼前的危险，保护仍在现场的人（社交检定）","id":1,"template_name":"检定","visible":true,"available":true,"check_type":"常规检定","check_difficulty":8}
```

引擎校验方式为 `JSON.stringify(op.selected_option) === JSON.stringify(p.selected_option)`，任何字段差异都会报 `selected_option不一致`。

→ **客户端必须保存完整 `event_output`，而不是精简后的选项列表。** 这与 v3 协议"pending_interaction.event_output 必须是完整根对象"的要求一致。

**② `updateAdventure` 要求 `state_version` 严格递增**

```37:41:/Users/panda/Documents/projects/aiwordspromts/猎魔人世界_八章完整交互包_20261101_v3/src/adventure.mjs
export function updateAdventure(s,nextRuntime,{expectedRevision}={}){
 check(s,expectedRevision);const old=s.runtime;need(old,'没有活动run');
 need(nextRuntime.campaign_id===old.campaign_id&&nextRuntime.run_id===old.run_id&&nextRuntime.chapter_id===old.chapter_id,'旧冒险、旧章或旧run回包');
 need(nextRuntime.campaign_revision===old.campaign_revision,'跨章版本不符');
 need(nextRuntime.state_version>old.state_version,'重复或过期运行态，不允许回滚');
```

→ 服务端返回的 `nextRuntime` 必须 `state_version` 严格大于请求时的版本。**特别注意 `selectOption` 会 `state_version++`**，所以 `choose` 阶段返回的 runtime 版本已比请求时高 1，客户端必须原样接受不能自行推算。

**② `campaign.revision` 与 `adventure.revision` 是两个独立计数器**

- `adventure.revision`：全会话，每次任何迁移 +1。
- `campaign.revision`：跨章，仅在 `promoteChapter` / `failCampaign` 时 +1。
- `runtime.campaign_revision` 必须等于入章时的 `campaign.revision`，跨章后变化。

→ 客户端持久化时两个都要存；跨章后 `runtime.campaign_revision` 会重置为新值。

**③ `state_version` 的实际递增规律（实测）**

一轮完整事件（检定路径）的 `state_version` 变化：

| 步骤 | state_version |
|---|---|
| 建章 | 1 |
| `acceptNewEvent`（start） | 2 |
| `selectOption`（choose 预迁移） | 3 |
| `acceptResolution`（choose 推进） | 4 |
| `commitSettlement`（settle 推进） | 5 |

→ 客户端**不得自行推算** `state_version`，必须使用服务端返回的值。

### 9.4 修正后的服务端请求处理顺序

```
POST /api/chat  { package_version, adventure, operation }
  │
  ├─ 1. validateV3Request(body)
  │     包版本 / schema_version / revision / operation 类型 / 模板匹配
  │
  ├─ 2. 按 operation.type 预迁移（仅 choose / battle_result 需要）
  │     choose        → selectOption(runtime, operation.option_id)
  │     battle_result → acceptBattleResult(runtime, operation.battle_result)
  │     （若当前 phase 已是 awaiting_settlement_commit，则跳过）
  │
  ├─ 3. prepareAdventureMessages(预迁移后的 adventure, operation)
  │     → systemPrompt / userPrompt / requestGuard
  │
  ├─ 4. SSE 转发 AI 流（现有逻辑）
  │
  ├─ 5. AI 输出解析 + 校验（v3 引擎断言）
  │
  ├─ 6. advanceV3(预迁移后的 adventure, operation, aiOutput)
  │     start / next_round → acceptNewEvent
  │     choose             → acceptResolution
  │     settle_check       → commitSettlement
  │     battle_result      → commitSettlement
  │     finale             → 不改状态（归档由 close_chapter 触发）
  │
  ├─ 7. 追加 event: state（含 nextAdventure + request_guard）
  │
  └─ 8. data: [DONE]
```

**⚠️ 第 2 步的产物必须原样回传客户端**（`state_version` 已因 `selectOption` +1），否则客户端的 `state_version` 连续性会断裂。

### 9.5 非 AI 迁移的调用通道

`createAdventure` / `continueAdventure` / `closeAdventureChapter` / `restartAdventure` / `confirmPermanentReward` **都不需要 AI**，但必须由服务端执行（客户端不持有 JS 引擎）。

建议在 `/api/chat` 之外新增**非 AI 端点**：

| 端点 | 请求 | 响应 |
|---|---|---|
| `POST /api/adventure/transition` | `{ package_version, adventure, action, args }` | `{ adventure, view }` |
| `action` 取值 | `create` / `continue` / `close_chapter` / `restart` / `confirm_reward` | |

这样职责最清晰：AI 通道只做"请求→AI→状态推进"，控制通道只做"纯状态迁移"，**互不干扰**。`confirm_reward` 天然属于控制通道（不走模型）。

### 9.6 与 D1 的一致性

D1 决定"客户端持存档 + 服务端权威计算"。本附录实测确认：
- 客户端持有的 `adventure` 是**服务端计算所需的所有输入**（含完整 `runtime`、`reward_state`、`campaign`）。
- 服务端能仅凭这些输入完成全部状态推进，**无需任何额外服务器状态**。
- 因此"服务端权威"**不需要引入数据库/会话存储**，仍保持无状态代理架构 ✅ 这消除了 D1 最初列出的方案 B 的最大代价。

