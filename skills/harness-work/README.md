# Harness Work

Deweyou Harness Work is the single user-facing skill in the plugin. It is
explicitly opt-in: invoke `/harness-work`, reference `$harness-work`, or select
the Deweyou Harness plugin in the host interface. Installation and semantic
similarity alone must not activate it. Once invoked, use it to create, update,
or migrate workspace configuration, or to run a task. It establishes a durable
Commitment when needed, proposes a task-scoped Plan, uses subagents for bounded
node executions, progressively activates capabilities, and stores a replayable
Run under `~/.deweyou/harness/`.
Before a new Run, `workspace_prepare` fetches the base and prepares either a
local task branch or an isolated worktree, as selected by the root `strategy`
field in `harness.yaml`. `run_create` requires the resulting Receipt.

The skill also routes explicit repository-knowledge maintenance through one
evidence-backed SOP. Root and module-level `AGENTS.md` files remain concise
routers, while durable explanations live in the appropriately scoped `docs/`.

In-progress feedback uses minimal incremental Plans: unaffected work is reused,
while only affected nodes and focused verification are rerun or added.

Problem framing stays conversational and lightweight. Durable Specs are
published through the same immutable Markdown Export contract used by other
node results, and the Dashboard renders both Markdown and JSON Exports.
Knowledge initialization can safely share `AGENTS.md` with Claude through a
symlink, uses Mermaid when relationships benefit from a diagram, and keeps a
compact update footer on maintained pages.

See [Harness Core](../../docs/harness-core.md) for configuration and runtime
contracts.
