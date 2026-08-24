# Harness Work

Deweyou Harness Work is the single user-facing skill in the plugin. Invoke
`/harness-work` to create, update, or migrate workspace configuration, or to
run a task. It establishes a durable Commitment when needed, proposes a
task-scoped Plan, uses subagents for bounded node executions, progressively
activates capabilities, and stores a replayable Run under `~/.deweyou/harness/`.
Before a new Run it prepares either a local task branch or an isolated worktree,
as selected by the root `strategy` field in `harness.yaml`.

The skill also routes explicit repository-knowledge maintenance through one
evidence-backed SOP. Root and module-level `AGENTS.md` files remain concise
routers, while durable explanations live in the appropriately scoped `docs/`.

In-progress feedback uses minimal incremental Plans: unaffected work is reused,
while only affected nodes and focused verification are rerun or added.

See [Harness Core](../../docs/harness-core.md) for configuration and runtime
contracts.
