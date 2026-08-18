# Deweyou Harness

Deweyou Harness is a cross-agent plugin for running config-driven, domain-neutral
workflows in Codex, Claude Code, Cursor, OpenClaw, and Hermes Agent. The plugin
contains one user-facing skill, `/dhw`, and a bundled local MCP server that
validates configuration, schedules DAG nodes, dispatches resources progressively,
records replayable Run evidence and generates evidence-attributed resource
improvement proposals after delivery.

The Harness owns no coding, writing, video, product, or repository policy.
Workspaces inject skills, rules, knowledge, nodes, and workflows through
`harness.yaml`.

## Requirements

- Node.js 22.5 or newer
- A workspace `harness.yaml`

## Install

### Codex

Add this repository as a marketplace and install the plugin:

```bash
codex plugin marketplace add deweyou/harness
codex plugin add deweyou-harness@deweyou
```

Start a new Codex session after installation, then invoke `/dhw`.

### Claude Code

Add the same repository as a Claude Code marketplace and install the plugin:

```bash
claude plugin marketplace add deweyou/harness
claude plugin install deweyou-harness@deweyou
```

Run `/reload-plugins` in Claude Code, then invoke
`/deweyou-harness:dhw`. Claude Code namespaces plugin skills by plugin name.

For one-session local development without installing a marketplace, run:

```bash
claude --plugin-dir /absolute/path/to/harness
```

### Cursor

Cursor loads the portable Agent Plugin manifest in this repository. Clone it
into Cursor's local plugin directory:

```bash
git clone https://github.com/deweyou/harness.git ~/.cursor/plugins/local/deweyou-harness
```

Restart Cursor or run `Developer: Reload Window`, then invoke `/dhw`. For local
development, symlink a checkout instead:

```bash
ln -s /absolute/path/to/harness ~/.cursor/plugins/local/deweyou-harness
```

To update a cloned Cursor installation:

```bash
git -C ~/.cursor/plugins/local/deweyou-harness pull --ff-only
```

### OpenClaw

Install and enable the native OpenClaw adapter from GitHub:

```bash
openclaw plugins install git:github.com/deweyou/harness
openclaw plugins enable deweyou-harness
openclaw gateway restart
```

Verify that the shared Skill and MCP server were discovered:

```bash
openclaw plugins inspect deweyou-harness
```

Start a new session, then invoke `/dhw` or reference `$dhw` in a prompt.

### Hermes Agent

Hermes loads this repository through its Agent Plugins v1 compatibility layer:

```bash
hermes plugins install deweyou/harness --enable
hermes plugins list
```

Start a new Hermes session and ask it to use the Deweyou Harness `dhw` skill.
Portable plugin skills are read-only and namespaced; use `skills_list` when you
need the fully qualified name, then load it through `skill_view`.

## Development

```bash
pnpm install
pnpm run check
pnpm run test:coverage
pnpm run validate:plugin
```

Every non-release push to `main` runs the Release workflow. It reads the
unreleased conventional commit subjects, applies the highest semantic-version
bump (`!`/`BREAKING CHANGE` = major, `feat` = minor, everything else = patch),
synchronizes every host manifest, prepends `CHANGELOG.md`, rebuilds
`dist/server.mjs`, validates the package, and commits
`chore(release): v<version>` back to `main`. Release commits are excluded from
the next calculation and do not trigger another release.

The bundled `dist/server.mjs` is tracked so an installed plugin can start its
MCP server without a TypeScript runtime. Host-specific manifests only adapt
plugin discovery and MCP path resolution; all hosts share the same Skill, Core,
schemas, and runtime bundle. There is no public CLI and no legacy DDev or Brain
state migration.

Read [Harness Core](docs/harness-core.md) for the complete contract.
