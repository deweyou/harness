# Deweyou Harness

Deweyou Harness is a Codex Plugin for running config-driven, domain-neutral
workflows. The plugin contains one user-facing skill, `/dhw`, and a bundled
local MCP server that validates configuration, schedules DAG nodes, dispatches
resources progressively, and records replayable Run evidence.

The Harness owns no coding, writing, video, product, or repository policy.
Workspaces inject skills, rules, knowledge, nodes, and workflows through
`harness.yaml`.

## Development

```bash
pnpm install
pnpm run check
pnpm run test:coverage
pnpm run validate:plugin
```

The bundled `dist/server.mjs` is tracked so an installed plugin can start its
MCP server without a TypeScript runtime. There is no public CLI and no legacy
DDev or Brain state migration.

Read [Harness Core](docs/harness-core.md) for the complete contract.
