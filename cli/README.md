# deweyou-cli

`deweyou-cli` bootstraps reusable agent workflows into any local repository. It
manages the repo-level wiring for selected skills, rules, and design contracts
while keeping the source assets in the central `deweyou/agents` hub.

The v0 scope is intentionally small:

- cache skills, rules, and design contracts from a local `deweyou/agents`
  checkout
- initialize a repository with selected skills, rules, and an optional
  `DESIGN.md`
- render the active agent context for the current repository
- diagnose whether the current repository is wired correctly
- initialize, inspect, diagnose, clean, uninstall, serve, record, and summarize
  global DDev per-repository state under `~/.deweyou/dev/`

## Install

From npm:

```bash
npm install -g deweyou-cli
```

Then refresh the local asset cache:

```bash
deweyou-cli agent update
```

By default, `agent update` clones or pulls `https://github.com/deweyou/agents.git`
into `~/.deweyou/agents/source`. For local development, set
`DEWEYOU_AGENTS_SOURCE=/path/to/deweyou/agents` to use a specific checkout
instead.

## Quick Start

```bash
cd /path/to/your/repo
deweyou-cli agent update
deweyou-cli agent init \
  --skills ddev \
  --rules ddev-local-state,verification-evidence,loop-boundaries \
  --mode link \
  --yes
deweyou-cli agent doctor
deweyou-cli agent context --format markdown
deweyou-cli dev install
deweyou-cli dev status
deweyou-cli dev doctor
deweyou-cli agent -h
deweyou-cli -v
```

For standalone or non-DDev asset setup, select the skills and rules you want:

```bash
deweyou-cli agent init --skills ui-design --design dewey-interface --mode link
deweyou-cli agent init --global --tools codex --skills repo-memory,git-delivery --yes
```

## Mental Model

`deweyou/agents` is the asset hub. It owns `skills/`, `rules/`, and `design/`.

`deweyou-cli` is the workflow manager. It scans the hub assets, generates a
cache registry under your home directory, then writes a small
`.agents/manifest.json` into each repository so the repository knows which
assets are active.

Each repository chooses its own asset set. A coding repo can select coding
skills and rules; a writing or design repo can select different ones and install
a design contract as root `DESIGN.md`.

For DDev, keep the repository asset set intentionally small: install only the
`ddev` entry skill. The product, UI, coding, delivery, and memory modules stay in
the global Dewey asset cache at
`~/.deweyou/agents/assets/skills/<skill>/SKILL.md`, and DDev loads them by
absolute path when needed.

## Commands

General options:

| Option | Meaning |
|--------|---------|
| `-h`, `--help` | Show help. Supports nested help such as `deweyou-cli agent -h` and `deweyou-cli agent init -h`. |
| `-v`, `--version` | Show the installed CLI version. |

### `deweyou-cli agent update`

Refreshes the local agent asset cache from the default `deweyou/agents` source
checkout.

```bash
deweyou-cli agent update
```

This command writes the global cache at:

```text
~/.deweyou/agents/
```

Run this after changing or pulling updates in the asset hub.

Source selection:

- Default: clone or pull `https://github.com/deweyou/agents.git` under
  `~/.deweyou/agents/source`.
- Override: set `DEWEYOU_AGENTS_SOURCE=/path/to/deweyou/agents` to scan a local
  checkout.

### `deweyou-cli agent init`

Initializes the current repository with selected skills, rules, and an optional
design contract.

```bash
deweyou-cli agent init
```

Usage:

```text
deweyou-cli agent init [--all] [--skills a,b] [--rules a,b] [--design name] [--mode link|copy|pointer] [--global|--scope project|global] [--tools codex,claude|all] [--rule-wiring reference|inline] [--yes] [--dry-run] [--force]
```

Without selection flags, this opens an interactive setup where you choose:

- install mode
- skills
- rules
- design contract

Scripted examples:

```bash
deweyou-cli agent init --all --mode link --yes
deweyou-cli agent init --skills ddev --rules ddev-local-state,verification-evidence,loop-boundaries --mode link --yes
deweyou-cli agent init --skills ui-design --design dewey-interface --mode link
deweyou-cli agent init --global --tools codex --skills repo-memory,git-delivery --yes
deweyou-cli agent init --scope project --tools codex,claude --rules code-style --mode link
deweyou-cli agent init --scope global --tools codex,claude --skills repo-memory,git-delivery --yes
deweyou-cli agent init --scope global --tools all --rules code-style --rule-wiring reference --yes
deweyou-cli agent init --dry-run
```

Flags:

| Flag | Meaning |
|------|---------|
| `--all` | Select every skill and rule from the cached registry. Design contracts are explicit via `--design`. |
| `--skills a,b` | Select only the listed skill ids. Values are comma-separated. |
| `--rules a,b` | Select only the listed rule ids. Values are comma-separated. |
| `--design name` | Install the selected design contract as root `DESIGN.md`. Project scope only. |
| `--mode link\|copy\|pointer` | Choose how project repositories reference selected assets. Global skill installs always use symlinks. |
| `--global` | Shortcut for `--scope global`; installs selected skills into tool-native user skill directories. |
| `--scope project\|global` | Choose project-level or user-level installation. |
| `--tools codex,claude\|all` | Choose target agent tools for global installs and instruction wiring. |
| `--rule-wiring reference\|inline` | Choose whether selected rules are referenced by path or inlined into instruction files. |
| `--yes` | Run without prompts. Requires `--all`, `--skills`, `--rules`, or `--design`. |
| `--dry-run` | Print the planned files without writing them. |
| `--force` | Replace existing managed asset destinations when needed. |

`--yes` does not guess a default asset set. It only confirms a scripted
selection you already provided.

### `deweyou-cli agent context`

Prints the active agent context for the current repository.

```bash
deweyou-cli agent context --format markdown
deweyou-cli agent context --format json
```

Formats:

| Format | Meaning |
|--------|---------|
| `markdown` | Human-readable instructions and asset paths. This is the default. |
| `json` | Structured context for tooling or future integrations. |

The context output tells an agent which skills, rules, and design contracts are
active, where their files live, whether the hub commit changed, and whether any
selected asset hash changed in the local cache.

### `deweyou-cli agent doctor`

Checks whether the current repository and local cache are healthy.

```bash
deweyou-cli agent doctor
```

It verifies:

- local cache registry exists and is valid
- repository `.agents/manifest.json` exists and is valid
- `AGENTS.md` exists when selected rules or a design contract require
  repository instructions
- selected skills, rules, and design contracts still exist in the registry
- selected asset hashes match the repository's initialized snapshot
- selected asset files are present
- symlinks are valid when using `link` mode

The command exits with a non-zero status when a check fails.

### `deweyou-cli dev install`

Initializes manually activated DDev runtime state and global per-repository
DDev state.

```bash
deweyou-cli dev install
deweyou-cli dev install --dry-run
```

It creates:

```text
~/.deweyou/dev/config.json
~/.deweyou/dev/repos/<repo-id>/config.json
~/.deweyou/dev/repos/<repo-id>/sessions/<branch>/
```

The global runtime config records the absolute module skill registry under
`~/.deweyou/agents/assets/skills`. It does not install module skills into the
repository. Run `deweyou-cli agent update` to refresh that global cache.

The install command does not write DDev state into the project repository and
does not add a new git exclude rule. It removes old DDev passive Codex hooks
from earlier versions, but it does not install new hooks.

DDev starts only when the user invokes `$DDev`/`ddev` or when a repository's
`AGENTS.md` explicitly opts into DDev as the default workflow for non-trivial
development tasks. If DDev is missing on a machine, tell the user to run
`npm install -g deweyou-cli`, `deweyou-cli agent update`, and
`deweyou-cli agent init --skills ddev --mode link --yes`, then
`deweyou-cli dev install`; do not install it silently during unrelated work.

### `deweyou-cli dev status`

Prints the current DDev runtime, repo state, branch, and branch-session status.

```bash
deweyou-cli dev status
```

### `deweyou-cli dev doctor`

Diagnoses local DDev setup.

```bash
deweyou-cli dev doctor
```

It reports whether the runtime root exists, whether the global DDev module skill
cache exists, whether global per-repository state exists, whether the current
branch session files exist, whether legacy repo-local DDev state or legacy git
exclude wiring is present, and whether DDev passive Codex hooks are absent.
Missing runtime state or missing global module skills fail; missing session
state is reported as a warning. DDev does not diagnose or manage other harness
agents.

### `deweyou-cli dev clean`

Removes DDev-owned global per-repository state.

```bash
deweyou-cli dev clean
deweyou-cli dev clean --branch feature/demo
deweyou-cli dev clean --all
deweyou-cli dev clean --all --dry-run
```

Without `--all`, this cleans the current branch session, or the branch provided
with `--branch`. With `--all`, it removes the current repository's whole global
DDev state tree under `~/.deweyou/dev/repos/<repo-id>/`.

### `deweyou-cli dev uninstall`

Removes DDev-owned global state for the current repository and cleans the global
runtime only when no other repository state remains.

```bash
deweyou-cli dev uninstall
deweyou-cli dev uninstall --dry-run
```

It removes the current repository's global state under
`~/.deweyou/dev/repos/<repo-id>/`, legacy `<repo>/.deweyou/dev/` state if it
exists, the exact legacy `.deweyou/dev/` line from local git exclude, and old
DDev passive Codex hooks from earlier versions. It removes `~/.deweyou/dev/`
only when no other repository state remains. It does not diagnose or manage
other harness agents.

### `deweyou-cli dev demo`

Creates and serves a branch-session static HTML demo workspace.

```bash
deweyou-cli dev demo --no-server
deweyou-cli dev demo --port 4173
deweyou-cli dev demo --branch feature/demo --port 0
```

It creates:

```text
~/.deweyou/dev/repos/<repo-id>/sessions/<branch>/demo/index.html
```

With `--no-server`, it only creates the demo files. Without `--no-server`, it
starts a local static server and prints the URL. The demo is local working state
and should stay out of git unless explicitly promoted into product source.

### `deweyou-cli dev record`

Validates one structured session event and appends it to `events.jsonl`.

```bash
deweyou-cli dev record --kind node --data \
  '{"node_id":"verify","node_type":"verification","status":"completed"}'
```

Supported kinds are `requirement`, `node`, `evidence`, `failure`, `review`,
`recovery`, and `delivery`. The command records facts only; it does not execute,
retry, approve, or deliver nodes.

| Kind | Required payload fields |
| --- | --- |
| `requirement` | `status`, `acceptance_source` |
| `node` | `node_id`, `node_type`, `status` |
| `evidence` | `evidence_id`, `claim_id`, `evidence_type`, `status`, `summary` |
| `failure` | `failure_id`, `node_id`, `failure_class`, `summary` |
| `review` | `review_id`, `scope`, `verdict` |
| `recovery` | `recovery_id`, `source_event_id`, `restart_from`, `reason`, `status` |
| `delivery` | `delivery_id`, `status`, `summary` |

Failure classes are `requirement`, `design`, `implementation`, `verification`,
`environment`, `permission`, `external`, `user_decision`, or `unknown`. Keep
secrets and large raw logs out of payloads; record redacted summaries and
artifact references instead.

### `deweyou-cli dev summary`

Validates all persisted session events, regenerates `summary.md`, and prints a
Markdown or JSON view.

```bash
deweyou-cli dev summary
deweyou-cli dev summary --format json
deweyou-cli dev summary --branch feature/demo
```

The summary shows the latest node states, claims and evidence, failures, review
verdicts, recovery hints, delivery events, and open issues.

## Install Modes

| Mode | Repository Writes | Best For |
|------|-------------------|----------|
| `link` | Installs selected skills through `npx skills`; symlinks selected rules and optionally root `DESIGN.md`. | Daily local work where updates should be immediately visible after cache refresh. |
| `copy` | Installs selected skills through `npx skills --copy`; copies selected rules and optionally root `DESIGN.md`. | Repositories that should keep a snapshot of the selected assets. |
| `pointer` | Writes `.agents/manifest.json`; selected assets stay in the global cache. `AGENTS.md` is updated only when selected rules or a design contract require repository instructions. | Minimal repo footprint and tooling that can follow absolute cache paths. |

## Files Created

Depending on the selected mode, `deweyou-cli agent init` may create or update:

```text
AGENTS.md
.agents/manifest.json
.agents/skills/<skill>/SKILL.md
.agents/rules/<rule>.md
DESIGN.md
```

`AGENTS.md` receives managed sections only when selected rules or a design
contract require repository instructions. Existing content outside those managed
sections is preserved.

Project installs write repository instruction files such as `AGENTS.md` and
`CLAUDE.md`. Skill installs are delegated to `npx skills add`, which writes
the selected skill package into agent-native skill directories such as
`.agents/skills/<skill>` or `.claude/skills/<skill>` for project installs and
`~/.agents/skills/<skill>` or `~/.claude/skills/<skill>` for global installs.
Global rule installs write user-level instruction
files such as `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`.

## Safety Notes

- Run `deweyou-cli agent update` before `deweyou-cli agent init`.
- Asset ids must be kebab-case and must exist in the cached registry.
- `--force` only replaces destinations that are already managed by this CLI. It
  refuses to overwrite unrelated user-created files or directories.
- `--dry-run` is the safest way to preview what `init` would write.
- Set `DEWEYOU_AGENTS_SOURCE` only when you want to override the default source
  checkout, usually while developing this asset hub locally.

## Development

The CLI source and tests are written in TypeScript. Vite+ builds the published
JavaScript files into `dist/`.

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
npm pack --dry-run
```

## Release

Merging CLI package changes into `main` runs the release workflow. It typechecks,
runs tests, verifies the package with `npm pack --dry-run`, infers the next
version from conventional commit messages, prepends [CHANGELOG.md](./CHANGELOG.md),
tags `cli-vX.Y.Z`, and publishes `deweyou-cli` to npm.

Release commit rules:

- `feat:` creates a minor release.
- `fix:`, `perf:`, and `refactor:` create a patch release.
- `!` or `BREAKING CHANGE` creates a major release.
- `docs:` entries are included in the changelog only when another releasable CLI
  commit is present.
- `test:` and `chore:` do not publish by themselves.

## Relationship To `deweyou/agents`

`deweyou/agents` continues to provide the actual skills, rules, design
contracts, and asset validation workflow. The CLI generates the cache registry during
`deweyou-cli agent update`.

`deweyou-cli` does not replace those assets. It gives every repository a
repeatable way to choose and wire the assets it wants, without manually copying
or linking the same files again and again.
