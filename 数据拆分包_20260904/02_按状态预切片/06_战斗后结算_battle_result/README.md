# 战斗系统返回胜利：AI生成结算

系统消息固定顺序：

1. `01_引擎积木.txt`
2. `../../01_共享积木/世界规则_固定积木_20260904.txt`
3. `02_副本积木.txt`
4. `../../01_共享积木/最终自检_固定积木_20260904.txt`

`04_system_prompt_完整拼装示例.txt`是按以上顺序生成的可读成品。对于新事件等动态上下文，它只是本目录场景的示例；生产代码应调用根目录`prepareAiMessages`，不得把示例硬编码成永久请求。

用户消息只发送“`#本次程序运行态输入`＋完整runtime YAML”。程序不得把上一轮聊天历史整段续传；当前事件所需的完整新事件输出放在`pending_interaction.event_output`中。若本状态是`settle_check`或`battle_result`，还要把上一份完整检定/战斗输出放在`pending_interaction.resolution_output`中。
