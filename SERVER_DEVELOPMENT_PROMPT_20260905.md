# Node.js 服务端开发提示词

你是一名资深 Node.js 后端工程师。请在当前仓库中开发 AI 文字冒险游戏服务端。你的实现必须以 `数据拆分包_20260904` 为唯一游戏规则来源，以现有服务端代码为基础增量完善，不得凭经验改写剧情、属性、奖励、事件调度或模板规则。

## 一、先阅读并遵守的资料

开发前必须阅读：

1. `数据拆分包_20260904/README_研发先看_20260904.md`
2. `数据拆分包_20260904/状态拼装索引_20260904.json`
3. `数据拆分包_20260904/腐化魔王危机_预切片积木入口_20260904.mjs`
4. `数据拆分包_20260904/01_共享积木/流式输出契约_20260904.json`
5. `数据拆分包_20260904/03_完整流程模拟/00_流程总览.md`
6. `数据拆分包_20260904/04_验证工具/验证完整模拟_20260904.mjs`
7. 仓库中的 `src/runtime_contract.mjs`、`src/server/routes.mjs`、`src/server/model_service.mjs`、`src/server/http_utils.mjs`、`src/server/idempotency_store.mjs` 及现有测试。

生产代码只能调用数据包提供的模块化入口，例如 `prepareAiMessages`；禁止在业务代码中扫描、截取、拼接、猜测提示词字符串，也禁止用事件正文推断事件调度或资产关系。

注意：仓库中的历史实现可能仍引用旧版本 `src/data_20260826`。请先核实版本和路径；生产实现必须切换到 `数据拆分包_20260904` 的发布入口，并通过发布包验证。不要用“看起来相同”的旧文件替代新数据包。

## 二、目标与职责边界

服务端负责：

- 保存并保护核心提示词、世界规则、引擎规则、事件包和 AI API Key。
- 接收客户端生成的运行态请求，校验请求契约和事件资产边界。
- 根据 operation 和模板调用数据包入口组装 system prompt 与 user prompt。
- 使用服务端配置的模型和密钥调用上游大模型。
- 以 SSE 流式转发模型输出，支持客户端实时解析。
- 对请求进行大小限制、限流、并发限制、超时、取消和幂等处理。
- 在服务端完成最小协议与模板一致性校验，并记录可诊断错误。

服务端不负责：

- 不向客户端返回完整 system prompt、核心规则文档、事件规则正文或 API Key。
- 不承担 UI 渲染，不创建客户端的 `pending_interaction`，不替客户端提交资源、奖励或剧情状态。
- 不把模型输出改写为自定义 JSON 游戏状态。
- 不相信客户端传入的奖励、战斗结果或任意自由文本是权威事实；只校验其结构和与当前运行态的一致性。

## 三、HTTP API

实现并稳定支持：

### 1. 健康检查

`GET /health`

返回服务状态和契约版本，至少包含：

```json
{"status":"ok","contracts":{"runtime":"adventure-runtime-v4","streaming":"yaml-visible-fields-v3","templates":"five-template-v3"}}
```

### 2. 能力查询

`GET /api/capabilities`

返回支持的模板、operation、流协议版本和服务端能力，但不得泄露核心提示词内容。

### 3. AI 流接口

`POST /api/chat`

请求头：`Content-Type: application/json`；支持 `Idempotency-Key`，它存在时必须与 `operation.request_id` 相同。

成功响应：HTTP 200，`Content-Type: text/event-stream`，并发送：

- 普通文本：`data: <YAML新增片段>\n\n`
- 结束：`data: [DONE]\n\n`
- 流内错误：`event: error\ndata: {"code":"...","message":"..."}\n\n`

响应体是无 JSON 包装的原始 YAML 文本流。SSE 编码时，YAML 中每个换行必须编码为独立的 `data:` 行；不得把整个 YAML 包进 JSON，不得丢失空格、换行、反斜杠或引号。

响应头发送前的错误返回 JSON：

```json
{"error":{"code":"...","message":"...","type":"client_error|server_error","details":{}}}
```

错误状态至少覆盖 400、413、409、429、502、500。

## 四、请求契约和 operation

客户端请求至少包含：

```json
{
  "runtime_yaml":"完整运行态 YAML",
  "operation":{
    "type":"start|next_round|choose|settle_check|battle_result|finale",
    "request_id":"稳定且唯一的逻辑请求 ID",
    "expected_template_name":"新一轮事件|检定|战斗事件|结算|终章"
  },
  "state_version":0,
  "current_round":1,
  "current_scene_id":"scene_village",
  "story_state":{},
  "pending_interaction":null,
  "event_context":{}
}
```

严格校验：

- 必填字段类型、非空值、整数范围和未知 operation。
- `state_version >= 0`，`current_round >= 1`。
- `story_state.current_scene_id` 与顶层场景一致；route scores 的 `combat`、`scheme`、`cleanse` 为整数；`run_modifier_ids` 恰为两项。
- 活动事件必须存在于结构化事件定义中。
- `event_context.event_package_version`、副本包版本和模板契约版本必须匹配当前发布包。
- `npc_names`、`scene_ids`、候选事件和 forced event 必须属于结构化资产白名单。
- `start`/`next_round` 的候选事件必须属于当前轮调度范围；非新轮操作的事件必须与 pending 事件一致。
- `settle_check` 和 `battle_result` 必须有 pending interaction；pending 的 event ID 和 scene ID 必须与请求及活动事件一致。
- 正式客户端不能指定 `model`、system prompt、AI Key 或提示词资产路径。

固定映射如下，不允许自由组合：

- `start` -> `新一轮事件`
- `next_round` -> `新一轮事件`
- `choose` -> `检定`、`战斗事件` 或 `结算`，由客户端已选项的合法模板决定
- `settle_check` -> `结算`
- `battle_result` -> `结算`
- `finale` -> `终章`

## 五、提示词组装和模型调用

1. 将已校验请求映射为数据包入口所需参数。
2. 调用 `prepareAiMessages`，使用其返回的 `systemPrompt` 作为 system 消息、`userPrompt` 作为 user 消息。
3. 使用环境变量中的 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`；生产环境缺少 Key 或 CORS 白名单时启动失败。
4. 设置上游连接超时、总超时、输出字符上限和 AbortSignal。
5. 只接受模型文本 delta；忽略没有文本内容的 SDK 片段。
6. 每次模板不匹配重试必须使用纠错提示和相同请求快照，不能把第一次错误文本混入第二次输出。
7. 重试耗尽发送 `SCHEMA_TEMPLATE_MISMATCH`，包含期望模板、实际模板和尝试次数。

服务端可以执行轻量的模板名检查，但不得把不完整 YAML 当作完整业务结果提交。服务端的职责是转发；完整 YAML、Schema 和业务快照校验由客户端完成。

## 六、真正的流式要求

模型上游产生一个 delta 后，应立即编码并写入 SSE，不能先等待整个模型响应再一次发送。每个 SSE 普通 data 片段必须保持原始顺序和内容。不得去重，不得按字符合并，不得 trim。

如果当前模板检查需要完整文本，应将该检查限制在独立的内部缓冲区；成功后再输出最终内容，或者明确实现可验证的流式模板门控。无论采用哪种方案，都必须保证客户端收到的是一次合法、顺序正确、无错误尝试残留的 YAML 流。

客户端断开时中止上游请求并标记幂等记录为 cancelled；不要继续消耗模型响应。

## 七、安全、可靠性与运行策略

- Key 只从环境变量或密钥管理系统读取，禁止日志打印、响应回传和客户端配置下发。
- 核心数据包只在服务端加载；禁止提供任意文件读取、提示词查看或模型代理配置接口。
- 限制 body 字节数、`runtime_yaml` 字符数、单 IP 速率和并发数。
- CORS 使用显式白名单，生产禁止 `*`。
- 记录 request ID、operation、模板、耗时、结果码和错误码；日志中屏蔽 runtime 原文、用户隐私和 Key。
- 对相同 `request_id` 和相同请求快照返回已完成的原始 YAML，不重复调用模型。
- 相同 ID 对不同快照返回 409；处理中重复请求返回明确的进行中错误。
- 不把模型异常、YAML 原文或内部堆栈直接返回给用户。
- 支持优雅关闭，停止接收新请求并取消活动上游调用。

## 八、测试和验收

请先补齐实现，再运行全部测试。至少增加：

1. 配置测试：生产缺 Key、通配 CORS、无效超时或大小配置均拒绝启动。
2. `/health`、`/api/capabilities` 的版本和能力测试。
3. 六种 operation 及三种 `choose` 模板的映射测试。
4. 非法 JSON、缺字段、错误类型、错误轮数、错误场景、未知事件、非法 NPC/场景、pending 不一致和候选越界测试。
5. SSE 编码测试：YAML 多行、空行、中文、引号、反斜杠和分块顺序逐字保持。
6. 上游 delta 立即转发测试、上游异常、超时、客户端取消和提前断开测试。
7. 模板不匹配重试与重试耗尽测试，确认错误尝试不会出现在最终流中。
8. 幂等成功重放、相同 ID 冲突、处理中重复、限流和并发限制测试。
9. 使用数据包 `03_完整流程模拟` 的七个完整步骤进行集成验证：`start`、`choose` 检定、`settle_check`、`next_round`、`choose` 战斗、`battle_result`、`finale`。
10. 运行数据包验证工具和仓库现有 Node 测试；修复失败而不是降低断言强度。

完成标准：客户端只需知道公开 API 契约即可工作；客户端无法取得 AI Key 或核心规则；每个成功响应都是可被客户端流式解析器逐字重组的原始 YAML；任何服务端拒绝都可由错误码定位。
