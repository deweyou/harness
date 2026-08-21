# DHW

Deweyou Harness Work 是插件唯一面向用户的 Skill。通过 `/dhw` 提交任务后，
主 Agent 会在需要时建立 Commitment，为当前任务提出 Plan，把边界清晰的节点执行
优先交给 Subagent，渐进激活所需能力，并将可复盘的 Run 保存到
`~/.deweyou/harness/`。`harness.yaml` 只声明资源和节点能力，不声明工作流。

配置与运行时契约见 [Harness Core](../../docs/harness-core.md)。
