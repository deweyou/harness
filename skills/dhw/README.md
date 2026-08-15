# DHW

Deweyou Harness Work is the single user-facing skill in the plugin. Invoke
`/dhw` with a task. It selects a workflow from the workspace's `harness.yaml`,
uses subagents for detailed agent nodes, progressively dispatches referenced
resources, and stores a replayable Run under `~/.deweyou/harness/`.

See [Harness Core](../../docs/harness-core.md) for configuration and runtime
contracts.
