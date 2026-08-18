# DHW

Deweyou Harness Work 是插件唯一面向用户的 Skill。通过 `/dhw` 提交任务后，
主 Agent 会根据工作区 `harness.yaml` 选择工作流，把详细的 Agent 节点优先交给
Subagent，渐进加载配置引用的资源，并将可复盘的 Run 保存到
`~/.deweyou/harness/`。

配置与运行时契约见 [Harness Core](../../docs/harness-core.md)。
