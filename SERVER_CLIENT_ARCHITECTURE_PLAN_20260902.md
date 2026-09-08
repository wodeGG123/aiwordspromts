# AI 冒险系统服务端与客户端落地架构方案

版本：`2026-09-02`  
适用项目：`aiwordspromts`  
关联契约：

- 运行态契约：`adventure-runtime-v4`
- AI 输出契约：`five-template-v3`
- 流式展示契约：`yaml-visible-fields-v3`
- 成帧协议：`fixed_template_quoted_scalar_v1`

## 1. 目标与总体结论

系统拆分为两个节点：

- 服务端：提供 HTTP API，接收客户端提交的 runtime YAML，完成请求校验、提示词装配、调用上游 AI，并以 SSE 流返回原始 YAML 文本。
- 客户端：维护玩家运行状态，构造 runtime YAML，调用服务端，显示临时剧情，使用解析器验证完整 AI 响应，并在校验成功后提交本地状态变化。

建议第一阶段采用“服务端无业务状态、客户端携带完整运行态”的架构：

```text
客户端本地状态
    -> 构造冻结的 runtime YAML
    -> POST /api/chat
服务端
    -> 校验请求
    -> 装配模块化提示词
    -> 调用 AI 服务
    -> SSE 转发原始 YAML 增量
客户端
    -> SSE 重组
    -> 临时显示白名单剧情
    -> 完整 YAML + Schema + 业务快照校验
    -> 原子更新本地状态
```

但生产环境不能把“客户端提交的 runtime”直接视为可信状态。推荐将系统设计成两层：

- 客户端负责交互和本地显示；
- 服务端保存或验证关键状态，至少保存 `request_id`、`state_version`、已提交操作和奖励记录。

这样客户端可以继续提交 runtime YAML，但服务端不会因为客户端篡改金币、奖励、完成事件或战斗结果而直接信任数据。

## 2. 现有原型分析

当前仓库已有以下原型能力：

- `src/index.js`：Node HTTP 服务，已有 `/health` 和 `POST /api/chat`。
- `src/runtime_contract.mjs`：校验 operation、回合、场景、候选事件、pending 和 story state，并调用模块化提示词入口。
- `src/sse_adapter.mjs`：客户端 `fetch` + SSE 文本适配器。
- `src/data_20260826/腐化魔王危机_模块化入口_20260826_v4.js`：按五种模板和上下文模式装配提示词。
- `src/data_20260826/adventure_yaml_stream_parser.mjs`：客户端完整 YAML、Schema 和流式临时展示解析器。

进入生产前必须处理的原型问题：

1. `src/index.js` 中不得保留默认 AI 密钥，密钥必须来自部署环境或密钥管理服务。
2. 不能长期使用 `Access-Control-Allow-Origin: *`；正式环境应配置客户端允许来源。
3. 服务端当前主要校验输入请求，输出完整 YAML 的最终业务校验仍在客户端；生产服务端至少要做基本输出验证和审计。
4. 服务端需要增加认证、请求限流、超时、最大 token、模型白名单和日志脱敏。
5. 客户端 SSE 适配器需要保证完整 SSE 事件才交给解析器，`[DONE]` 只处理一次；连接提前关闭必须视为失败。
6. `runtime_contract.mjs` 中的 package context、客户端能力和运行态字段应继续收紧，避免只校验外层而不验证 runtime YAML 内容。
7. 服务端不应接受客户端任意传入的模型名称作为生产模型；模型应由服务端配置，或使用受控模型白名单。

## 3. 服务端职责边界

服务端应该负责：

- 用户认证和请求授权；
- 校验请求体大小、JSON 格式和运行态协议；
- 校验包版本和服务端已加载包版本是否匹配；
- 根据 operation 选择上下文模式；
- 读取结构化事件定义并装配提示词；
- 过滤用户输入中的服务端禁止内容；
- 调用上游 AI；
- 将 AI 增量内容转换成统一 SSE；
- 记录 request_id、状态版本、模型、耗时和结果摘要；
- 取消客户端已断开的上游请求；
- 做幂等检查，避免同一请求重复调用或重复提交；
- 对服务端允许执行的业务动作做最终审计。

服务端不应该负责：

- 根据临时剧情创建 pending；
- 根据 AI 流式片段启动战斗；
- 将未完成的结算应用到账户；
- 通过自然语言推断真实资源变化；
- 让 AI 决定当前状态机下一步；
- 把客户端传来的任意奖励直接写入账号。

建议将“AI 生成”和“业务提交”拆开：

- `/api/chat` 只生成 AI 提案；
- `/api/operations/commit` 或服务端内部提交逻辑负责验证并提交业务结果。

如果第一期仍由客户端本地提交状态，也要让服务端保存 request 审计记录，并在下一期把关键提交迁移到服务端。

## 4. 服务端框架搭建

### 4.1 推荐目录

```text
src/
  server/
    app.mjs                  HTTP 路由和中间件
    config.mjs               环境变量和配置校验
    auth.mjs                 认证、授权、用户上下文
    routes/
      health_route.mjs
      adventure_route.mjs
      operation_route.mjs
    services/
      prompt_service.mjs     runtime 校验和提示词装配
      model_service.mjs      上游 AI 调用
      stream_service.mjs     SSE 输出
      idempotency_service.mjs
      commit_service.mjs
    repositories/
      run_repository.mjs
      request_repository.mjs
      reward_repository.mjs
    validators/
      request_validator.mjs
      response_validator.mjs
      business_validator.mjs
    observability/
      logger.mjs
      metrics.mjs
  runtime_contract.mjs
  data_20260826/
```

当前项目可以继续使用 Node.js 原生 `http` 作为最小部署版本。正式扩展时建议使用 Fastify 或 Express：

- Fastify 适合高吞吐、JSON Schema、插件化和较少中间件；
- Express 适合团队已有经验和生态兼容。

无论选择哪个框架，AI 调用、SSE、校验和提交都应放在 service 层，不要全部堆在路由文件中。

### 4.2 配置

必须配置并在启动时校验：

```text
PORT=3000
NODE_ENV=production
AI_BASE_URL=https://...
AI_API_KEY=由部署平台注入
AI_MODEL=服务端固定模型
AI_ALLOWED_MODELS=...
CLIENT_ORIGINS=https://game.example.com
AUTH_ISSUER=...
AUTH_AUDIENCE=...
REQUEST_MAX_BYTES=8388608
AI_TIMEOUT_MS=120000
AI_MAX_OUTPUT_CHARS=262144
RATE_LIMIT_PER_MINUTE=...
ENABLE_PROMPT_FILTER=true
```

缺少 `AI_API_KEY`、生产环境使用通配 CORS、生产环境开启调试日志或模型不在白名单时，服务端应拒绝启动。

### 4.3 服务端分层

请求流程建议固定为：

```text
认证中间件
  -> 限流中间件
  -> 请求体大小限制
  -> JSON 解析
  -> request validator
  -> 幂等检查
  -> prompt service
  -> model service
  -> stream service
  -> 审计记录
```

模型服务只接受内部标准参数，不直接接受完整 HTTP request，避免上游调用逻辑和协议校验耦合。

## 5. 服务端接口

### 5.1 健康检查

```http
GET /health
```

用途：部署探针、客户端版本门禁和运维检查。

成功响应：

```json
{
  "status": "ok",
  "service": "adventure-api",
  "version": "2026.09.02",
  "contracts": {
    "runtime": "adventure-runtime-v4",
    "output": "five-template-v3",
    "streaming": "yaml-visible-fields-v3",
    "framing": "fixed_template_quoted_scalar_v1"
  },
  "packages": {
    "engine": { "id": "...", "version": "..." },
    "world": { "id": "...", "version": "..." },
    "dungeon": { "id": "...", "version": "..." }
  }
}
```

健康检查不得暴露 API 密钥、上游详细错误、数据库连接字符串或完整提示词。

### 5.2 服务端能力信息

```http
GET /api/capabilities
Authorization: Bearer <access-token>
```

用途：客户端启动时确认服务端支持的副本、契约、模板、流式模式和限制。

响应示例：

```json
{
  "contracts": {
    "runtime": "adventure-runtime-v4",
    "output": "five-template-v3",
    "streaming": "yaml-visible-fields-v3"
  },
  "dungeons": [
    {
      "id": "dungeon1.frontend-streaming-integration",
      "version": "2026.08.26.2",
      "event_count": 39
    }
  ],
  "templates": ["新一轮事件", "战斗事件", "检定", "结算", "终章"],
  "provider_chunk_mode": "delta_text",
  "limits": {
    "max_runtime_yaml_chars": 262144,
    "max_request_bytes": 8388608,
    "max_enemies": 4
  }
}
```

### 5.3 AI 流式请求

```http
POST /api/chat
Authorization: Bearer <access-token>
Content-Type: application/json
Accept: text/event-stream
Idempotency-Key: <same value as operation.request_id>
```

请求体使用当前 runtime 协议：

```json
{
  "runtime_yaml": "完整运行态 YAML 字符串",
  "operation": {
    "type": "start",
    "request_id": "run_123_start_001",
    "expected_template_name": "新一轮事件"
  },
  "state_version": 0,
  "current_round": 1,
  "current_scene_id": "scene_forest",
  "story_state": {
    "completed_events": [],
    "story_flags": [],
    "route_scores": { "combat": 0, "scheme": 0, "cleanse": 0 },
    "current_scene_id": "scene_forest",
    "visited_scene_ids": ["scene_forest"],
    "npc_states": [],
    "unresolved_hooks": [],
    "memory_notes": [],
    "recent_event_ids": [],
    "run_archetype": "balanced",
    "run_modifier_ids": ["MOD_A", "MOD_B"]
  },
  "pending_interaction": null
}
```

成功响应必须是 SSE：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

普通文本事件：

```text
data: event_details:\n
\n
```

实际服务端应直接传输新增 YAML 文本，不增加 JSON 包装，不加入 chunk 序号，不加入 AI 自定义标记。

结束事件：

```text
data: [DONE]\n
\n
```

流内错误：

```text
event: error
 data: {"code":"UPSTREAM_ERROR","message":"模型调用失败"}

```

建议服务端为错误定义统一格式：

```json
{
  "error": {
    "code": "RUNTIME_CONTRACT_INVALID",
    "message": "请求运行态不符合协议",
    "type": "request_error",
    "request_id": "run_123_start_001",
    "details": {}
  }
}
```

HTTP 状态建议：

- `200`：开始 SSE 流；
- `400`：JSON、运行态或 operation 不合法；
- `401`：未认证；
- `403`：无权访问副本或 run；
- `404`：接口或 run 不存在；
- `409`：`state_version` 或幂等状态冲突；
- `413`：请求体或 runtime YAML 过大；
- `429`：限流；
- `499`：客户端主动断开，可作为内部日志状态，不要求所有代理都支持；
- `502`：上游 AI 失败；
- `504`：上游超时；
- `500`：服务端内部错误。

### 5.4 非流式请求接口

建议增加一个非流式接口用于调试、回归测试和不需要实时展示的终章：

```http
POST /api/chat/complete
```

响应：

```json
{
  "request_id": "run_123_start_001",
  "raw_yaml": "完整 AI YAML",
  "template_name": "新一轮事件",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```

该接口不能绕过相同的输入校验和输出校验。

### 5.5 请求状态和幂等查询

如果服务端持久化请求记录，增加：

```http
GET /api/requests/{request_id}
Authorization: Bearer <access-token>
```

响应状态可以是：

```json
{
  "request_id": "run_123_start_001",
  "status": "completed",
  "state_version": 1,
  "template_name": "新一轮事件",
  "result": {
    "raw_yaml": "...",
    "value": {}
  }
}
```

状态枚举建议为：`accepted`、`streaming`、`completed`、`failed`、`cancelled`、`committed`。

### 5.6 业务提交接口

如果最终状态由服务端保存，增加：

```http
POST /api/runs/{run_id}/operations/commit
Authorization: Bearer <access-token>
Content-Type: application/json
```

请求包含：

```json
{
  "request_id": "run_123_settle_003",
  "state_version": 8,
  "response": {
    "raw_yaml": "完整 AI YAML",
    "value": {}
  },
  "client_snapshot_hash": "sha256..."
}
```

服务端验证通过后使用数据库事务或 compare-and-swap：

- 校验请求未提交；
- 校验 `state_version` 仍匹配；
- 校验事件、选项、场景、检定或战斗结果；
- 校验资源余额、奖励授权和终局条件；
- 更新 run 状态；
- 写入 request 幂等记录；
- 一次性提交所有变化。

客户端仍然可以先临时显示内容，但最终权威状态由服务端提交结果返回。

## 6. Runtime YAML 约定

### 6.1 请求构造

客户端每次操作必须：

1. 读取当前本地权威状态；
2. 创建新的 `operation.request_id`；
3. 深拷贝并冻结快照；
4. 用稳定序列化器生成 runtime YAML；
5. 将同一快照提交给服务端；
6. 重试时复用同一个 request ID 和同一快照。

重试不能：

- 重新抽事件；
- 增加回合；
- 改变 state version；
- 重新扣资源；
- 增加检定次数；
- 修改玩家选择。

### 6.2 operation 规则

| operation.type | 期望模板 | 说明 |
| --- | --- | --- |
| `start` | `新一轮事件` | 创建或启动一局冒险 |
| `next_round` | `新一轮事件` | 上一事件已经结算后进入下一轮 |
| `choose` | `检定`、`战斗事件`、`结算` | 复制已确认选项，不由 AI 决定 |
| `settle_check` | `结算` | 带回程序计算的检定结果 |
| `battle_result` | `结算` | 带回战斗系统确认的结果 |
| `finale` | `终章` | 只在 run 已结束并完成奖励处理后调用 |

客户端状态机计算 `expected_template_name`。UI 只能发出“选择选项”“取消”“重试”等用户动作，不能直接指定模板。

### 6.3 pending_interaction

`pending_interaction` 在新事件通过完整校验后创建，并在结算提交成功后清空。至少保存：

- `event_id`；
- `phase`；
- `scene_id`；
- `scene_name`；
- 完整新事件输出；
- `option_id`；
- `selected_option`；
- 已确认的 `check_result` 或 `battle_result`。

choose、settle_check 和 battle_result 必须使用 pending 中的事件和锁定场景。AI返回的 event ID 或场景不匹配时拒绝提交。

## 7. 客户端框架搭建

### 7.1 推荐目录

```text
client/src/
  api/
    adventure_api_client.mjs
    sse_reader.mjs
  adventure/
    adventure_request_factory.mjs
    adventure_stream_session.mjs
    adventure_state_machine.mjs
    adventure_committer.mjs
    adventure_business_validator.mjs
  state/
    run_store.mjs
    request_store.mjs
  ui/
    story_renderer.mjs
    choice_panel.mjs
    combat_panel.mjs
    check_panel.mjs
    error_presenter.mjs
```

如果客户端是 React、Vue 或其他框架，以上职责仍应保持独立，不要让组件直接拼接 YAML 或修改游戏状态。

### 7.2 客户端模块职责

`adventure_api_client`：

- 调用 `/health` 和 `/api/capabilities`；
- 发起 `/api/chat`；
- 处理 HTTP 错误；
- 提供取消请求能力。

`sse_reader`：

- 处理任意网络分片；
- 只返回完整 SSE 事件；
- 支持 `data:`、`event:`；
- 收到 `[DONE]` 只回调一次；
- 流关闭前未收到 `[DONE]` 则报错。

`adventure_request_factory`：

- 从本地状态构造 operation；
- 生成 runtime YAML；
- 检查字段一致性；
- 生成 request snapshot；
- 计算可选的 snapshot hash。

`adventure_stream_session`：

- 为一次操作创建解析器；
- 接收 SSE 文本片段；
- 连接 `onProvisional` 和 UI；
- 在结束时调用 `finish()`；
- 统一处理成功、失败、取消和超时。

`adventure_business_validator`：

- 校验 AI 输出是否符合本次快照；
- 校验事件、场景、角色、敌人和选项白名单；
- 校验检定和战斗结果；
- 校验资源、奖励、story patch 和终局条件。

`adventure_committer`：

- 使用 state version 做 compare-and-swap；
- 只提交一次；
- 失败时不修改本地权威状态；
- 保存 request_id 幂等结果。

`run_store`：

- 保存权威本地状态；
- 区分 committed state 和 provisional UI state；
- 永远不把临时文本混入 story_state。

## 8. 客户端状态模型

建议将状态拆成三层：

```js
{
  committed: {
    stateVersion: 8,
    currentRound: 4,
    currentSceneId: "scene_forest",
    storyState: {},
    rewardState: {},
    pendingInteraction: null
  },
  provisional: {
    visibleUnits: [],
    rawYaml: "",
    enabled: true
  },
  request: {
    requestId: null,
    status: "idle",
    snapshot: null,
    abortController: null
  }
}
```

只有 `committed` 可以作为下一次 runtime 的来源。`provisional` 只能用于当前屏幕显示。流结束失败时清空 `provisional`，保留 `committed` 不变。

## 9. 客户端完整交互流程

### 9.1 启动阶段

1. 客户端调用 `GET /health`。
2. 比较 runtime、output、streaming 和 framing 契约版本。
3. 调用 `GET /api/capabilities`。
4. 确认当前副本和客户端发布包版本兼容。
5. 加载本地 run 状态。
6. 如果状态损坏或版本不兼容，阻止进入冒险页面。

### 9.2 发起 AI 请求

1. 状态机根据当前状态计算 operation。
2. 客户端验证该 operation 合法。
3. 复制当前 committed state 作为快照。
4. 生成 request ID。
5. 创建 `AdventureYamlStreamParser`。
6. 设置 `providerChunkMode: "delta_text"`。
7. 设置 `expectedTemplateName`、`expectedEventId`、`expectedSceneName` 和 `allowedEventIds`。
8. 通过 `fetch` POST `/api/chat`。
9. 进入 `streaming` 状态并锁定同一 run 的操作按钮。

### 9.3 接收和显示剧情

服务器返回的每一个 `data:` 文本片段都直接传入解析器。解析器只展示以下字段：

- `current_theme`；
- `steps[].narration`；
- `steps[].dialogues[].npc`；
- `steps[].dialogues[].speech`；
- `analysis`；
- `content`。

所有文本使用纯文本节点显示。不能使用 `innerHTML`、Markdown 执行器或链接解析器。

临时剧情不能：

- 打开选项；
- 创建 pending；
- 启动战斗；
- 改变场景；
- 修改资源；
- 发放奖励；
- 设置终局状态。

### 9.4 完成和提交

1. 收到 `[DONE]`。
2. 确认没有 SSE error。
3. 调用一次 `parser.finish()`。
4. 运行 `validateBusiness`。
5. 比较当前 committed `stateVersion` 和请求快照。
6. 如果使用服务端提交接口，将结果发送到 `/operations/commit`。
7. 服务端或本地 compare-and-swap 成功后，写入 committed state。
8. 将 provisional 剧情转为 confirmed 剧情。
9. 开放下一步 UI 操作。

## 10. 五种模板对应的客户端行为

### 新一轮事件

完整校验成功后：

- 保存 event ID；
- 锁定和保存场景；
- 创建 pending；
- 保存完整事件输出；
- 展示并开放可用选项。

### 战斗事件

完整校验成功且敌人通过本地资产白名单检查后：

- 创建战斗配置；
- 将 pending 改为等待战斗结果；
- 启动本地战斗系统。

不能在流式输出中看到 `combat_start` 就启动战斗。

### 检定

完整校验成功后：

- 使用程序真实计算的属性、难度和结果；
- 展示检定结果；
- 保存检定结果到 pending；
- 进入等待结算状态。

不能让 AI 结果替代程序固定公式。

### 结算

完整校验成功后：

- 校验事件、选项和结果；
- 校验资源 delta 和物品变化；
- 校验 story patch；
- 判断终局条件；
- 一次性更新状态；
- 清空 pending。

### 终章

只有程序已确认 run 结束，并完成永久奖励处理后才请求。终章只作为叙事内容展示，不再反向修改运行状态。

## 11. SSE 客户端实现要求

当前 `src/sse_adapter.mjs` 应按以下规则改造：

1. 使用增量 `TextDecoder`。
2. 缓冲区只按完整空行分割 SSE 事件。
3. 不把未结束的尾部事件交给上层。
4. 普通 `data:` 内容去掉最多一个协议前导空格，不调用整体 `trim()`。
5. `event: error` 立即终止本次业务流。
6. `[DONE]` 只触发一次完成信号。
7. 连接自然关闭但没有 `[DONE]` 时，报告 `INCOMPLETE_STREAM`。
8. 收到 DONE 后忽略后续异常重复 DONE，不重复调用 finish。
9. 主动 abort 不显示成业务失败。
10. 网络错误、HTTP 错误和 SSE error 使用统一错误模型。

建议使用以下生命周期：

```text
created
  -> connecting
  -> streaming
  -> done_received
  -> validating
  -> committed
```

异常状态：

```text
connecting/streaming -> failed
connecting/streaming -> cancelled
validating -> failed
```

## 12. 服务端输出校验建议

当前完整 Schema 位于客户端发布包中。生产服务端也应至少执行以下检查：

- 输出是单份 YAML，没有 YAML 外文本；
- 模板与 operation 一致；
- 事件 ID、场景名与请求快照一致；
- 输出字段集合和字段顺序正确；
- 敌人数为 1 至 4；
- 选项 ID 为正数且不重复；
- `story_patch.completed_event_id` 与 event ID 一致；
- 资源 delta 在允许范围内；
- 永久奖励触发信号不被直接写入普通背包；
- 输出字符数不超过限制。

更严格的业务校验仍必须结合服务端存储的 run 状态完成。客户端业务校验不能替代服务端安全校验。

## 13. 数据库建议

第一阶段至少建立以下数据：

### `runs`

- `run_id`；
- `user_id`；
- `dungeon_id`；
- `state_version`；
- `current_round`；
- `current_scene_id`；
- `run_status`；
- `state_json` 或结构化状态列；
- `created_at`、`updated_at`。

### `operation_requests`

- `request_id` 唯一键；
- `run_id`；
- `user_id`；
- operation type；
- state version；
- 请求摘要 hash；
- 状态；
- 原始响应或对象存储地址；
- 错误码；
- 创建和完成时间。

### `run_events`

- `run_id`；
- `event_id`；
- option ID；
- outcome；
- story patch；
- 资源变化；
- 提交 request ID；
- 创建时间。

### `reward_grants`

- `user_id`；
- `run_id`；
- reward trigger ID；
- 授权来源事件；
- 状态；
- 唯一幂等键；
- 发放时间。

永久奖励必须用数据库唯一约束防止重复发放，不能只依赖客户端判断。

## 14. 安全要求

### 认证和授权

- 使用 Bearer token、JWT 或现有账号会话；
- 服务端从 token 获取 user ID，不接受客户端任意传 user ID；
- 每个 run 必须绑定 user ID；
- 请求中的 run、事件和奖励只能访问当前用户范围。

### CORS 和网络

- 生产环境使用明确的客户端来源白名单；
- 服务端部署在 HTTPS 后；
- SSE 代理关闭响应缓冲；
- 设置反向代理读取超时和最大响应时间；
- 不能把 AI API 暴露给客户端，AI 密钥只存在服务端。

### 输入和输出

- 限制请求体、runtime YAML、单行和总输出长度；
- 对用户输入做黑名单或安全过滤，但记录过滤动作；
- 不在日志中记录完整 runtime、完整提示词、token 或敏感用户输入；
- AI 输出按纯文本展示；
- 受限 YAML 拒绝重复键、危险键、块标量、标签、锚点和复杂键。

### 限流和资源保护

- 按用户、IP、run 和 endpoint 限流；
- 限制单用户并发 AI 请求数；
- 上游请求设置 AbortController 和总超时；
- 客户端断开时取消上游请求；
- 限制模型输出长度；
- 对失败重试使用指数退避，但不改变 request snapshot。

## 15. 可观测性

每个请求至少记录结构化日志：

```json
{
  "request_id": "run_123_start_001",
  "run_id": "run_123",
  "user_id_hash": "...",
  "operation_type": "start",
  "expected_template": "新一轮事件",
  "state_version": 0,
  "model": "server-configured-model",
  "context_mode": "event_generation",
  "status": "completed",
  "http_status": 200,
  "duration_ms": 4200,
  "output_chars": 18320,
  "error_code": null
}
```

建议指标：

- 请求数量和成功率；
- 按 operation type 的成功率；
- AI 上游延迟和错误率；
- SSE 中断率；
- YAML/Schema 失败率；
- 业务校验失败率；
- 重复 request_id 数量；
- 平均输入输出字符数；
- 每用户和每 run 的调用次数。

## 16. 部署拓扑

推荐部署方式：

```text
浏览器或游戏客户端
        |
      HTTPS
        |
反向代理 / Load Balancer
        |
冒险 API 服务集群
   |          |          |
Redis      PostgreSQL   AI Provider
```

职责：

- 反向代理：TLS、CORS、SSE 不缓冲、连接超时、基础限流；
- API 服务：认证、协议、提示词、模型调用和业务校验；
- Redis：短期限流、流式请求状态和幂等快速查询；
- PostgreSQL：run、事件、请求和奖励的最终记录；
- AI Provider：仅由服务端访问。

如果第一期不接数据库，至少使用 Redis 保存 request_id 幂等状态，并明确“客户端状态是可恢复缓存，不是账号最终账本”。

## 17. 实施顺序

### 阶段一：整理现有原型

1. 移除代码中的默认 AI 密钥。
2. 增加启动配置校验。
3. 限制 CORS 为环境配置。
4. 固定服务端模型或建立模型白名单。
5. 收紧 runtime_contract 的字段和 package 版本校验。
6. 修复 SSE 解析器的尾部事件和重复 DONE 问题。
7. 增加服务端超时、输出上限和客户端断开取消。
8. 保留现有 `/api/chat` 作为最小可用接口。

验收标准：客户端能稳定完成五种模板的完整解析，流中断时不改变状态。

### 阶段二：客户端状态机

1. 创建 committed/provisional/request 三层状态。
2. 实现 request factory。
3. 实现 `start`、`next_round`、`choose`、`settle_check`、`battle_result`、`finale` 路由。
4. 接入 `AdventureYamlStreamParser`。
5. 实现纯文本剧情展示。
6. 实现 pending 快照和本地 compare-and-swap。
7. 加入取消、超时、重试和错误提示。

验收标准：任何 AI 流式失败都不会开放选项、启动战斗或修改资源。

### 阶段三：服务端持久化与提交

1. 增加用户认证和 run 绑定。
2. 建立 `runs`、`operation_requests`、`run_events`、`reward_grants`。
3. 增加 `/api/requests/{request_id}`。
4. 增加 `/api/runs/{run_id}/operations/commit`。
5. 服务端实现 state version 和幂等事务。
6. 将奖励、资源和 story patch 的最终提交迁移到服务端。

验收标准：刷新页面、重复请求、并发请求和客户端篡改 runtime 都不能导致重复提交或越权奖励。

### 阶段四：生产运维

1. 加入 Redis 限流和幂等缓存。
2. 加入 PostgreSQL 事务和唯一约束。
3. 配置反向代理 SSE 参数。
4. 加入指标、日志、告警和链路追踪。
5. 做压力、断网、超时、上游失败和灰度发布测试。
6. 将包版本、哈希和契约校验接入 CI/CD。

## 18. 测试和验收清单

### 协议测试

- 健康检查版本匹配和不匹配；
- 未认证、无权限和过期 token；
- 缺字段、错误类型、错误模板和错误 operation；
- 回合、场景、候选事件和 pending 不一致；
- 请求体和 runtime YAML 超限。

### 流式测试

- SSE 事件被任意网络字节切分；
- UTF-8 多字节字符跨 chunk；
- `delta_text` 不去重；
- `[DONE]` 只触发一次；
- 提前断流失败；
- SSE error 失败；
- HTTP 400/409/502/504 失败；
- 主动取消不产生业务提交；
- 客户端断开后服务端取消上游。

### 五模板测试

- 新一轮事件创建 pending；
- 战斗事件不会提前启动战斗；
- 检定只接受程序确认结果；
- 结算原子提交 summary 和 story patch；
- 终章不能改变业务状态；
- 非法 YAML、未知字段、字段顺序错误和枚举错误全部拒绝。

### 幂等和并发测试

- 同一 request ID 重试返回同一结果；
- 已提交 request ID 不重复扣资源；
- 旧 state version 不能覆盖新状态；
- 两个并发选择只能有一个提交成功；
- 永久奖励同一触发信号只能发放一次。

### 安全测试

- 客户端篡改金币、钻石、奖励和 battle result；
- 客户端越权访问其他用户的 run；
- prompt 注入和用户输入过滤；
- CORS 来源验证；
- 超长请求和慢速连接；
- 日志中不出现 API key 和完整敏感输入。

## 19. 推荐的最小端到端伪代码

### 客户端

```js
async function runAdventureOperation(operation) {
  const snapshot = createFrozenRequestSnapshot(committedState, operation);
  const parser = new AdventureYamlStreamParser({
    expectedTemplateName: snapshot.operation.expected_template_name,
    expectedEventId: snapshot.pending_interaction?.event_id,
    expectedSceneName: snapshot.pending_interaction?.scene_name,
    allowedEventIds: snapshot.event_candidates?.map(item => item.event_id),
    providerChunkMode: "delta_text",
    emitMode: "complete_visible_field",
    onProvisional: unit => provisionalStore.append(unit),
    onProvisionalDisabled: info => provisionalStore.disable(info.reason),
    validateBusiness: value => validateAgainstSnapshot(value, snapshot)
  });

  try {
    requestStore.start(snapshot);
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": `Bearer ${accessToken}`,
        "Idempotency-Key": snapshot.operation.request_id
      },
      body: JSON.stringify(snapshot.requestBody),
      signal: snapshot.abortController.signal
    });

    await consumeSseResponse(response, {
      onText: text => parser.feedTextFrame(text),
      onDone: () => {},
      onError: error => { throw error; }
    });

    const completed = parser.finish();
    await commitWithCompareAndSwap(completed.value, snapshot);
    provisionalStore.confirm();
    requestStore.complete(completed);
  } catch (error) {
    parser.abort(error.code ?? "CLIENT_OPERATION_FAILED");
    provisionalStore.clear();
    requestStore.fail(error);
    throw error;
  }
}
```

### 服务端

```js
async function handleChat(request, response) {
  const user = await requireUser(request);
  await rateLimiter.check(user.id);

  const input = await readJsonWithLimit(request, MAX_REQUEST_BYTES);
  const validated = validateRequest(input);
  await assertRunAccess(user, validated);
  await assertIdempotency(validated.requestId, validated.stateVersion);

  const prepared = preparePromptFromRequest(input, {
    blacklist: PROMPT_BLACKLIST
  });

  const upstream = await modelService.stream({
    prompt: prepared.prompt,
    model: SERVER_MODEL,
    signal: request.signal
  });

  response.writeHead(200, SSE_HEADERS);
  for await (const text of upstream) {
    writeSseData(response, text);
  }
  writeSseDone(response);
  await recordRequestCompleted(validated, prepared);
}
```

伪代码中的 `commitWithCompareAndSwap()` 不能只比较客户端传回的对象；生产版本应调用服务端提交接口，或至少由服务端校验并记录最终提交。

## 0. 可执行结论（先按这个版本实施）

### 0.1 两个节点的明确职责

| 节点 | 必须负责 | 明确不负责 |
|---|---|---|
| 服务端 | 认证、用户与 run 权限、请求大小限制、Runtime YAML 协议校验、包版本校验、提示词装配、AI 密钥保管、模型调用、SSE 转发、请求幂等、审计、最终状态提交 | 不把自然语言当作业务事实；不让客户端指定任意模型；不依赖客户端校验保护金币和奖励 |
| 客户端 | 展示已提交剧情、收集玩家操作、维护临时流、构造 Runtime YAML、SSE 重组、完整 YAML 解析、客户端业务预校验、战斗/检定 UI、提交前后状态展示 | 不在流式片段中修改权威状态；不决定服务端权限；不直接调用 AI Provider；不自行发放永久奖励 |

**推荐的生产边界**：客户端可以携带 Runtime YAML 作为上下文，但服务端必须使用数据库中的 run 状态作为最终依据。客户端提交的是“操作请求和上下文快照”，不是可信账本。

### 0.2 两阶段部署策略

**阶段 A：联调版**

- 保留 `POST /api/chat` SSE 接口。
- 服务端使用内存或 Redis 保存 `request_id`，不保存完整游戏账本。
- 客户端本地 `committed` 状态作为当前运行态。
- 只适合内部联调和单用户演示，不适合账号奖励、跨设备恢复或对抗性环境。

**阶段 B：生产版**

- 增加 `run_id`、认证、PostgreSQL 和提交接口。
- `/api/chat` 只生成并记录 AI 提案，不能直接改变 run。
- `POST /api/runs/{run_id}/operations/commit` 在事务内校验并提交状态。
- 资源、战斗结果、完成事件和永久奖励由服务端最终确认。

开发顺序应先完成阶段 A 的端到端链路，再把提交逻辑迁移到阶段 B；客户端的 `committed/provisional/request` 三层状态模型从第一天就按生产模型设计。

### 0.3 一个操作的核心规则

一次玩家操作对应一个不可变的 `request_id` 和一个不可变快照：

```text
客户端 committed state
  -> 生成 run_id + request_id + state_version
  -> 序列化 Runtime YAML
  -> POST /api/chat（仅生成提案）
  -> SSE 临时显示
  -> [DONE]
  -> 完整 YAML / Schema / 业务校验
  -> POST /api/runs/{run_id}/operations/commit
  -> 服务端 compare-and-swap + 数据库事务
  -> 返回新 state_version 和 committed state
  -> 客户端确认剧情并开放下一操作
```

网络重试只能复用同一 `request_id`、同一快照和同一 `state_version`。新的玩家操作才生成新的 `request_id`。

## 1.1 资源和接口命名约定

所有需要持久化的请求都必须包含 `run_id`。现有原型请求体尚未强制该字段，阶段 A 可以从 `operation.request_id` 派生临时 run 标识，但阶段 B 必须将它提升为顶级字段并由服务端校验归属。

建议统一使用以下字段：

```json
{
  "run_id": "run_123",
  "operation": {
    "request_id": "run_123_round_4_choose_2",
    "type": "choose",
    "expected_template_name": "检定"
  },
  "state_version": 8,
  "runtime_yaml": "..."
}
```

`request_id` 标识一次调用，`run_id` 标识一局冒险，`state_version` 标识该局状态版本。三者不能互相替代。

## 1.2 服务端接口总表

| 方法 | 路径 | 阶段 | 作用 | 是否改变 run |
|---|---|---|---|---|
| `GET` | `/health` | A/B | 存活、契约和发布包版本 | 否 |
| `GET` | `/api/capabilities` | A/B | 返回副本、模板、限制和服务能力 | 否 |
| `POST` | `/api/chat` | A/B | 校验请求、装配提示词、以 SSE 返回 AI 原始 YAML 增量 | 否 |
| `POST` | `/api/chat/complete` | A/B | 非流式调试和回归接口 | 否 |
| `GET` | `/api/requests/{request_id}` | B | 查询生成请求状态和结果 | 否 |
| `POST` | `/api/runs` | B | 创建一局冒险并返回初始状态 | 是，创建 |
| `GET` | `/api/runs/{run_id}` | B | 获取服务端权威状态 | 否 |
| `POST` | `/api/runs/{run_id}/operations/commit` | B | 提交已校验 AI 提案或程序结果 | 是 |
| `POST` | `/api/runs/{run_id}/operations/cancel` | B，可选 | 取消未提交请求或标记放弃 | 仅改变请求状态 |

所有 `/api` 接口都要求认证；`/health` 可以匿名，但不得泄露密钥、完整提示词或数据库连接信息。

## 1.3 `/api/chat` 的服务端处理顺序

路由层只做协议编排，具体逻辑放入 service 层：

1. 认证并取得 `user_id`。
2. 校验 `run_id` 归属和客户端版本。
3. 限制请求体、Runtime YAML 长度和并发数。
4. 解析 JSON，执行 `validateRequest()`。
5. 检查 `Idempotency-Key` 与 `operation.request_id` 相同。
6. 检查相同 `request_id` 的历史状态：已完成则返回已缓存结果，处理中则返回冲突或恢复信息。
7. 以服务端加载的包版本和固定模型装配提示词。
8. 记录 `accepted`，调用 AI Provider。
9. 将 Provider 的新增文本逐段包装为 `data: <delta>\n\n`。
10. 正常结束只发送一次 `data: [DONE]\n\n`；失败发送 `event: error` 并关闭连接。
11. 记录输出摘要、耗时、字符数和最终请求状态。

客户端传入的 `model` 在生产环境直接拒绝；模型只能来自服务端配置或服务端白名单映射。

## 1.4 提交接口的权威规则

`POST /api/runs/{run_id}/operations/commit` 接受以下最小结构：

```json
{
  "request_id": "run_123_round_4_choose_2",
  "state_version": 8,
  "raw_yaml": "完整 AI YAML",
  "validated_value": {},
  "program_result": {
    "check_result": null,
    "battle_result": null
  },
  "client_snapshot_hash": "sha256..."
}
```

服务端必须重新解析和校验 `raw_yaml`，不能信任 `validated_value`。事务内依次执行：

- 查询并锁定 `runs` 行；
- 验证用户、`run_id`、`request_id` 和 `state_version`；
- 验证 operation 对应的 pending、事件、选项、场景和程序结果；
- 根据服务器规则计算资源变化和奖励；
- 写入 `run_events`、`reward_grants` 和新的 run 状态；
- 将 `state_version` 加一；
- 记录幂等结果并提交事务。

重复提交同一 `request_id` 必须返回第一次提交结果；不同请求使用旧版本必须返回 `409 STATE_VERSION_CONFLICT`。事务失败时客户端不得确认临时剧情。

## 1.5 客户端必须实现的状态边界

客户端将状态明确分成：

- `committed`：服务端确认或阶段 A 本地原子提交的唯一权威快照来源；
- `provisional`：当前 SSE 已显示但尚未确认的纯文本；
- `request`：请求 ID、冻结快照、AbortController、SSE 和解析器状态。

UI 可以从 `provisional` 读取文字，但选项、战斗启动、检定提交、场景切换、资源变化、奖励和终章状态只能从 `parser.finish()` 成功且 commit 成功后的结果产生。页面刷新时丢弃 `provisional`，恢复最近一次 `committed`。

客户端模块应保持以下依赖方向：

```text
UI -> state machine -> request factory -> API client -> SSE reader -> parser
UI <- provisional store                         <- commit result <- server
```

UI 组件不得直接拼 YAML、直接调用 `fetch`、直接修改 `story_state`，也不得从 AI 文本中正则提取奖励或战斗结论。

## 1.6 上线前硬性门禁

以下条件全部满足后才允许生产发布：

- 代码中没有默认 AI API Key，生产缺少密钥时启动失败；
- CORS 只允许配置的客户端来源；
- 生产客户端不能传任意 `model`；
- 服务端有认证、run 权限检查、请求限流、超时和输出上限；
- SSE 客户端在提前断流时失败，`[DONE]` 只处理一次；
- 服务端和客户端都能重新校验 AI 输出；
- commit 使用数据库事务、`state_version` compare-and-swap 和唯一幂等键；
- 永久奖励存在数据库唯一约束；
- 日志不包含 API Key、完整提示词和未脱敏用户输入；
- 39 个事件、五种模板、重复请求、并发请求、篡改资源和中断恢复测试通过。

---

## 20. 最终落地原则

整个系统必须坚持以下顺序：

```text
状态快照
  -> operation 校验
  -> 上下文装配
  -> AI 流式生成
  -> 临时纯文本展示
  -> 完整 YAML 解析
  -> Schema 校验
  -> 本次业务快照校验
  -> 幂等和 state_version 校验
  -> 原子提交
  -> 确认剧情和开放下一步操作
```

最重要的工程边界是：

- 服务端掌握 AI 密钥和最终业务授权；
- 客户端掌握 UI 交互和临时剧情显示；
- AI 只生成受限格式的提案；
- 临时流只影响显示，不影响状态；
- 只有一次完整、可验证、幂等的提交可以改变游戏状态；
- 所有资源、奖励、战斗结果和终局状态最终都必须由程序确认。
