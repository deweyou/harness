# Dewey CLI Skills Wrapper Design

## Problem

`deweyou-cli` currently treats skills as Dewey-managed assets under the local
`.deweyou/agents` cache. That makes project setup harder to reason about across
devices because symlink targets can encode machine-local paths, while copy mode
duplicates package-manager behavior already handled by the community `skills`
CLI.

## Decision

Dewey should not become a second skills package manager. Project and global
skills should use the community `skills` CLI for installation, lock files,
runtime materialization, listing, removal, and updates. `deweyou-cli` should
provide a Dewey-shaped wrapper so Dewey users do not need to memorize the
underlying `skills` command syntax.

Public skill READMEs can continue to recommend `npx skills add ...` as the
canonical community entrypoint. Dewey CLI remains the ergonomic orchestration
entrypoint for Dewey presets, rules, design contracts, and instruction wiring.

## Scope

Add a skills wrapper command family:

```text
deweyou-cli agent skills add <source> [--skills a,b] [--tools codex,claude|all] [--global] [--copy] [--yes]
deweyou-cli agent skills update [skill ...] [--scope project|global] [--global] [--yes]
deweyou-cli agent skills sync [--yes]
deweyou-cli agent skills list [--scope project|global] [--global] [--tools codex,claude|all] [--json]
deweyou-cli agent skills remove [skill ...] [--scope project|global] [--global] [--tools codex,claude|all] [--yes]
```

Also expose shorter Dewey workflow aliases:

```text
deweyou-cli agent sync
deweyou-cli agent upgrade [skill ...] [--scope project|global] [--global] [--yes]
```

`agent sync` restores project skills from `skills-lock.json`. `agent upgrade`
updates skills through the underlying `skills update` command. Dewey rules and
design upgrade behavior can be added later; this change only creates the skills
backend and help surface.

## Mapping

The wrapper maps Dewey flags onto `skills` CLI flags:

- `--skills a,b` -> `--skill a b`
- `--tools codex,claude|all` -> `--agent codex claude` or `--agent *`
- `--global` or `--scope global` -> `-g`
- `--scope project` -> `-p` for update commands; default project scope for
  list/remove
- `--copy`, `--yes`, and `--json` pass through when supported
- `agent skills sync` and `agent sync` -> `skills experimental_install`

The wrapper uses `npx -y skills@latest ...` so users only need `deweyou-cli`.

## Non-Goals

- Do not replace `skills-lock.json` with a Dewey-specific lock file.
- Do not make `.deweyou/agents` the runtime source for project or global skills.
- Do not update project vendored rules/design in this first change.
- Do not remove existing `agent init` behavior yet; migration can happen in a
  later, more invasive change.

## Verification

- Unit tests cover Dewey-to-skills argument translation.
- CLI argument tests cover new subcommands and help output.
- Typecheck and CLI tests pass.
