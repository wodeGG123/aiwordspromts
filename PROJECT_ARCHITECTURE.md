# 猎魔人世界 · 项目全景技术文档

> 文档日期：2026-11-09
> 覆盖仓库：`aiwordspromts`（AI 冒险服务端）、`aiwords`（Flutter 客户端）
> 当前主线：v3 连续八章冒险（数据包 `猎魔人世界_八章完整交互包_20261101_v3`，`package_version = 2026.11.01.3`）
> 相关文档：[`V3_MIGRATION_PLAN_20261108.md`](./V3_MIGRATION_PLAN_20261108.md)（方案）、[`V3_MIGRATION_CHANGELOG_20261109.md`](./V3_MIGRATION_CHANGELOG_20261109.md)（改动明细）、`aiwords/docs/ARCHITECTURE.md`（客户端分层）

---

## 目录

1. [系统全景](#1-系统全景)
2. [仓库与代码结构](#2-仓库与代码结构)
3. [v3 冒险：双通道架构（方案 C）](#3-v3-冒险双通道架构方案-c)
4. [v3 相位状态机（完整时序）](#4-v3-相位状态机完整时序)
5. [服务端模块详解](#5-服务端模块详解)
6. [客户端模块详解](#6-客户端模块详解)
7. [v3 数据包结构](#7-v3-数据包结构)
8. [永久奖励链路（D2 / D9）](#8-永久奖励链路d2--d9)
9. [战斗系统](#9-战斗系统)
10. [存档与数据模型](#10-存档与数据模型)
11. [API 一览](#11-api-一览)
12. [配置、环境与部署](#12-配置环境与部署)
13. [测试与工具链](#13-测试与工具链)
14. [关键不变量与踩坑清单](#14-关键不变量与踩坑清单)
15. [遗留事项与风险](#15-遗留事项与风险)

---

## 1. 系统全景

### 1.1 三个服务体

项目由三个独立后端/前端体组成，**AI 冒险服务端是自研的**，另外两个是既有商业后端。

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          玩家设备（Flutter 客户端 aiwords）                    │
│                                                                            │
│  pages/  ──  UI 编排：冒险总览页 / 章内剧情页 / 战斗页 / 养成页 …             │
│    │                                                                       │
│    ├── lib/adventure/v3/    v3 冒险域（存档·操作·控制器·奖励·目录）           │
│    ├── lib/battle/          客户端战斗引擎（纯 Dart，无 UI 依赖）             │
│    ├── lib/network/         Dio 网络层（ApiConfig 集中管理端点）              │
│    ├── lib/store/           SessionStore 全局状态（ValueNotifier）             │
│    ├── lib/storage/         shared_preferences 持久化（token / 存档）          │
│    └── lib/config/          AppEnv 编译期常量（--dart-define 注入）           │
└───────────┬──────────────────────────────────┬─────────────────────────────┘
            │ ① 游戏后端 API                    │ ② AI 冒险 API
            │  （账号资源 / 卡牌 / 战斗掉落 /     │  （SSE 流 + 权威状态推进）
            │    邮件 / 商城 / 爬塔 / 章节 …）   │
            ▼                                  ▼
┌───────────────────────────┐   ┌───────────────────────────────────────────┐
│  游戏后端（商业后端）      │   │  AI 冒险服务端 aiwordspromts（Node 20）    │
│  f8q3w6v1.dimecho.com     │   │                                           │
│                           │   │  :3000  主 API                             │
│  · 账号 / 金币 / 钻石      │   │    POST /api/chat            ← AI 通道     │
│  · 卡牌 / 装备 / 背包      │   │    POST /api/adventure/transition ← 控制  │
│  · 邮件（含奖励邮件）      │   │    GET  /api/capabilities                │
│  · 商城 / 爬塔 / 章节      │   │    GET  /health                           │
│  · 副本 / 任务 / 抽卡      │   │                                           │
│                           │   │  :3001  CORS 反向代理 → 游戏后端          │
│  ⚠️ v3 奖励邮件接口尚未上线 │   │  （解决 Web 端跨域）                       │
└───────────────────────────┘   └───────────────────────────────────────────┘
                                          │
                                          ▼
                            ┌─────────────────────────────┐
                            │  LLM 提供商（OpenAI 兼容）   │
                            │  默认 火山方舟 Ark           │
                            │  deepseek-v4-flash-ga-…     │
                            └─────────────────────────────┘
```

### 1.2 三层职责划分

| 层 | 负责 | 不负责 |
|---|---|---|
| **客户端** | `adventure` 存档持久化（revision CAS）、请求串行队列、过期回包拦截、UI 演出、战斗执行、奖励邮件领取 | 事件效果计算、奖励额度判定、章节游标校验 |
| **AI 服务端** | 请求合法性校验、prompt 装配、调用模型、**权威解析与校验 AI 输出**、状态推进计算、下一版存档生成 | 持久化、账号资源发放 |
| **游戏后端** | 账号金币/钻石/圣物/背包、奖励邮件创建与领取、奖励周期额度 | 剧情状态 |

> 关键性质：**AI 服务端无状态**。它是纯函数式 Reducer：`(adventure, operation, aiOutput) → adventure'`。

---

## 2. 仓库与代码结构

### 2.1 `aiwordspromts`（服务端）

```
aiwordspromts/
├── src/
│   ├── index.js                     # 入口：起 HTTP server + 可选 CORS 代理；优雅关闭
│   ├── runtime_contract.mjs         # 【legacy】旧通道（runtime_yaml 字符串）协议映射
│   ├── sse_adapter.mjs              # 旧通道 SSE 适配
│   ├── adventure_story_prompt.js    # 旧通道提示词
│   ├── engine/
│   │   ├── v3_engine.mjs            # v3 引擎统一出口（屏蔽 vendor 深层路径）
│   │   ├── v3_adapter.mjs           # ★ v3 协议适配层（核心）
│   │   ├── v3_catalog.mjs           # 章节/统计/奖励信号目录（供 capabilities）
│   │   └── vendor/v3/               # ★ 由 tools/sync_v3.mjs 同步的数据包引擎（勿手改）
│   │       ├── src/{adventure,runtime,economy,review,data,prompts}.mjs
│   │       └── parser/adventure_yaml_stream_parser.mjs
│   ├── server/
│   │   ├── routes.mjs               # ★ 路由：/api/chat 双通道分流 + /api/adventure/transition
│   │   ├── config.mjs               # 环境变量装载与校验（生产必填 AI_API_KEY）
│   │   ├── constants.mjs            # CONTRACTS / TEMPLATES / DEFAULT_LIMITS
│   │   ├── http_utils.mjs           # CORS、JSON、SSE 帧、capabilities payload
│   │   ├── model_service.mjs        # OpenAI 流式封装 + 指标采集 + 中止处理
│   │   ├── idempotency_store.mjs    # request_id 幂等表 + 固定窗口限流
│   │   ├── ai_debug.mjs             # AI 调用追踪落盘（logs/ai-trace，7 天保留）
│   │   └── proxy_server.mjs         # CORS 反向代理（:3001 → 游戏后端）
│   └── tests/                       # node:test 单测（2283 行，153 用例）
├── tools/
│   ├── sync_v3.mjs                  # 数据包 → vendor 同步（--check 供 CI）
│   ├── gen_v3_catalog.mjs           # 生成章节目录
│   └── probe_v3_{e2e,schedule,timing}.mjs  # 端到端探针
├── 猎魔人世界_八章完整交互包_20261101_v3/  # ★ v3 数据包（142MB，源）
├── 数据拆分包_20260904/                 # 旧数据包（legacy 通道仍依赖）
├── Dockerfile / docker-compose.yml / deploy.sh
└── V3_MIGRATION_{PLAN_20261108,CHANGELOG_20261109}.md
```

### 2.2 `aiwords`（客户端）

```
aiwords/lib/
├── main.dart                        # MaterialApp 路由表（buildAppRoutes / generateAppRoute）
├── config/                          # AppEnv（编译期）、ImageConfig（OSS 图片根）
├── constants/                       # AppColors、AppLayout、冒险提示词常量
├── models/                          # 纯数据类（user_profile / hunter_card / artifact…）
├── network/                         # Dio 单例 + ApiConfig + AppInterceptor + 各领域 API
├── storage/                         # token / user / artifact_catalog / adventure_runtime
├── store/                           # SessionStore（全局）、MailStore、AdventureRuntimeStore(legacy)
├── services/
│   ├── core/                        # LoadState、PagedListController
│   ├── <feature>/                   # 每页一个 Controller（不弹窗、不导航）
│   ├── navigation_service.dart      # 脱离 context 的导航
│   └── ad_reward_service.dart
├── battle/                          # ★ 纯 Dart 战斗引擎
│   ├── battle_core.dart             # BattleUnitSeed / BattleResult / BattleOutcome
│   ├── battle_simulator.dart        # 整场战斗同步模拟（53KB）
│   ├── battle_formulas.dart         # 伤害公式
│   ├── battle_buff.dart / battle_effects.dart / battle_passive.dart
│   └── battle_timeline.dart / battle_action_visuals.dart
├── adventure/
│   ├── adventure_sse_reader.dart    # SSE 组帧器（支持 event: state）
│   ├── adventure_event_catalog.dart # 【legacy】旧事件目录
│   ├── adventure_stream_session.dart / adventure_yaml_parser.dart …  # 【legacy】
│   └── v3/                          # ★ v3 冒险域
│       ├── adventure_models.dart     # 存档 / campaign / runtime / view / SSE state 模型
│       ├── adventure_store.dart      # 持久化（CAS revision，最多 3 份归档）
│       ├── adventure_controller.dart # 串行队列 + 过期回包拦截 + 落盘
│       ├── adventure_operations.dart # operation 构造器（start/next_round/choose/…）
│       ├── adventure_v3_api.dart     # AI 通道（SSE）+ 控制通道（transition）
│       ├── adventure_v3_session.dart # 应用级单例：控制器 + 奖励服务 + 奖励结算
│       ├── adventure_v3_output.dart  # 服务端已校验 output 的展示模型
│       ├── adventure_v3_entry.dart   # campaignId/runId/seed/team/relics 构造
│       ├── adventure_reward_service.dart # 邮件发放 + 本地待发队列
│       ├── adventure_catalog.dart / adventure_catalog_data.dart # schedule-only 目录
├── pages/
│   ├── adventure_page.dart          # 薄壳路由 → AdventureCampaignPage
│   ├── adventure/
│   │   ├── adventure_campaign_page.dart # ★ v3 八章总览页
│   │   ├── adventure_v3_story_page.dart # ★ v3 章内剧情页
│   │   ├── adventure_battle_seed.dart   # 卡牌 → BattleUnitSeed
│   │   └── adventure_npc_portrait.dart
│   ├── adventure_story_page.dart    # 【legacy】旧单线剧情页
│   ├── battle/                      # 战斗演出（scene / playback / effects / sfx）
│   ├── main_shell_page.dart         # 5 tab 壳层
│   └── …（养成 / 商店 / 邮件 / 任务 / 爬塔 / 章节 / 副本 / 抽卡）
├── widgets/                         # 公共组件（不依赖 store/services）
├── dev/                             # 调试层（release AOT 剔除）
└── test/                            # 32 个测试文件
```

---

## 3. v3 冒险：双通道架构（方案 C）

### 3.1 决策矩阵

| 编号 | 决策项 | 结论 |
|---|---|---|
| D1 | 架构与状态权威 | **方案 C**：客户端持存档 + 服务端权威计算；Dart 端不复刻任何断言 |
| D2 | 永久奖励通道 | 邮件（游戏后端新增「创建冒险奖励邮件」接口） |
| D3 | 对外协议版本 | `adventure-runtime-v4` → `adventure-runtime-v5`（客户端服务端同版本发布） |
| D4 | 旧副本共存 | v3 八章**替换**冒险副本入口 |
| D5 | 邮件创建方 | 客户端触发（以 `claim_key` 幂等） |
| D6 | 奖励周期 `cycle_id` | 按自然日 `daily:YYYY-MM-DD`；终身键 `lifetime:` 不随周期清除 |
| D7 | 战斗 `retreat` | 手动撤退按钮 → `battle_result = retreat` |
| D8 | 限流并发 | 不改：`30/min`、`2 concurrent/IP` |
| D9 | 发奖交付边界 | **spec_stub**：客户端调用侧 + 契约文档；后端未上线走本地待发队列 |
| D10 | 客户端事件数据 | **schedule_only**：仅 `schedule + asset_scope`；`options/results` 服务端权威 |
| D11 | 旧存档处理 | 直接丢弃（检测到 v4 格式 → 清空，从 CH01 重开） |
| D12 | 历史归档 | 保留最近 3 次重开记录（只读） |

### 3.2 双通道数据流

```
┌────────────────────────── 客户端 (aiwords) ──────────────────────────┐
│  AdventureV3Store        唯一存档副本 + revision CAS 落盘             │
│  AdventureV3Controller   串行队列（同一时刻只允许 1 个 AI 请求在飞）    │
│  AdventureV3Session      应用级单例（页面间共享 controller）           │
└───────────┬──────────────────────────────────┬──────────────────────┘
            │ 【AI 通道】POST /api/chat          │ 【控制通道】POST /api/adventure/transition
            │ { package_version,                 │ { package_version, action, adventure?, args }
            │   adventure, operation }           │ actions: create / continue / close_chapter
            ▼                                  ▼                    / restart / confirm_reward / view
┌────────────────────────── 服务端 (aiwordspromts) ────────────────────┐
│                                                                     │
│  ① validateV3Request   包版本 / schema_version / revision /        │
│                        operation↔模板矩阵校验                        │
│  ② premigrateV3        choose→selectOption                         │
│                        battle_result→acceptBattleResult             │
│                        next_round→nextRound（+1 轮、扣补给、可硬失败）│
│  ③ prepareV3Prompt     v3 引擎 prepareAdventureMessages             │
│                        → systemPrompt / userPrompt / requestGuard  │
│  ④ 流式调用模型        SSE 增量转发（text 分片）                     │
│  ⑤ parseV3Output       受限 YAML 解析 + 五模板 Schema 校验          │
│                        ⚠️ 失败绝不推进任何状态                        │
│  ⑥ advanceV3           acceptNewEvent / acceptResolution /          │
│                        commitSettlement → 下一版 adventure          │
└───────────┬─────────────────────────────────────────────────────────┘
            ▼
   SSE:  data: <文本分片> …
         data: <文本分片>
         event: state
         data: { adventure, state_version, revision, request_guard,
                 changed, output }        ← output = 服务端权威校验后的 AI 文档
         data: [DONE]
            │
            ▼
┌────────────────────────── 客户端（继续） ──────────────────────────┐
│  ① 比对 request_guard：session_revision / run_id / state_version    │
│     不匹配 → 丢弃迟到回包（STALE_STATE）                            │
│  ② 原子落盘 AdventureStore.save(expectedRevision: 旧 revision)      │
│  ③ 直接展示服务端下发的 output（结算摘要 / 检定分析 / 终章回顾）      │
│     ⚠️ 客户端不再自行解析 YAML，避免两端口径漂移                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 为什么这样切分

| 问题 | 解法 |
|---|---|
| 服务端无状态 → 无法判定「过期 revision」 | 客户端用 `request_guard`（`session_revision` + `run_id` + `state_version`）比对并丢弃迟到回包 |
| 客户端要展示结算摘要，但不该自己解析 YAML | 服务端在 `event: state` 里附带**权威校验后的 `output`** 文档，客户端直接展示 |
| 客户端事件目录是 schedule-only，算不出经济额度 | 服务端在 `continue` 时**权威注入 `reward_state`**（章节 economy 配置 + 自然日周期） |
| 客户端算不出 `next_round` 的轮数/补给扣减 | 服务端在装配 prompt 前执行 `nextRound()` 预迁移 |

### 3.4 服务端两条通道的职责切分

| | AI 通道 `/api/chat` | 控制通道 `/api/adventure/transition` |
|---|---|---|
| 是否调用模型 | ✅ | ❌ 纯状态迁移 |
| 幂等 | `Idempotency-Key` + `request_id` 指纹表（TTL 15min） | 无（同 action 幂等由引擎保证） |
| 返回 | SSE（文本分片 + `event: state`） | JSON `{ adventure, view, archive?, pending_reward_requests? }` |
| 典型操作 | start / next_round / choose / settle_check / battle_result / finale | create / continue / close_chapter / restart / confirm_reward / view |

---

## 4. v3 相位状态机（完整时序）

### 4.1 相位图

```
                       ┌──────────────────────────────────────────┐
                       │  runtime.pending_interaction == null      │
                       │  （等待生成新事件）                        │
                       └───────────────┬──────────────────────────┘
                                       │ operation = start (round==1, completed==0)
                                       │          或 next_round (completed==current_round)
                                       ▼
                          ┌────────────────────────────┐
                          │  服务端预迁移 nextRound()  │  ← 轮数+1、补给扣减、可能硬失败
                          └────────────┬───────────────┘
                                       │ 装配 prompt → AI → 校验 → acceptNewEvent
                                       ▼
        ┌──────────────────────────────────────────────────┐
        │  phase = awaiting_choice                         │◀─── 玩家选择选项
        │  event_output = { event_details: { options[] } } │      （原样复制 selected_option）
        └───┬──────────────────────────────┬───────────────┘
            │ 选项 template_name = 检定      │ 选项 template_name = 战斗事件
            │                              │            选项 template_name = 结算（直选）
            ▼                              ▼                              │
 ┌────────────────────────┐   ┌────────────────────────┐                 │
 │ acceptResolution       │   │ acceptResolution       │                 │
 │ → resolution_output    │   │ → resolution_output    │                 │
 │ → phase =              │   │ → phase =              │                 │
 │   awaiting_settlement  │   │   awaiting_battle_     │                 │
 │   _commit              │   │   result               │                 │
 └───────────┬────────────┘   └───────────┬────────────┘                 │
             │ 客户端读 result              │ 客户端本地跑战斗             │
             │ → 自动 settle_check          │ → battle_result              │
             ▼                              ▼ (victory/defeat/retreat)     │
 ┌──────────────────────────────────────────────────────────────────┐     │
 │ phase = awaiting_settlement_commit                                │     │
 │ 服务端 commitSettlement(output, request_id, expectedVersion)      │◀────┘
 │  → 结算摘要 / 资源变化 / 道具变化 / reward_requests(pending)     │  直选结算
 │  → completed_events 追加、current_round 不变、state_version+1    │  直接 commitSettlement
 └───────────┬──────────────────────────────────────────────────────┘
             │ ① 客户端 settlePendingRewards（发邮件 + confirm_reward）
             │ ② run_status != 'ongoing' ? → finale → close_chapter
             │ ③ 否则 → next_round（回到顶部）
             ▼
   ┌───────────────────────────┐
   │ finale（不改变进度）      │  → 产出终章回顾文本
   └───────────┬───────────────┘
               ▼
   ┌───────────────────────────┐
   │ close_chapter             │  ⚠️ 前置：reward_requests 无 pending
   │ → promoteChapter /        │
   │   failCampaign            │  → campaign.chapter_results 追加
   │ → 章节回顾 recap          │  → runtime 清空
   └───────────┬───────────────┘
               ▼
        下一章（continue）→ 回到顶部
```

### 4.2 关键时序：一次带检定的选择

```
客户端                服务端                          LLM
  │                     │                             │
  │ POST /api/chat      │                             │
  │ operation=choose    │                             │
  │ selected_option     │                             │
  │  (原样复制 pending)  │                             │
  ├────────────────────►│ validateV3Request           │
  │                     │ premigrate → selectOption   │
  │                     │ prepareV3Prompt ───────────►│
  │                     │◄────────── SSE 文本分片 ────┤
  │◄── data: 分片 ──────┤                             │
  │◄── data: 分片 ──────┤                             │
  │                     │ parseV3Output                │
  │                     │  ⚠️ 失败 → event: error，不推进状态
  │                     │ advanceV3 → acceptResolution │
  │◄── event: state ────┤ {adventure, output, guard}  │
  │◄── data: [DONE] ────┤                             │
  │                     │                             │
  │ 客户端读 resolution_output.result                    │
  │ 自动 POST /api/chat (settle_check)                  │
  ├────────────────────►│ commitSettlement            │
  │◄── event: state ────┤ {adventure(含结算后存档)}     │
  │ 落盘（CAS）           │                             │
  │ 展示 output.summary  │                             │
  │ settlePendingRewards │                             │
  │   → POST /api/v1/adventure-campaign/rewards/mail   │
  │   → POST /api/adventure/transition (confirm_reward) │
```

### 4.3 operation ↔ 模板矩阵（服务端强制）

| operation | 允许的 `expected_template_name` | 装配前服务端迁移 | AI 输出后的推进 |
|---|---|---|---|
| `start` | 新一轮事件 | — | `acceptNewEvent` |
| `next_round` | 新一轮事件 | `nextRound()` | `acceptNewEvent` |
| `choose` | 检定 / 战斗事件 / 结算 | `selectOption()` | `acceptResolution`；**若为「结算」直选 → 直接 `commitSettlement`** |
| `settle_check` | 结算 | —（resolution 已在存档中） | `commitSettlement` |
| `battle_result` | 结算 | `acceptBattleResult()` | `commitSettlement` |
| `finale` | 终章 | — | **不改变状态**（归档素材） |

> ⚠️ 直选结算必须直接 `commitSettlement`。若误走 `acceptResolution`，phase 会被置为 `awaiting_battle_result` 而永久卡死。

---

## 5. 服务端模块详解

### 5.1 请求处理管线（`src/server/routes.mjs`）

```
请求进入
  │
  ├─ OPTIONS → 200 {ok:true}
  ├─ GET /health → {status, service, contracts}
  ├─ GET /api/capabilities → 契约 / 章节 / 功能开关 / 限制
  ├─ GET /api/apk → {url, version}（APK 更新）
  ├─ POST /api/adventure/transition → handleAdventureTransition()
  └─ POST /api/chat → handleChat()
         │
         ▼
  ┌─ 限流检查（FixedWindowRateLimiter, 30/min/IP）
  ├─ 并发闸门（maxConcurrentPerIp = 2，超限 → 429 CONCURRENT_LIMITED）
  ├─ readJsonBody（8MB 上限，超限 → 413）
  ├─ Idempotency-Key 必须 == operation.request_id，否则 400
  ├─ 拒绝客户端指定 model（MODEL_OVERRIDE_NOT_ALLOWED）
  │
  ├─ isV3Request(input) ? input.adventure !== undefined
  │     ├─ true  → prepareV3Prompt(input)
  │     └─ false → preparePromptFromRequest(input)  【legacy】
  │
  ├─ 幂等指纹：v3 取存档游标；legacy 取 runtime_yaml 摘要
  │     指纹不一致 → 409 IDEMPOTENCY_CONFLICT
  │     重复 request_id → 409 REQUEST_NOT_REPLAYABLE
  │
  ├─ SSE 头 + 心跳（5s keep-alive）
  ├─ aiDebugger.start（开发环境默认落盘 logs/ai-trace）
  │
  ├─ modelService.stream()  ← OpenAI stream:true，thinking:disabled
  │     · 每 chunk：writeSseData(delta)（v3 同时累积 rawChunks）
  │     · 指标：time_to_first_chunk / generation_ms / reasoning_chars_discarded …
  │
  ├─ v3 分支：
  │     rawYaml = rawChunks.join("")
  │     parseV3Output → 失败：writeSseError，**不推进状态**
  │     advanceV3   → 失败：writeSseError，**不推进状态**
  │     writeSseEvent("state", {adventure, output, request_guard, changed})
  │
  ├─ writeSseDone()  → data: [DONE]
  └─ aiDebugger.finish()
```

### 5.2 `v3_adapter.mjs` 关键设计

| 函数 | 职责 | 关键约束 |
|---|---|---|
| `dailyRewardCycleId(date?)` | D6 自然日周期 `daily:YYYY-MM-DD` | 以**服务端**日期为准（R9 时区一致性） |
| `normalizeRuntime(runtime)` | 补齐客户端省略的 null 字段 | `pending_interaction` 缺失 → 显式 `null`；否则引擎 `=== null` 严格比较失败 |
| `validateV3Request(body)` | 包版本 / schema / revision / operation↔模板 | 失败抛 `V3ContractError` |
| `premigrateV3(adventure, op)` | 装配前的引擎迁移 | 返回 `premigratedAdventure`，必须原样回传 |
| `prepareV3Prompt(body)` | 校验 → 预迁移 → prompt 装配 | 返回 `messages / requestGuard / fingerprintSource` |
| `parseV3Output(rawYaml, op)` | 受限 YAML 解析 + 五模板 Schema 校验 | 失败抛 `V3OutputError`，**绝不推进状态** |
| `advanceV3(premigrated, op, aiOutput)` | 状态推进 | `finale` 不改状态（`changed:false`） |
| `buildRewardStateForContinue(current, args)` | D10/D6 权威注入 `reward_state` | 客户端算不出章节 economy 额度 |
| `transitionV3(body)` | 控制通道 6 个 action | 返回 `{adventure, view, archive?, pending_reward_requests?}` |
| `shadowValidateOutput(...)` | 影子复核（不改流） | 仅日志 |
| `chapterSummaries()` | 章节清单 | 供 `/api/capabilities` |

### 5.3 限流与幂等

| 机制 | 参数 | 行为 |
|---|---|---|
| 固定窗口限流 | `RATE_LIMIT_PER_MINUTE=30` | 超限 → 429 `RATE_LIMITED`（带 `retryAfterSeconds`） |
| 并发闸门 | `MAX_CONCURRENT_PER_IP=2` | 超限 → 429 `CONCURRENT_LIMITED` |
| 幂等表 | TTL 15 分钟 | 状态机 `accepted → streaming → completed/failed/cancelled` |
| 幂等指纹 | v3：存档游标摘要；legacy：`runtime_yaml` 摘要 | 指纹不一致 → 409 `IDEMPOTENCY_CONFLICT` |

### 5.4 错误码表

| HTTP | code | 场景 |
|---|---|---|
| 400 | `V3_CONTRACT_INVALID` | 包版本不匹配 / schema 非法 / operation↔模板不匹配 |
| 400 | `IDEMPOTENCY_KEY_MISMATCH` | `Idempotency-Key` ≠ `operation.request_id` |
| 400 | `MODEL_OVERRIDE_NOT_ALLOWED` | 客户端试图指定 model |
| 400 | `INVALID_JSON` | 请求体非合法 JSON |
| 400 | `RUNTIME_TOO_LARGE` | legacy `runtime_yaml` 超长 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同 `request_id` 不同指纹 |
| 409 | `REQUEST_NOT_REPLAYABLE` | 同 `request_id` 重复发起 |
| 413 | `REQUEST_TOO_LARGE` | 请求体 > 8MB |
| 429 | `RATE_LIMITED` / `CONCURRENT_LIMITED` | 限流 / 并发超限 |
| SSE | `V3_OUTPUT_INVALID` | AI 输出未过 YAML 解析或 Schema 校验 |
| SSE | `V3_ADVANCE_FAILED` | 输出合法但引擎推进失败 |
| SSE | `UPSTREAM_ERROR` / `OUTPUT_TOO_LARGE` / `EMPTY_MODEL_OUTPUT` | 模型侧异常 |

---

## 6. 客户端模块详解

### 6.1 分层依赖规则

```
dev/       ← 调试层（release AOT 剔除，门控 AppEnv.enableDebugEntries）
pages/     ← 页面编排
widgets/   ← 公共组件（不依赖 store/services）
services/  ← 业务服务（Controller：只 import foundation，不弹窗不导航）
network/   ← Dio 网络层
store/     ← SessionStore 全局状态
storage/   ← shared_preferences
models/    ← 纯数据类（零依赖）
battle/    ← 纯 Dart 战斗引擎（无 UI 依赖）
config/    ← 编译期常量（任意层可读）
```

**强制规则**：上层可依赖下层，反向禁止；`pages/` → `network/` 为过渡期例外；`widgets/` 不得订阅 `SessionStore`。

### 6.2 v3 冒险域对象关系

```
                        ┌──────────────────────────────┐
                        │   AdventureV3Session         │  应用级单例
                        │   (instance)                 │
                        └──────┬───────────────┬───────┘
                               │               │
                    ┌──────────▼──────┐  ┌─────▼──────────────────┐
                    │ AdventureV3     │  │ AdventureV3Reward     │
                    │ Controller      │  │ Service               │
                    │  · 串行队列     │  │  · loadPending/save   │
                    │  · busy 状态    │  │  · upsertPending      │
                    │  · guard 校验   │  │  · dispatch (邮件)    │
                    │  · _persist()   │  │  · deliver (发+领)    │
                    └──────┬──────────┘  │  · claimMail          │
                           │             └─────┬──────────────────┘
          ┌────────────────┼──────────────────┘
          ▼                ▼
   ┌────────────┐  ┌───────────────┐
   │ Adventure  │  │ AdventureV3Api│
   │ V3Store    │  │  · stream()   │  SSE：event: state + 文本分片
   │ (CAS 落盘) │  │  · transition()│ 控制通道 6 action
   └────────────┘  └───────────────┘
          │                │
          ▼                ▼
   ┌────────────────┐  ┌────────────────────┐
   │ AdventureSave  │  │ AdventureV3Request │
   │  revision      │  │  {package_version, │
   │  campaign      │  │   adventure,       │
   │  runtime       │  │   operation}      │
   │  archives(≤3)  │  └────────────────────┘
   └────────────────┘
```

### 6.3 关键类职责

| 类 | 文件 | 职责 |
|---|---|---|
| `AdventureSave` | `adventure_models.dart` | 客户端唯一权威存档：`schema_version / revision / campaign / runtime / retired_campaign_ids / used_run_ids` |
| `AdventureRuntime` | 同上 | 局内运行态；含 `world_story_state`、`applied_request_ids`、`pending_interaction`、`reward_requests` |
| `AdventurePendingInteraction` | 同上 | 三相位枚举 + `event_output` / `resolution_output` / `optionById()`（**原样副本**） |
| `AdventureView` / `AdventureChapterCard` | 同上 | 服务端 `getAdventureView` 产出：八章卡状态、`continue_kind` |
| `AdventureV3Output` | `adventure_v3_output.dart` | 服务端已校验 `output` 的展示模型；`stepTexts` 摊平、`finaleOutput` 供 close_chapter |
| `AdventureV3OperationBuilder` | `adventure_operations.dart` | 6 种 operation 构造；`choose` 的 `selected_option` 原样复制 |
| `AdventureV3Controller` | `adventure_controller.dart` | 串行队列、guard 拦截、原子落盘 |
| `AdventureV3Store` | `adventure_store.dart` | `shared_preferences` key `adventure_v3_save`；CAS 校验；清理 legacy key `adventure_runtime_v1*`（D11） |
| `AdventureV3RewardService` | `adventure_reward_service.dart` | 待发队列 key `adventure_v3_pending_rewards`；`dispatch` / `deliver` / `upsertPending` |
| `AdventureV3Entry` | `adventure_v3_entry.dart` | `newCampaignId / newRunId / newSeed / buildTeam / fallbackTeam / buildRelics / buildContinueArgs` |
| `AdventureBattleSeed` | `pages/adventure/adventure_battle_seed.dart` | SessionStore 卡牌 → `BattleUnitSeed`（含技能） |
| `AdventureCampaignPage` | `pages/adventure/adventure_campaign_page.dart` | 八章总览：章节卡、主按钮、重开确认、只读归档 |
| `AdventureV3StoryPage` | `pages/adventure/adventure_v3_story_page.dart` | 章内运行时：场景/BGM/立绘/打字机/选项/战斗/结算/奖励/终章 |

### 6.4 UI 页面结构

```
AdventureCampaignPage（总览）
├── 顶部：返回 / 标题「猎魔人世界 · 八章连续冒险」/ 刷新 / campaign 状态徽标
├── 主线进度面板：X / 8 章、当前章·轮次·补给·腐化
│   └── 主按钮（由 view.continue_kind 决定）
│       ├── start        → 「开始冒险」
│       ├── resume       → 「继续冒险」
│       └── next_chapter → 「进入下一章」
│   └── 次按钮：「从第一章重开」（固定文案 kAdventureV3RestartConfirmText）
├── 八章卡列表（服务端 view.chapterCards 驱动，客户端不自行判定可进入）
│   └── 已通关 / 待回顾 / 失败 / 进行中 / 可进入 / 未解锁
└── 历史归档（最近 3 次，只读）

AdventureV3StoryPage（章内）
├── 背景层：GameSceneBackground（场景名 → assets/images/scenes/{name}.webp）
│           别名：吸血鬼庄园→吸血鬼城堡、魔王城堡→恶魔城堡
├── 顶栏：返回 / 章·轮次 / 补给·腐化 / busy 指示
├── NPC 立绘：assets/images/cards/{npc}_2.webp
├── 文本框：说话人名牌 + 结算摘要面板 + 打字机旁白 + 「跳过 / 继续」
├── 选项面板：id. 文本 (检定 类型 难度N) [条件不足]
└── 奖励弹窗：类型·名称 + 「已到账 / 待发放 / 待领取」
```

### 6.5 场景与 BGM 映射

| 场景名 | 背景资源 | BGM |
|---|---|---|
| 艾德村庄 / 河畔镇 / 神圣教堂 / 精灵营地 / 幽暗森林 | `assets/images/scenes/{name}.webp` | `music/{name}.mp3` |
| 吸血鬼庄园 | → 吸血鬼城堡 | 吸血鬼城堡 |
| 魔王城堡 | → 恶魔城堡 | 恶魔城堡 |
| 未知名 | `assets/images/home_bg.png`（兜底） | `music/幽暗森林.mp3` |

---

## 7. v3 数据包结构

### 7.1 目录（`猎魔人世界_八章完整交互包_20261101_v3/`）

```
猎魔人世界_八章完整交互包_20261101_v3/
├── README_先看这里.md / 迁移说明.md / 本次检查与修复.md
├── 构建元数据.json / 发布清单.json / 程序协议.html
├── 01_共享积木/            世界规则、引擎_新一轮事件、引擎_检定、
│                          引擎_战斗事件、引擎_结算、引擎_终章、最终自检
├── 02_章节包/              CH01~CH08/{chapter.json, events.yaml, README.md}
│                          + 章节总表.json + 物品跨章规则.json
├── 03_预切片/              CH01~CH08/{事件/…} + 按操作/{start,choose,…}
├── 04_完整模拟/            8 个阶段的完整流程模拟 + 流程索引.json
├── 05_边界样例/ 06_连续冒险样例/
├── src/                   ★ 引擎源码（被 sync_v3.mjs 同步到 vendor）
│   ├── adventure.mjs      createAdventure / continueAdventure / closeAdventureChapter
│   │                      restartAdventure / prepareAdventureMessages / updateAdventure
│   │                      getAdventureView
│   ├── runtime.mjs        状态机核心：acceptNewEvent / selectOption / acceptResolution
│   │                      acceptBattleResult / commitSettlement / nextRound / promoteChapter
│   ├── economy.mjs        奖励账本：createRewardState / reserveEconomy / confirmPermanentReward
│   ├── review.mjs         归档：chapterReviewFacts / fallbackRecap / buildChapterRecord
│   └── data.mjs           章节 / 事件 / 物品 / 资产（65K 行）
├── parser/                ★ 受限 YAML 流式解析器 + 五模板 Schema 校验
└── tests/ tools/ 资产/ 策划/
```

### 7.2 八章配置

| 章 | 名称 | 轮数 | gold_gain_cap | 材料/圣物/因缘/装备槽位 |
|---|---|---|---|---|
| CH01 | 艾德村庄 | 24 | 500 | 2 / 1 / 1 / 0 |
| CH02 | 幽暗森林 | 28 | 600 | 2 / 1 / 1 / 0 |
| CH03 | 沼泽旧事 | 30 | 700 | 2 / 1 / 1 / 0 |
| CH04 | 河畔镇 | 28 | 800 | 2 / 1 / 1 / 1 |
| CH05 | 旧神庙 | 26 | 900 | 2 / 1 / 1 / 0 |
| CH06 | 山路与龙巢 | 30 | 1000 | 2 / 1 / 1 / 0 |
| CH07 | 城门之前 | 32 | 1100 | 2 / 1 / 1 / 0 |
| CH08 | 王座之下 | 36 | 1200 | 2 / 1 / 1 / 1 |

- 全部章：`max_gold_gain_per_event=200`、`max_gold_cost_per_event=300`、`diamond_enabled=false`
- 总轮数 234；事件 273 个（其中隐藏事件 7 个）

### 7.3 同步到 vendor

```bash
node tools/sync_v3.mjs          # 从数据包同步到 src/engine/vendor/v3/
node tools/sync_v3.mjs --check  # 校验 vendor 与包一致（CI 用）
```

> 为什么 vendor 而不是直接 import 包目录：包目录 142MB（含发布清单、资产、模拟产物），进镜像过大；Dockerfile 需 COPY 中文目录名对 CI 不友好；服务端只需 `src/` + `parser/`（约 2.2MB）。

---

## 8. 永久奖励链路（D2 / D9）

### 8.1 流程

```
结算完成（commitSettlement）
  │
  ▼
runtime.reward_requests[] 追加 {id, count, request_id, event_id, claim_key, status:'pending', reward}
  │                                    ▲
  │                          claim_key = `${scope}:${chapter_id}:${event_id}:${type}`
  │                          scope = daily:YYYY-MM-DD 或 lifetime:
  ▼
客户端 AdventureV3Session.settlePendingRewards()
  │
  ├─ ① syncPending(requests)  同步进本地待发队列（按 claim_key 幂等，不覆盖已有）
  ├─ ② deliver(item)
  │      ├─ POST /api/v1/adventure-campaign/rewards/mail   （创建奖励邮件）
  │      │     ⚠️ 后端未上线 → 404 → 保留待发，不阻塞剧情
  │      └─ MailApi.claimMail(mailId)                     （领取附件）
  │            失败 → status='mailed'（可重试）
  ├─ ③ 若 mailId 仍为空 → 本地标 'granted'，**仍调 confirm_reward**
  └─ ④ POST /api/adventure/transition (action=confirm_reward, claim_key, status='granted')
            服务端 economy.confirmPermanentReward → reward_requests 该条 status 改 granted
```

### 8.2 关键约束

| 约束 | 说明 |
|---|---|
| `close_chapter` 前不得有 pending 奖励 | 引擎 `promoteChapter` 硬校验：`先完成已预留奖励确认，再提交章节` |
| `claim_key` 绝不可重新生成 | 幂等键；重试必须复用原 key，否则重复发信 |
| 邮件未创建成功也必须确认回执 | D9：否则章节永远无法推进 |
| 未发出的奖励留在本地队列 | `needsMailDelivery == true`，接口上线后用**同一 claim_key** 补发 |

### 8.3 永久资源信号

| 类型 | signal id | 承载 |
|---|---|---|
| 材料 | 900050 | `material` |
| 圣物 | 900060 | `relic` |
| 因缘 | 900061 | `bond` |
| 装备 | 900062 | `equipment` |

### 8.4 UI 状态映射

| 本地 `status` | UI 文案 |
|---|---|
| `granted` + 有 mail_id | 已到账 |
| `granted` + 无 mail_id | 待发放（D9 兜底） |
| `mailed` | 待领取 |
| `pending` | 待发放 |

---

## 9. 战斗系统

### 9.1 架构

```
        客户端战斗引擎（lib/battle/，纯 Dart，无 UI 依赖）
   ┌────────────────────────────────────────────────────────┐
   │  battle_simulator.dart   整场战斗同步模拟（状态机）      │
   │  battle_core.dart        BattleUnitSeed / BattleResult │
   │  battle_formulas.dart    伤害公式                        │
   │  battle_buff.dart        Buff / 状态效果                 │
   │  battle_effects.dart     技能效果                        │
   │  battle_passive.dart     被动                            │
   │  battle_timeline.dart    事件流（模拟 → 演出）           │
   └───────────────────────┬────────────────────────────────┘
                           │ BattleUnitSeed[]
                           ▼
        演出层（lib/pages/battle/）
   ┌────────────────────────────────────────────────────────┐
   │  battle_scene.dart        共享演出场景（所有入口共用）    │
   │  battle_playback.dart     时间线 → 逐帧演出（并发）       │
   │  battle_performance.dart  单次演出状态机                 │
   │  story_battle_page.dart   剧情战斗页（含撤退按钮）        │
   │  battle_effect_frames / battle_sfx / battle_boss_hud …  │
   └────────────────────────────────────────────────────────┘
```

### 9.2 属性体系

暗黑 2 风格：命中值、五系元素抗性、力/敏/智。

```dart
class BattleUnitSeed {
  final String name;
  final int maxHp, maxMana, speed, armor, magicResist;
  final int physicalAttack, magicAttack;
  final int fireResist, iceResist, lightningResist, lightResist, darkResist;
  final int power, agility, wisdom;
  final double hitChance, dodgeChance, critChance, critMultiplier;
  final double physDmgUp, spellDmgUp, dmgUp;
  final double armorIgnorePct, armorIgnoreFlat;
  final double mrIgnorePct, mrIgnoreFlat;
  final double physDmgTakenDown, spellDmgTakenDown, dmgTakenDown;
  final int firePower, icePower, lightningPower, lightPower, darkPower;
  final double critDmgResistPct, healUpFlat, healUpPct;
  final double waterPower, windPower, resourceScale;
  final bool isBoss;
  // 演出字段（不进任何计算）：skillEffects / imagePath
}
```

### 9.3 v3 战斗接入

```
v3 战斗模板输出（AI 生成）
  → output.enemies[]  ⚠️ v3 敌人**只有 name 一个字段**，无属性
  → AdventureV3Output.enemyRows
  → StoryRoundParser.buildEnemySeeds(...)  用默认模板补齐数值
  → 我方：AdventureBattleSeed.buildAdventureAllySeeds(SessionStore)
        （从 SessionStore.cachedCards 取上阵卡牌，提取属性 + 技能）
  → Navigator.push(StoryBattlePage(allySeeds, enemySeeds, showRetreatButton: true))
  → BattleResult{outcome: victory | defeat | retreat}
  → operation = battle_result(option_id, result)
```

> D7 撤退：战斗页提供「撤退」出口 → `battle_result = 'retreat'`（引擎接受 `victory`/`defeat`/`retreat` 三值）。

### 9.4 其它战斗入口

`/chapter-list` → 关卡节点 → 挑战确认弹窗（体力消耗、通关奖励预览）→ 战斗 → 上报 `/api/v1/chapters/levels/{uid}/clear`。
`/tower-list` → 塔层详情 → 挑战 → 战斗 → 领奖（`pending_rewards` 判定可领取）。

---

## 10. 存档与数据模型

### 10.1 v3 存档结构

```jsonc
{
  "schema_version": 3,
  "revision": 42,                    // 全会话计数器，任何一次迁移 +1
  "campaign": {
    "schema_version": 3,
    "campaign_id": "camp_xxx",
    "revision": 3,
    "status": "ongoing",             // ongoing | failed | completed | abandoned
    "chapter_results": [             // 从 CH01 连续排列
      {
        "chapter_id": "CH01", "run_id": "run_xxx",
        "outcome": "cleared",        // cleared | failed | abandoned
        "flags": ["..."],            // 导出到后续章节的 story flag
        "recap": "本章回顾正文",
        "recap_source": "ai",        // ai | fallback
        "review_facts": { /* key_choices / npc_changes / item_changes / … */ }
      }
    ],
    "story_flags": [], "npc_states": [], "key_items": [],
    "memory_notes": [], "unresolved_hooks": []
  },
  "runtime": {
    "chapter_id": "CH02", "run_id": "run_yyy",
    "state_version": 17,             // 每次状态推进 +1（服务端计算）
    "campaign_id": "camp_xxx", "campaign_revision": 3,
    "play_mode": "story", "run_difficulty": "normal", "run_seed": 12345,
    "current_round": 5, "current_scene_id": "scene_forest",
    "corruption_value": 12, "supply_value": 96,
    "run_status": "ongoing",         // ongoing | cleared | failed
    "team_status": "active",
    "gold": 0, "diamond": 0, "gold_policy": {}, "diamond_policy": {},
    "current_team": [], "current_package": {},
    "story_state": { "completed_events": [ {"event_id","option_id","outcome"} ],
                     "npc_states": {}, "story_flags": [], "unresolved_hooks": [] },
    "world_story_state": { "campaign_id": "camp_xxx", "revision": 3, ... },
    "applied_request_ids": ["settle-42-17-1730…"],
    "reward_state": { "chapter_id", "cycle_id": "daily:2026-11-09",
                      "gold_gain_remaining", "*_slots_remaining",
                      "claimed_reward_keys": [], … },
    "pending_interaction": {         // ⚠️ 必须显式为 null（不能省略 key）
      "event_id": "CH02_E007", "phase": "awaiting_choice",
      "scene_id": "scene_forest", "scene_name": "幽暗森林",
      "option_id": null, "selected_option": null,
      "event_output": { "event_details": { "options": [ … ] } },
      "resolution_output": null, "battle_result": null
    },
    "reward_requests": [ { "id": 900050, "count": 1, "request_id",
                           "event_id", "claim_key", "status": "pending",
                           "reward": { "type", "id", "name", "count" } } ],
    "chapter_journal": [], "terminal_tools": [],
    "package_context": {}, "recent_run_summaries": []
  },
  "retired_campaign_ids": [], "used_run_ids": []
}
```

### 10.2 客户端持久化

| 项 | 值 |
|---|---|
| 存储 | `shared_preferences`，key `adventure_v3_save` |
| 归档 | 同 key 的 `archives[]`，最多 3 条（D12） |
| 写入 | CAS：`expectedRevision` 不匹配 → `AdventureV3StoreConflict` |
| 旧存档清理 | D11：key 前缀 `adventure_runtime_v1` 全部删除 |
| 待发奖励 | 独立 key `adventure_v3_pending_rewards` |

### 10.3 七个 outcome 枚举

`great_success`（大成功）、`success`（成功）、`failure`（未成功）、`victory`（战斗胜利）、`defeat`（战败）、`retreat`（撤退）、`resolved`（已执行）。

---

## 11. API 一览

### 11.1 AI 冒险服务端（`aiwordspromts`，默认 :3000）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{status, service, contracts}` |
| GET | `/api/capabilities` | 契约 / 包版本 / 章节清单 / 目录统计 / 功能开关 / 限制 |
| GET | `/api/apk` | `{url, version}`（客户端更新） |
| POST | `/api/chat` | AI 通道（v3 或 legacy 双通道分流），SSE |
| POST | `/api/adventure/transition` | 控制通道 6 action，JSON |

`/api/capabilities` 关键字段：

```jsonc
{
  "contracts": { "streaming": "yaml-visible-fields-v3", "runtime": "adventure-runtime-v5",
                 "templates": "five-template-v3", "output": "five-template-v3",
                 "framing": "fixed_template_quoted_scalar_v1",
                 "package_version": "2026.11.01.3",
                 "campaign": "continuous-eight-chapter-v3" },
  "chapters": [ { "id": "CH01", "index": 1, "name": "艾德村庄", "count": 24,
                  "gold_gain_cap": 500, "material_slots": 2, … } ],
  "catalog": { "chapter_count": 8, "standard_rounds": 234, "event_count": 273,
               "hidden_event_count": 7 },
  "features": { "continuous_campaign": true, "server_validates_output": true,
                "transition_endpoint": "/api/adventure/transition",
                "play_modes": […], "battle_result": […], "reward_signals": {…} },
  "limits": { "max_runtime_yaml_chars": 262144, "max_request_bytes": 8388608,
              "max_output_chars": 262144, "max_concurrent_per_ip": 2,
              "sse_heartbeat_ms": 5000 }
}
```

### 11.2 游戏后端（既有商业后端）

客户端主要使用的域（完整定义见 `aiwords/api.json`，OpenAPI）：

| 域 | 端点前缀 |
|---|---|
| 认证 | `/api/v1/auth/*` |
| 用户 / 阵容 | `/api/v1/user-*` |
| 卡牌 / 养成 | `/api/v1/user-cards`、`/api/v1/card-cultivation/*` |
| 神器 / 装备 | `/api/v1/user-artifacts`、`/api/v1/artifact-cultivation/*`、`/api/v1/inventory/equipments/*` |
| 背包 | `/api/v1/inventory/*` |
| 召唤 | `/api/v1/gacha/*` |
| 锻造 | `/api/v1/equip/forge/*` |
| 邮件 | `/api/v1/mails/*`（含 claim） |
| 章节 / 关卡 | `/api/v1/chapters/*` |
| 爬塔 / 副本 | `/api/v1/towers/*`、`/api/v1/adventures/*` |
| 商城 / 充值 | `/api/v1/mall/*`、`/api/v1/rc/*` |
| 任务 | `/api/v1/ntasks/*` |
| **v3 奖励邮件（待上线）** | `/api/v1/adventure-campaign/rewards/mail` |

---

## 12. 配置、环境与部署

### 12.1 服务端环境变量（`.env` / `.env.production`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 主 API 端口 |
| `PROXY_PORT` | 3001 | CORS 代理端口 |
| `PROXY_ENABLED` | true | 是否启用代理 |
| `PROXY_TARGET` | `https://f8q3w6v1.dimecho.com` | 代理目标（游戏后端） |
| `AI_BASE_URL` | 火山方舟 | OpenAI 兼容地址 |
| `AI_API_KEY` | — | **生产必填**，否则启动即失败 |
| `AI_MODEL` | `deepseek-v4-flash-ga-260731` | 模型名 |
| `CLIENT_ORIGINS` | `http://localhost:5173` | CORS 白名单（生产禁 `*`） |
| `REQUEST_MAX_BYTES` | 8MB | 请求体上限 |
| `AI_MAX_OUTPUT_CHARS` | 256KB | 输出上限 |
| `AI_MAX_COMPLETION_TOKENS` | 16384 | token 上限 |
| `SSE_HEARTBEAT_MS` | 5000 | 心跳间隔 |
| `RATE_LIMIT_PER_MINUTE` | 30 | 每 IP 每分钟请求数 |
| `MAX_CONCURRENT_PER_IP` | 2 | 每 IP 并发 |
| `ENABLE_PROMPT_FILTER` / `PROMPT_BLACKLIST` | — | legacy 通道提示词过滤 |
| `AI_DEBUG_TRACE` | dev 开 / prod 关 | AI 调用落盘追踪 |
| `AI_DEBUG_LOG_DIR` | `./logs/ai-trace` | 追踪目录 |
| `AI_DEBUG_LOG_MAX_AGE_DAYS` | 7 | 追踪保留天数 |

### 12.2 客户端编译期环境（`AppEnv`）

| 变量 | Web 覆盖 | APK 默认 |
|---|---|---|
| `API_BASE_URL` | `http://localhost:3001` | `https://f8q3w6v1.dimecho.com` |
| `ADVENTURE_API_BASE_URL` | `http://localhost:3000` | `http://8.137.38.227:3000` |
| `UPDATE_API_BASE_URL` | `http://localhost:3000` | `http://8.137.38.227:3000` |
| `DEBUG_ENTRIES` | — | `false`（release 默认剔除调试入口） |

```bash
flutter run      --dart-define-from-file=.env.development
flutter build apk --release --dart-define-from-file=.env.production
```

### 12.3 部署

```bash
# 服务端：一键部署（git push → 远端 pull → docker build → up）
./deploy.sh
# 远端默认：8.137.38.227 ~/aitransfer/aiwordspromts
```

- **多阶段 Dockerfile**：`node:20-alpine`，非 root 用户（uid 1001），`dumb-init` 转发信号，容器级 HEALTHCHECK。
- **镜像内容**：`src/`（含 vendor/v3）+ `数据拆分包_20260904/`（legacy 通道依赖）+ `apk-info.json`。
- **docker-compose**：单服务，限制 1 CPU / 512MB，json 日志 20MB×5，健康检查 30s。
- **优雅关闭**：SIGINT/SIGTERM → 依次 close server 与 proxy server。

---

## 13. 测试与工具链

### 13.1 服务端

```bash
npm test                     # node --test "src/**/*.test.mjs"（153 用例）
npm run check:v3             # 校验 vendor 与数据包一致
npm run check:v3-catalog     # 校验章节目录
npm run gen:v3-catalog       # 重新生成目录
npm run verify:bundle        # 验证 legacy 完整模拟
```

| 测试文件 | 覆盖 |
|---|---|
| `src/tests/v3_adapter.test.mjs`（733 行） | 校验分支、预迁移、状态推进、control channel、过期拒绝 |
| `src/tests/server_v3.test.mjs`（414 行） | v3 控制通道 HTTP、v3 AI 通道 HTTP |
| `src/tests/server.test.mjs`（666 行） | legacy 通道、SSE、限流、幂等 |
| `src/tests/output_constraint.test.mjs`（377 行） | 五模板输出约束 |
| `src/tests/proxy_encoding.test.mjs`（93 行） | 代理 gzip/content-length 处理 |

### 13.2 客户端

```bash
flutter analyze     # 必须 0 issues（pre-commit 与 CI 都会跑）
flutter test
dart format .
```

v3 相关测试：`test/adventure/adventure_v3_models_test.dart`、`adventure_v3_roundtrip_regression_test.dart`（序列化往返回归）。

### 13.3 探针工具

| 工具 | 用途 |
|---|---|
| `tools/probe_v3_e2e.mjs` | 端到端跑完一章 |
| `tools/probe_v3_schedule.mjs` | 事件排期正确性 |
| `tools/probe_v3_timing.mjs` | 各阶段耗时测量 |

---

## 14. 关键不变量与踩坑清单

> 以下每一条都对应一次线上/测试事故，改动相关代码前务必复核。

| # | 不变量 | 违反后果 |
|---|---|---|
| 1 | `pending_interaction` 必须**显式输出 `null`**，不能省略 key | 引擎用 `=== null` 严格比较 → `undefined` → start/next_round 被误判「新事件状态非法」，错误信息完全指不到原因 |
| 2 | `world_story_state` 必须原样回传 | 服务端校验 `campaign_id`/`revision` 一致性 → `跨章存档版本不一致` |
| 3 | `applied_request_ids` 必须原样回传 | 幂等失效 → `重复结算` |
| 4 | `choose` 的 `selected_option` 必须**原样复制** pending 中的对象 | 引擎 `JSON.stringify` 逐字节比对 → `selected_option不一致`，整局卡死 |
| 5 | `reward_requests` 无 pending 才能 `close_chapter` | `先完成已预留奖励确认，再提交章节` |
| 6 | 直选结算（`expected_template_name === '结算'`）必须直接 `commitSettlement` | 误走 `acceptResolution` → phase 卡在 `awaiting_battle_result` |
| 7 | `nextRound()` 只能由服务端执行（装配前预迁移） | 客户端自行推算轮数/补给 → 与引擎状态漂移 |
| 8 | 每章必须使用**从未用过的新 `run_id`** | `重复或越章提交` |
| 9 | `claim_key` 绝不可重新生成 | 重复发信 / 幂等失效 |
| 10 | AI 输出校验失败**绝不推进状态** | v3 要求「失败输出不可作为成功缓存」 |
| 11 | 客户端**不推算** `state_version` / `completed_events` / 轮数 | 两端口径漂移 |
| 12 | 客户端**不自行解析 YAML** 展示结算 | 与服务端校验口径漂移（应直接用 `output`） |
| 13 | `reward_state` 必须由服务端注入 | 客户端目录是 schedule-only，算不出章节 economy 额度 |
| 14 | 奖励周期以**服务端**日期为准 | 客户端时区不一致导致周期错乱 |
| 15 | 服务端回包必须先于 `[DONE]` 下发 | 客户端拿不到存档 |
| 16 | `request_guard` 不匹配必须丢弃回包 | 重开/换 run 后的迟到回包污染存档 |
| 17 | vendor 目录**勿手改** | 与数据包源不一致，`sync_v3 --check` 失败 |
| 18 | `debug/` 引用必须包在 `AppEnv.enableDebugEntries` 门控内 | release 构建调试代码未被剔除 |

---

## 15. 遗留事项与风险

### 15.1 待游戏后端配合

| 项 | 状态 | 影响 |
|---|---|---|
| `POST /api/v1/adventure-campaign/rewards/mail` | **未上线** | 奖励无法真正以邮件发放；当前走 D9 本地待发队列兜底，UI 显示「待发放」 |
| 奖励额度与账号资源对接 | 未完成 | `material/relic/bond/equipment` 信号尚未落到账号背包 |
| 奖励周期额度校验 | 服务端已算 `reward_state`，后端未二次校验 | 跨端额度可能不一致 |

### 15.2 客户端遗留

| 项 | 说明 |
|---|---|
| 旧副本入口下线（P7 部分完成） | `/dungeon-list` → `AdventureStoryPage`（legacy）仍在；v3 替换后需移除路由与 `lib/adventure/adventure_stream_session.dart` 等 legacy 文件 |
| legacy 存档清理 | 已做 D11（`adventure_runtime_v1*` 前缀删除） |
| 章节回顾（`reviewable`）UI | 服务端 `AdventureChapterCard.reviewable` 已产出，客户端暂未做回顾页 |
| `AdventureV3StoryPage` 边界 | 退出确认、战斗中断、奖励弹窗去重等分支需 e2e 复核 |

### 15.3 服务端遗留

| 项 | 说明 |
|---|---|
| legacy 通道并存 | `runtime_contract.mjs` + `数据拆分包_20260904` 仍占镜像约 2.9MB；回滚窗口结束后可删 |
| 幂等表仅内存 | 多实例部署下不共享；当前单实例部署无影响 |
| 限流为进程内 | 同上 |
| 追踪日志落盘 | dev 默认开启；prod 默认关闭，需排查时临时开 `AI_DEBUG_TRACE=true` |

### 15.4 风险提示

- **D3 版本同步上线**：`adventure-runtime-v5` 会让线上旧客户端在 `ensureCompatible()` 直接抛 `UNSUPPORTED_CONTRACT`。服务端与客户端必须同版本发布。
- **LLM 输出不稳定**：五模板 Schema 校验失败会直接中断流程。当前无自动重试策略，靠客户端「重试」按钮。后续可考虑同一 `request_id` 的服务端重试（需放宽 `REQUEST_NOT_REPLAYABLE`）。
- **事件数量大**：`data.mjs` 65K 行 / 273 事件，prompt 装配耗时需持续观测（`prompt_assembly_ms` 指标）。

---

## 附录 A：文件速查

### 服务端

| 想改什么 | 文件 |
|---|---|
| 路由 / 分流 / SSE | `src/server/routes.mjs` |
| v3 校验 / 迁移 / 推进 | `src/engine/v3_adapter.mjs` |
| 契约常量 | `src/server/constants.mjs` |
| capabilities payload | `src/server/http_utils.mjs` |
| 模型流式封装 | `src/server/model_service.mjs` |
| 环境变量 | `src/server/config.mjs` |
| CORS 代理 | `src/server/proxy_server.mjs` |
| 引擎本体（勿改，改数据包） | `src/engine/vendor/v3/` |

### 客户端

| 想改什么 | 文件 |
|---|---|
| 冒险总览页 | `lib/pages/adventure/adventure_campaign_page.dart` |
| 章内剧情页 | `lib/pages/adventure/adventure_v3_story_page.dart` |
| 存档 / 模型 | `lib/adventure/v3/adventure_models.dart`、`adventure_store.dart` |
| operation 构造 | `lib/adventure/v3/adventure_operations.dart` |
| 网络通道 | `lib/adventure/v3/adventure_v3_api.dart` |
| 控制器 / 会话 | `lib/adventure/v3/adventure_controller.dart`、`adventure_v3_session.dart` |
| 奖励发放 | `lib/adventure/v3/adventure_reward_service.dart` |
| 展示模型 | `lib/adventure/v3/adventure_v3_output.dart` |
| 战斗种子 | `lib/pages/adventure/adventure_battle_seed.dart` |
| 战斗引擎 | `lib/battle/battle_simulator.dart`、`battle_formulas.dart` |
| 端点集中管理 | `lib/network/api_config.dart` |
| 编译期配置 | `lib/config/app_env.dart` |

---

*文档结束。如需更新，请同步修改 `aiwords/docs/INDEX.md` 与本文件日期。*
