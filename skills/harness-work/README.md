# Harness Work

Deweyou Harness Work is the single user-facing skill in the plugin. Invoke
`/harness-work` to create, update, or migrate workspace configuration, or to
run a task. It establishes a durable Commitment when needed, proposes a
task-scoped Plan, uses subagents for bounded node executions, progressively
activates capabilities, and stores a replayable Run under `~/.deweyou/harness/`.
Before a new Run it prepares either a local task branch or an isolated worktree,
as selected by the root `strategy` field in `harness.yaml`.

See [Harness Core](../../docs/harness-core.md) for configuration and runtime
contracts.
