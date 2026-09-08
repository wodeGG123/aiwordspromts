# Flutter 客户端开发提示词

你是一名资深 Flutter/Dart 客户端工程师。请在当前 Flutter 客户端项目中开发 AI 文字冒险游戏客户端。所有游戏规则、事件调度、NPC、敌人、场景、检定、战斗、奖励和终局条件都以 `数据拆分包_20260904` 为唯一来源；不得自行创作或猜测规则。

## 一、先阅读的资料和资产边界

开发前必须阅读：

1. `数据拆分包_20260904/README_研发先看_20260904.md`
2. `数据拆分包_20260904/状态拼装索引_20260904.json`
3. `数据拆分包_20260904/01_共享积木/流式输出契约_20260904.json`
4. `数据拆分包_20260904/03_完整流程模拟/00_流程总览.md`
5. `数据拆分包_20260904/00_源包/腐化魔王危机_结构化事件定义_20260904_v2.js`
6. `数据拆分包_20260904/04_验证工具/adventure_yaml_stream_parser.mjs`
7. 仓库已有客户端接入计划、SSE 适配器和测试。

客户端可以持有发布所需的结构化事件索引和必要的 NPC/场景展示数据，用于事件候选筛选和资产关联；客户端不得持有完整核心 system prompt、世界规则正文、引擎规则正文或 AI API Key。事件关联必须读取结构化字段（如 `event_id`、`schedule`、`asset_scope`、角色 ID/名称和场景 ID/名称），禁止扫描 `rules_text` 推断资产关系。

如果当前工程还没有 Flutter 目录，请先建立清晰的 Flutter 分层结构，并在 README 中说明如何接入现有后端；不要修改服务端来迁就客户端的错误请求。

## 二、目标与分层职责

客户端负责：

- 维护本局权威的运行态和 `state_version`。
- 根据当前阶段、轮数、场景和已完成事件筛选结构化事件候选。
- 将事件、选项、NPC、敌人和场景关联到合法资产。
- 生成完整 `runtime_yaml` 和公开请求体。
- 调用 Node.js 服务端 `GET /health`、`GET /api/capabilities`、`POST /api/chat`。
- 用 HTTP 流逐字消费 SSE，将可见 YAML 字段临时渲染为纯文本。
- 收到完整结束帧后解析并校验 YAML、模板、Schema 和本局业务快照。
- 校验成功后原子提交事件、检定、战斗、结算和终章状态。
- 持久化 pending、事件完整对象、结算对象、幂等记录和请求快照。

客户端不负责：

- 不直接调用大模型，不保存 AI Key，不拼装核心 system prompt。
- 不把临时流文本当作权威游戏状态。
- 不在流未完成或校验失败时开放选项、启动战斗、扣资源、发奖励、改变场景或推进回合。
- 不根据模型自由文本决定合法事件、奖励或资产。

## 三、建议的 Dart 模块

按项目约定实现下列职责：

- `AdventureApiClient`：健康检查、能力查询、POST 请求、响应头错误解析、SSE 字节读取、取消。
- `AdventureRequestFactory`：从不可变本地状态创建请求快照和 `runtime_yaml`，做发送前校验。
- `EventCatalog`：加载结构化事件定义，按轮数、阶段、完成列表、当前场景和白名单筛选候选，并返回 NPC/敌人/场景关联。
- `AdventureYamlStreamSession`：为一次请求创建 parser、累积流、管理 preview/done/error/cancelled 生命周期。
- `AdventureStateMachine`：只允许当前阶段合法的 operation 和模板，防止 UI 越权发请求。
- `AdventureCommitter`：进行版本比较、幂等判断和单事务提交。
- `AdventureRepository`：持久化运行态、pending interaction、请求快照和已完成结果。
- UI 层：只订阅状态，不直接组装请求或修改权威状态。

## 四、公开服务端接口

启动或进入副本时调用：

- `GET {API_BASE_URL}/health`
- 只有 `status: ok` 且 `contracts.runtime = adventure-runtime-v4`、`contracts.streaming = yaml-visible-fields-v3`、`contracts.templates = five-template-v3` 时才允许开始 AI 流程；版本不匹配要显示升级提示。

AI 请求：

- `POST {API_BASE_URL}/api/chat`
- Header：`Content-Type: application/json`、`Idempotency-Key: operation.request_id`
- 成功：HTTP 200、`text/event-stream`
- 普通帧：`data: <原始 YAML 新增片段>\n\n`
- 结束帧：`data: [DONE]\n\n`
- 错误帧：`event: error\ndata: {"code":"...","message":"..."}\n\n`
- Header 发送前的失败是 JSON `error` 对象，不是 SSE。

不能使用 `EventSource`，因为它不支持带 JSON 请求体的 POST。必须使用 Dart `HttpClient` 或 `package:http` 的 streamed response，按 UTF-8 增量解码后解析 SSE。UTF-8 多字节字符可能跨网络分块，必须保留 decoder 状态。

## 五、运行态、事件和资产关联

请求顶层必须包含：

- `runtime_yaml`
- `operation`
- `state_version`
- `current_round`
- `current_scene_id`
- `story_state`
- `pending_interaction`
- `event_context`

`story_state` 至少保留：

- `completed_events`、`story_flags`
- `route_scores.combat/scheme/cleanse`
- `current_scene_id`、`visited_scene_ids`
- `npc_states`、`unresolved_hooks`、`memory_notes`、`recent_event_ids`
- `run_archetype`、恰好两项 `run_modifier_ids`

事件候选流程：

1. 从结构化事件定义读取事件 ID、schedule 和 fixed/repeatable 属性。
2. 用当前 phase/round、已完成事件和当前场景筛选合法候选。
3. 依据 `asset_scope.roles.core/possible` 关联 NPC、敌人；依据 `asset_scope.scenes.core/possible` 关联场景。
4. 保持候选顺序和正整数 weight；不重复，不把白名单外的资产发给服务端。
5. 为 `start`/`next_round` 写入 `candidate_event_ids` 和必要的 `forced_event_id`；forced ID 必须位于候选中。
6. 保存 `event_context` 的事件包版本、模板契约版本、事件 ID、候选 ID、NPC 名称、场景 ID/名称。

不要把 `rules_text` 当作运行时事件数据库，也不要让模型返回的名称替换结构化 ID。展示层可通过 ID 查本地资产名称，提交层以 ID 和快照为准。

### 场景字段的强制约定

`current_scene_id`、`story_state.current_scene_id`、`story_state.visited_scene_ids[]` 和 `pending_interaction.scene_id` 必须存储并发送结构化场景 ID，例如 `scene_village`；不得写展示名称“艾德村庄”。展示名称只能写入 `scene_name` 或由客户端通过本地 `sceneId -> sceneName` 映射派生。一次状态提交必须同时更新上述所有场景 ID 字段，禁止只更新显示名称。

事件完成后开始 `next_round` 前，客户端必须先原子提交结算结果：把本次事件 ID 写入 `story_state.completed_events`，将 `current_round` 递增到下一轮，并根据新的轮数重新筛选候选事件。不得在第 1 轮再次提交只允许第 1 轮的固定事件 `M01`。

## 六、operation 和模板状态机

固定映射：

- `start` -> `新一轮事件`：创建新 run，首轮不扣回合消耗。
- `next_round` -> `新一轮事件`：上轮已提交后增加轮数，扣一次固定消耗。
- `choose` -> `检定`、`战斗事件` 或 `结算`：模板必须由已校验选项原样决定。
- `settle_check` -> `结算`：必须携带上一份完整检定结果。
- `battle_result` -> `结算`：必须携带战斗系统产生的 victory、defeat 或 retreat。
- `finale` -> `终章`：只在 run 已清除、永久奖励已提交后调用。

建议状态：`idle`、`streaming`、`validating`、`committing`、`completed`、`failed`、`cancelled`。同一 run 处于 streaming/validating/committing 时，禁止发起会改变同一状态的第二个操作。

pending interaction 必须至少包含：

- `event_id`、`scene_id`、`scene_name`
- `phase`
- 完整 `event_output`
- `option_id`、`selected_option`
- 检定或战斗所需的 `resolution_output`（存在时保存完整对象）

特别要求：`pending_interaction.event_output` 必须保存完整的新事件解析对象，不能只保存字符串、摘要或 options。`settle_check` 和 `battle_result` 必须把上一份完整检定/战斗对象写入 `pending_interaction.resolution_output`。

## 七、SSE 解码和实时渲染

每次逻辑操作必须创建：新的 AbortController、新的 parser、冻结的请求快照和唯一 request ID。网络重试必须复用完全相同的 request ID 和快照，不得重抽事件、重复扣资源或提前增加 state_version。

SSE 解码器要求：

1. 以 `\n\n` 或 `\r\n\r\n` 识别完整事件，网络 chunk 可在任意字节处切断。
2. 只处理以空行终止的完整 SSE 事件；流关闭时未终止的尾部必须丢弃并报告协议错误。
3. `data:` 后去掉一个可选前导空格；之后的 YAML 内容逐字传给 parser，不得 trim、JSON 化、拼接额外换行或字符去重。
4. `event: error` 解析错误对象后立即失败；HTTP JSON 错误、读取异常、取消、超时也立即失败。
5. 只有收到一次 `[DONE]` 才调用一次 `parser.finish()`；连接自然关闭但没有 `[DONE]` 是协议错误，不得当作成功。
6. 使用数据包解析器的 `providerChunkMode: delta_text`、`emitMode: complete_visible_field`。服务端每帧是新增文本片段，不得误当累计全文。

可见字段允许在完成前以纯文本临时渲染：

- `event_details.current_theme`
- `event_details.steps[].narration`
- `event_details.steps[].dialogues[].npc`
- `event_details.steps[].dialogues[].speech`
- `event_details.analysis`
- `event_details.content`

必须等完整结束并通过校验后才发布：

- `event_details.options`
- `event_details.result`
- `combat_start`
- `enemies`
- `event_details.summary`
- `event_details.story_patch`
- `event_details.final_chapter`

临时预览必须使用纯文本 widget，不能把模型内容作为 HTML、Markdown 或可执行内容渲染。校验失败时清除临时预览或标记为失败，不得保留为权威剧情。

## 八、完成校验和原子提交

`parser.finish()` 成功后执行业务校验：

- 模板名称等于快照的 expected template；事件 ID、选项 ID、场景和 pending 逐字匹配。
- 新事件 ID 属于候选/白名单，NPC、敌人、场景和奖励属于对应结构化资产范围。
- 事件符合当前轮调度和场景连接关系。
- 检定、战斗、结算的输入来自本地已提交快照；战斗结果只接受战斗系统的权威结果。
- 资源变化、道具、货币、永久奖励、story patch 和 final chapter 符合数据包规则、白名单和终局条件。
- 当前本地 `state_version` 仍等于请求快照版本，request ID 尚未提交。

通过后使用单次事务或 compare-and-swap：

- 新一轮事件：保存完整 `event_output`，创建 pending，锁定事件/场景，更新 visited/current scene，再递增 state version。
- 检定：保存完整检定对象，pending 进入等待结算；不直接应用 story patch 或奖励。
- 战斗事件：保存完整战斗配置，pending 进入等待战斗结果；不把模型输出当战斗结果。
- 结算：保存完整 resolution output，应用已校验 summary/story patch 和合法资源变化，判断终局，清空 pending，再递增 state version。
- 终章：只渲染已校验的终章内容，不重新发放已经提交的奖励或改写战斗事实。

任何网络错误、parser 错误、业务校验失败、取消或版本冲突都必须保持原有 state version、资源、奖励、场景和 pending 不变。临时预览和 provisional 数据必须与权威状态分离。

## 九、错误、重试和恢复

- 400：显示请求契约错误，并记录 code/message/details 和本地构造诊断。
- 409：重新加载最新本地状态；同一 request ID 不得覆盖新状态。
- 413：提示运行态过大；优先压缩历史旁白，不能删除必要的 story_state、pending、事件 ID 或规则字段。
- 429：按 Retry-After 或退避策略重试，但复用快照。
- 500/502/UPSTREAM_ERROR：允许用同一 request ID 和同一冻结快照重试。
- 用户取消显示 cancelled，不显示成业务失败。
- 超时分首字节超时和总超时；中止流后可重试，但不能提交未完成结果。
- 应用重启后恢复已持久化的权威状态；若存在 streaming 状态，视为未提交，清理临时预览并允许用原快照重试。
- 已提交的 request ID 从本地幂等记录返回结果，不能再次扣资源、追加事件或发奖励。

## 十、测试和验收

至少实现并通过：

1. 版本匹配/不匹配、能力查询和服务端不可用测试。
2. 事件候选筛选、fixed round、完成事件过滤、NPC/敌人/场景白名单和场景关联测试。
3. 六种 operation、五种模板、非法阶段和非法 pending 的请求构造测试。
4. SSE 在任意 UTF-8 字节位置和任意事件边界切分时，重组 YAML 与服务端逐字一致。
5. `[DONE]` 只触发一次 finish；缺少 `[DONE]`、未闭合事件、流内 error、HTTP JSON 错误、读取异常和取消均不提交。
6. delta_text 与累计文本输入测试；累计模式必须先转为单调 delta，不能在同一 parser 中混用。
7. 可见字段实时显示测试；options、result、combat_start、enemies、summary、story_patch、final_chapter 在 finish 前不可用。
8. 非法 YAML、模板错误、Schema 错误、事件/资产越界和业务校验错误均回滚临时状态。
9. 完整对象保存测试：`event_output`、`resolution_output` 在后续检定、战斗和结算请求中完整可恢复。
10. state version 冲突、重复 request ID、网络重试和应用重启恢复测试，确认不重复扣除或发放。
11. 按数据包完整流程模拟七步验收：`start`、检定选择、检定结算、`next_round`、战斗选择、战斗结算、`finale`。
12. 所有模型文本按纯文本展示，不能执行 HTML、Markdown 或脚本内容。

交付时提供：架构说明、状态机图、请求样例、运行配置说明、测试命令和已知限制。完成标准是：客户端不接触核心提示词和 AI Key；每次成功提交都可恢复；每次失败都不污染权威状态；实时显示和最终解析同时可靠。
