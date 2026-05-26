# Dewey CLI Rule Installation Design

Date: 2026-05-17

## Goal

Make `deweyou-cli` install Dewey rules into the instruction locations that coding
agents actually load, at either project scope or global user scope. The CLI should
keep `rules/` as the portable source of truth while adding tool-specific adapters
for Codex and Claude Code.

## Problem

The current CLI installs selected rules as Dewey assets under `.agents/rules/` and
lists them through `deweyou-cli agent context`. That is useful as a portable asset
layer, but it does not fully install rules into each tool's native discovery
system:

- Codex loads `AGENTS.md` files at global and project scope.
- Claude Code loads `CLAUDE.md` files at global and project scope, and can also
  organize project rules under `.claude/rules/`.

As a result, selected rules are present on disk but depend on an agent following
the Dewey context indirection. Rule installation should wire selected rules into
the native instruction entrypoints.

## Non-Goals

- Do not replace the repository-level `rules/<name>.md` source format.
- Do not inline large rule bodies by default.
- Do not implement path-scoped Claude rules in the first version.
- Do not add support for Cursor, Windsurf, Copilot, or other tools in this
  change, though the design should leave room for adapters later.
- Do not run LLM-backed skill evals as part of this feature.

## User Experience

`deweyou-cli agent init` remains the main entrypoint. When flags are sufficient,
it runs non-interactively. When important choices are missing, it opens an
interactive wizard.

Recommended defaults:

- `scope`: `project`
- `tools`: `codex,claude`
- `mode`: `link`
- `rule wiring`: `reference`

Example non-interactive commands:

```bash
deweyou-cli agent init --scope project --tools codex,claude --rules code-style --mode link --yes
deweyou-cli agent init --scope global --tools all --rules code-style,development-workflow --yes
```

Interactive flow:

```text
What do you want to install?
> Project setup
  Global setup

Which tools should receive instructions?
> Codex
  Claude Code
  Both

Which assets?
> Skills and rules
  Rules only
  Skills only

How should rules be wired?
> Reference selected rule files from managed sections
  Inline rule bodies into AGENTS.md / CLAUDE.md

Select rules:
[x] code-style
[x] development-workflow
[ ] ...

Dewey will update:
- AGENTS.md
- CLAUDE.md
- .agents/manifest.json
- .agents/rules/code-style.md

Proceed?
```

For global setup, the preview must make home-directory writes explicit:

```text
Dewey will update:
- ~/.codex/AGENTS.md
- ~/.claude/CLAUDE.md
```

## Concepts

### Scope

`project` scope installs into the current repository. It may write `.agents/`,
`AGENTS.md`, `CLAUDE.md`, and future tool-local directories.

`global` scope installs into user-level tool homes. It should not write repository
files. It reads selected rules from the Dewey asset cache and wires them into
global instruction files.

### Tools

`codex` writes Codex-native instruction entrypoints.

`claude` writes Claude Code-native instruction entrypoints.

`all` expands to every supported tool adapter.

### Rule Wiring

`reference` is the default. It writes managed sections that list selected rule
files and instruct the agent to read them when relevant. This keeps entrypoint
files short and auditable.

`inline` writes selected rule bodies directly into managed sections. This is
useful for environments that cannot follow file references, but it can bloat
startup context and should not be the default.

`native-files` is reserved for a future version that can copy or link rules into
tool-native rule directories where a tool supports them. The first version should
not expose this option.

## Architecture

Add a tool adapter layer behind `agent init`.

```text
cli/src/cli/init.ts
  parses flags, loads registry, builds selected asset plan

cli/src/cli/rule-install.ts
  converts selected rules into scope-aware install operations

cli/src/cli/managed-section.ts
  reusable marked-section insertion for Markdown files

cli/src/cli/adapters/codex.ts
  project: AGENTS.md
  global: ~/.codex/AGENTS.md

cli/src/cli/adapters/claude.ts
  project: CLAUDE.md
  global: ~/.claude/CLAUDE.md
```

Adapters should expose a small interface:

```ts
interface ToolAdapter {
  name: 'codex' | 'claude'
  plan(input: RuleInstallInput): Promise<ToolInstallPlan>
  apply(plan: ToolInstallPlan): Promise<void>
}
```

`init.ts` should stay focused on orchestration rather than knowing every
tool-specific path.

## Codex Adapter

Project scope:

- Ensure selected assets are installed under `.agents/` according to `mode`.
- Upsert a Dewey-managed section in `AGENTS.md`.
- The section references selected rules by path and points to
  `deweyou-cli agent context --format markdown`.

Global scope:

- Upsert a Dewey-managed section in `~/.codex/AGENTS.md`.
- Reference cached rule paths under `~/.deweyou/agents/assets/rules/`.
- Do not write `.agents/` or repository manifests.

## Claude Adapter

Project scope:

- Prefer creating or updating `CLAUDE.md`.
- If `CLAUDE.md` is a symlink to `AGENTS.md`, keep that symlink intact and rely
  on the Codex-compatible `AGENTS.md` section.
- If `CLAUDE.md` exists as a regular file, upsert a Dewey-managed section without
  overwriting user content.
- For a new file, write a small `@AGENTS.md` import when `AGENTS.md` is part of
  the plan; otherwise write a managed section that references selected rules.

Global scope:

- Upsert a Dewey-managed section in `~/.claude/CLAUDE.md`.
- Reference cached rule paths under `~/.deweyou/agents/assets/rules/`.

Future version:

- Support `.claude/rules/<rule>.md` for project-native Claude rules after the CLI
  can represent whether a rule is unconditional or path-scoped.

## Manifest

Project installs should extend `.agents/manifest.json` with tool and scope data
while preserving existing fields. A possible shape:

```json
{
  "scope": "project",
  "tools": ["codex", "claude"],
  "ruleWiring": "reference"
}
```

Global installs should write a separate Dewey global manifest under the Dewey
cache directory, for example:

```text
~/.deweyou/agents/global-manifest.json
```

The global manifest should record selected tools, selected rules, wiring mode,
source metadata, and asset hashes so `doctor` can report drift.

## Safety

- All instruction-file edits must use managed markers and preserve user content
  outside those markers.
- Global installs must show an explicit preview before writing unless `--yes` is
  provided.
- `--force` may replace only Dewey-managed destinations.
- The CLI must refuse to overwrite unrelated files, directories, or unsafe
  symlinks.
- Dry-run output must list every file that would be created or updated.

## Testing

Add CLI tests for:

- Project Codex install updates `AGENTS.md` and `.agents/manifest.json`.
- Project Claude install creates `CLAUDE.md` when absent.
- Existing `CLAUDE.md` content outside the managed section is preserved.
- A `CLAUDE.md -> AGENTS.md` symlink is preserved.
- Global Codex install updates a test-home `~/.codex/AGENTS.md`.
- Global Claude install updates a test-home `~/.claude/CLAUDE.md`.
- Global skill installs delegate to the skills CLI and materialize selected
  skills into test-home `~/.agents/skills/` and `~/.claude/skills/`.
- Interactive prompts collect scope, tools, assets, wiring, selected rules, and
  final confirmation.
- Dry-run lists planned files without writing.
- Unknown tools, invalid scopes, and invalid wiring modes fail with clear errors.

Run after implementation:

```bash
npm run typecheck:cli
npm run test:cli
npm run coverage:cli
cd cli && npm pack --dry-run
```

## Resolved Decisions

- Global installs support skills by symlinking selected skill directories into
  tool-native skill locations. Rules still use `reference` or `inline` managed
  instruction sections.
- Rule `reference` sections include each rule's name, description, and path so
  agents can decide whether to read the rule body.

## Open Decisions

- Whether `deweyou-cli agent doctor` should check both project and global installs
  by default, or require an explicit `--scope global`.
