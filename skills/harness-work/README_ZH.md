# Harness Work

Deweyou Harness Work 是插件唯一面向用户的 Skill。通过 `/harness-work` 可以创建、
迭代或迁移仓库配置，也可以提交需要持久化执行的任务。主 Agent 会在需要时建立
Commitment，为当前任务提出 Plan，把边界清晰的节点执行优先交给 Subagent，渐进
激活所需能力，并将可复盘的 Run 保存到 `~/.deweyou/harness/`。`harness.yaml`
只声明资源和节点能力，不声明工作流。

配置与运行时契约见 [Harness Core](../../docs/harness-core.md)。
