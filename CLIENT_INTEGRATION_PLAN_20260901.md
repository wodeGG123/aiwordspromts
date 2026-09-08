# 冒险运行态服务客户端修改计划

## 1. 目标与边界

客户端将现有冒险状态组装为请求，调用 `POST /api/chat`，消费服务器发送事件（SSE）中的原始 YAML 文本，并使用发布包的解析器完成最终校验。服务端只负责校验最小运行态协议、装配提示词和转发模型文本；它不会解析 AI 输出、创建 `pending_interaction`，也不会提交游戏资源或剧情状态。

本次客户端改造应以 `src/data_20260826/adventure_yaml_stream_parser.mjs` 为唯一的 AI 输出解析器。不要将流式文本作为 HTML 或 Markdown 渲染，也不要在流未完成时开放选项、启动战斗或更新任何权威游戏状态。

## 2. 服务端接口

### 2.1 健康检查

- `GET {API_BASE_URL}/health`
- 启动应用时或进入副本前调用一次。
- 仅当响应 `status: "ok"`，且 `contracts` 中的版本分别为 `yaml-visible-fields-v3`、`adventure-runtime-v4`、`five-template-v3` 时，允许进入 AI 冒险流程；不匹配时提示客户端与服务端版本不兼容。

### 2.2 AI 流式请求

- `POST {API_BASE_URL}/api/chat`
- 请求头：`Content-Type: application/json`。
- 成功：HTTP `200`、`Content-Type: text/event-stream`。
- 普通文本帧：`data: <原始 YAML 新增片段>\n\n`。
- 流结束帧：`data: [DONE]\n\n`。
- 流内错误帧：`event: error\ndata: {"code":"...","message":"..."}\n\n`。
- 在响应头尚未发送前发生的失败使用 JSON：`{ "error": { "code", "message", "type", "details?" } }`，状态通常为 `400`、`413`、`502` 或 `500`。

`EventSource` 不支持 POST 请求体，客户端必须使用 `fetch`、`ReadableStream.getReader()` 和 `TextDecoder` 消费 SSE。

## 3. 新增客户端模块

建议新增以下职责清晰的模块，具体路径按现有客户端工程约定落位。

1. `adventureApiClient`：健康检查、请求发送、SSE 帧解析、取消请求；不处理游戏状态。
2. `adventureRequestFactory`：从权威本地状态构造和本地预校验请求体；每次发送前冻结深拷贝快照。
3. `adventureStreamSession`：连接 API 客户端与 `AdventureYamlStreamParser`，管理临时展示、完成、失败和取消。
4. `adventureCommitter`：收到完整且校验通过的输出后，执行幂等、版本比较和原子状态提交。
5. `adventureStateMachine`：依据当前阶段产生合法 operation；UI 只能发出状态机允许的命令。

现有 `src/sse_adapter.mjs` 只能作为重写参考，不能直接接入生产：它会把最后一个未完成 SSE 块也交给解析器，并且可能对一次响应重复调用 `onDone`。新的实现必须只消费以空行终止的完整 SSE 事件，收到 `[DONE]` 后只完成一次，并在流关闭但未收到 `[DONE]` 时报告协议错误。

## 4. 请求构造与本地预校验

每个逻辑操作生成稳定且唯一的 `operation.request_id`。网络重试使用相同 `request_id` 和相同的冻结请求快照；不要因重连而重抽事件、增加 `check_attempt` 或预先修改 `state_version`。

请求顶级必填字段：

```json
{
  "runtime_yaml": "由客户端完整运行态序列化的 YAML 字符串",
  "operation": {
    "request_id": "run_123_round_4_choose_2",
    "type": "choose",
    "expected_template_name": "检定"
  },
  "state_version": 8,
  "current_round": 4,
  "current_scene_id": "scene_forest",
  "story_state": {
    "completed_events": [],
    "story_flags": [],
    "route_scores": { "combat": 0, "scheme": 0, "cleanse": 0 },
    "current_scene_id": "scene_forest",
    "visited_scene_ids": [],
    "npc_states": [],
    "unresolved_hooks": [],
    "memory_notes": [],
    "recent_event_ids": [],
    "run_archetype": "corruption_hunt",
    "run_modifier_ids": ["MOD_A", "MOD_B"]
  },
  "pending_interaction": null
}
```

规则如下：

- `runtime_yaml`、`operation`、`state_version`、`current_round`、`current_scene_id`、`story_state` 是服务端强制必填项；`state_version >= 0`，`current_round >= 1`。
- `story_state.current_scene_id` 必须等于顶层 `current_scene_id`。
- `story_state.route_scores` 必须包含整数 `combat`、`scheme`、`cleanse`；`run_modifier_ids` 必须恰好两项。
- `pending_interaction` 缺省或为 `null` 表示无未结算交互。存在时至少应含 `event_id`、`scene_id`，且 `scene_id` 必须等于顶层当前场景；客户端本地缓存还应保留 `phase`、`scene_name`、`event_output`、`option_id` 和 `selected_option`。
- 可选 `run_difficulty` 仅允许 `normal`、`hard`、`nightmare`。
- 可选 `model` 只用于受控环境的模型覆盖，正式客户端不应向普通用户暴露该字段。

### 操作到模板映射

| operation.type | expected_template_name | 客户端附加数据 |
|---|---|---|
| `start` | `新一轮事件` | 新建 run；`pending_interaction=null`；首轮不扣回合消耗。 |
| `next_round` | `新一轮事件` | 先完成上轮提交，再增加轮数并扣除一次固定消耗。 |
| `choose` | `检定`、`战斗事件` 或 `结算` | 从已校验新事件中原样复制 `event_id`、`option_id`、`selected_option`。 |
| `settle_check` | `结算` | 带回原事件和选项，以及上一份检定中的 `check_result`。 |
| `battle_result` | `结算` | 带回原事件和选项，以及战斗系统产生的 `victory`、`defeat` 或 `retreat`。 |
| `finale` | `终章` | 只在 run 已结束且奖励已提交后调用。 |

`choose` 后的模板必须由 `selected_option.template_name` 决定，不能由模型或 UI 自由选择。`结算` 请求必须带非空 `pending_interaction`。`start` 和 `next_round` 可带有序 `event_candidates`，每项仅含不重复的 `event_id` 与正整数 `weight`；过滤后没有候选时在本地阻止请求。若提供 `forced_event_id`，它必须在候选数组中。

## 5. SSE 与 YAML 解析流程

每次操作创建一个 `AbortController`、冻结请求快照和一个新的 `AdventureYamlStreamParser`。服务器的每个普通 `data:` 值都代表新的 YAML 文本片段，因此解析器配置固定为 `providerChunkMode: "delta_text"`。

```js
const parser = new AdventureYamlStreamParser({
  expectedTemplateName: snapshot.operation.expected_template_name,
  expectedEventId: snapshot.pending_interaction?.event_id,
  expectedSceneName: snapshot.pending_interaction?.scene_name,
  allowedEventIds: snapshot.event_candidates?.map(item => item.event_id),
  providerChunkMode: "delta_text",
  emitMode: "complete_visible_field",
  onProvisional: renderPlainTextPreview,
  onProvisionalDisabled: disablePreview,
  validateBusiness: value => validateAgainstSnapshot(value, snapshot)
});
```

实现要求：

1. 用 SSE 标准解析事件：以 `\r\n\r\n` 或 `\n\n` 分隔，只取完整事件；支持事件内容跨任意网络分片到达。
2. 普通 `data:` 帧将去掉一个可选前导空格后的文本传给 `parser.feedTextFrame(data)`；不得 trim、拼接额外换行、JSON 解析或按字符去重。
3. 收到 `event: error`、JSON HTTP 错误、读取异常、取消、超时，或连接在 `[DONE]` 前关闭时，调用 `parser.abort(reason)`，丢弃临时输出且不提交状态。
4. 仅在收到 `[DONE]` 后调用一次 `parser.finish()`。`finish()` 成功返回前，所有输出都是临时展示。
5. 文本预览一律以纯文本节点渲染。推荐首发使用 `complete_visible_field`，仅在验证 UI 对长字段的增量渲染后再启用 `sentence_inside_open_scalar`。

## 6. 完成校验与原子提交

`parser.finish()` 已校验 YAML 子集、字段顺序、五模板 Schema 及基础枚举；客户端仍须在 `validateBusiness(value, snapshot)` 中实现与本局快照相关的校验：

- 请求尚未按 `request_id` 提交，且当前本地 `state_version` 仍等于快照版本。
- 新一轮事件的 `event_id` 位于本次候选或装载白名单；场景、NPC、敌人和奖励位于该事件的资产白名单。
- 新一轮事件的目标 `scene_name` 可映射到合法场景，并符合当前场景连接规则。
- `choose`、检定、战斗和结算的事件、选项与 `pending_interaction` 逐字一致；战斗和结算场景不得改变。
- 检定结果、资源变化、道具、受控货币、永久奖励、`story_patch` 和 `final_chapter` 均满足本地规则和终局白名单。

校验通过后，使用单次状态事务或 compare-and-swap 提交：

- `新一轮事件`：创建 `pending_interaction`，锁定事件和场景，更新 `current_scene_id` 与 `visited_scene_ids`，并将 `state_version + 1`；随后才确认预览并开放选项。
- `检定`：缓存结果或将 pending phase 改为等待结算；不应用 `story_patch`。
- `战斗事件`：缓存战斗配置并将 pending phase 改为等待战斗结果；战斗程序的结果才是权威输入。
- `结算`：合并 `summary` 与 `story_patch`，判断硬阈值和终局条件，清空 pending，并将 `state_version + 1`。
- `终章`：仅渲染已校验内容，不允许其回写已提交的战斗、资源或奖励事实。

任一校验失败、状态版本冲突、网络错误或用户取消都必须回滚临时展示，保持 `state_version`、资源、奖励、场景和 pending 不变。

## 7. UI 状态与错误处理

为每个 run 维护 `idle`、`streaming`、`validating`、`committing`、`completed`、`failed`、`cancelled` 状态。`streaming` 到 `committing` 期间禁用会改变同一 run 的操作按钮，避免并发响应覆盖状态。

- HTTP `400`：显示可重试的协议请求错误，并记录 `error.code`、`message` 和 `details`；客户端应同时采集本地请求构造诊断。
- HTTP `413`：提示运行态过大；通过裁剪历史旁白而不是移除必要的 `story_state` 或 pending 修复。
- HTTP `502`、`500` 或 `UPSTREAM_ERROR`：允许使用同一冻结快照和同一 `request_id` 重试；每次尝试使用新的网络控制器。
- `event: error`：结束本次流，不尝试继续解析后续文本。
- 用户取消：调用 `AbortController.abort()`，状态为 `cancelled`，不展示为业务失败。
- 超时：首字节和总时长分别配置；总超时后中止连接，并允许用户用同一 `request_id` 重试。

仅在未提交前发生的技术错误允许重试。已完成原子提交的 `request_id` 必须从本地幂等缓存返回已提交结果，不能再次调用服务端。

## 8. 验收测试

实施完成后增加自动化测试并至少覆盖：

1. `GET /health` 版本匹配与不匹配分支。
2. 六种 operation 的请求构造、模板映射及本地拒绝非法 pending、场景、轮数和候选事件。
3. SSE 事件被任意字节位置切分时，重组出的 `rawYaml` 与服务器正文逐字相同。
4. 普通文本、`[DONE]`、流内 `error`、JSON HTTP 错误、连接提前关闭、超时、主动取消各自的行为。
5. `[DONE]` 只会触发一次 `finish()` 和一次完成回调。
6. 五种模板均能接入 `AdventureYamlStreamParser`；非法 YAML、模板不符、Schema 失败和业务校验失败均不提交状态。
7. 临时文本可显示，但在 `finish()` 成功前选项、战斗、资源、奖励、场景和 pending 均保持不变。
8. `state_version` 冲突或重复 `request_id` 不会覆盖新状态，且重试不会重复扣资源、追加事件或发放奖励。

同时在集成环境运行发布包自检：`node src/data_20260826/adventure_yaml_stream_parser.test.mjs` 与 `node src/data_20260826/validate_release_bundle.mjs`。客户端自己的 SSE 测试应使用实际服务端帧格式，而不是直接把模型 SDK 的累计文本格式混入同一适配器。
