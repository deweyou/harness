# Agents

[English](./README.md) | [简体中文](./README_ZH.md)

Personal agent asset hub. This repository keeps reusable **skills**,
**rules**, and the `deweyou-cli` package in one place so they can be installed
or wired into other repositories consistently.

## What Is In This Repository

| Area | Location | Purpose |
|------|----------|---------|
| Skills | [`skills/`](./skills/) | Active workflows that trigger for specific agent tasks. |
| Rules | [`rules/`](./rules/) | Passive coding and development preferences shared across projects. |
| Design | [`design/`](./design/) | Reusable interface design contracts for AI-assisted UI work. |
| CLI | [`cli/`](./cli/) | TypeScript package for the `deweyou-cli` binary. |
| Docs | [`docs/`](./docs/) | Repository workflow, design notes, and implementation plans. |
| Tests | [`tests/`](./tests/) | Asset registry and scanning tests. |

`AGENTS.md` is the navigation page for agents. Repository workflow details live
in [`docs/asset-workflow.md`](./docs/asset-workflow.md). DDev technical and
daily-operations docs live in [`docs/ddev-framework.md`](./docs/ddev-framework.md)
and [`docs/ddev-operations.md`](./docs/ddev-operations.md).

## deweyou-cli

`deweyou-cli` bootstraps reusable agent workflows into any local repository. It
refreshes a local cache of skills, rules, and design contracts from this hub,
initializes repositories with selected assets, renders the active agent context,
and diagnoses whether a repository is wired correctly.

Install it globally:

```bash
npm install -g deweyou-cli
deweyou-cli agent update
```

By default, `agent update` clones or pulls
`https://github.com/deweyou/agents.git` into `~/.deweyou/agents/source`. For
local development against a specific checkout, set:

```bash
export DEWEYOU_AGENTS_SOURCE=/path/to/deweyou/agents
deweyou-cli agent update
```

Initialize another repository:

```bash
cd /path/to/your/repo
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
```

For scripted setup:

```bash
deweyou-cli agent init --all --mode link --yes
deweyou-cli agent init --skills ddev --rules ddev-local-state,verification-evidence,loop-boundaries --mode link --yes
deweyou-cli agent init --skills ui-design --design dewey-interface
deweyou-cli agent init --global --tools codex --skills repo-memory,git-delivery --yes
deweyou-cli agent init --dry-run
```

### CLI Commands

| Command | Purpose |
|---------|---------|
| `deweyou-cli agent update` | Refresh the local asset cache and generated registry. |
| `deweyou-cli agent init` | Add selected skills, rules, and an optional `DESIGN.md` to the current repository, or use `--global` for user-level installs. |
| `deweyou-cli agent context --format markdown` | Print the active agent instructions for the current repository. |
| `deweyou-cli agent context --format json` | Print structured context for tooling. |
| `deweyou-cli agent doctor` | Check cache, manifest, symlinks, selected assets, and hash consistency. |
| `deweyou-cli dev install` | Initialize manual DDev runtime, global per-repository state under `~/.deweyou/dev/`, global module registry, and remove old DDev passive hooks. |
| `deweyou-cli dev status` | Print DDev runtime, repo state, and branch session status. |
| `deweyou-cli dev doctor` | Diagnose DDev runtime, global per-repo session files, legacy repo-local state, and passive-hook absence. |
| `deweyou-cli dev clean` | Remove DDev-owned global per-repository state by branch or for the whole repo. |
| `deweyou-cli dev demo` | Create and serve the branch-session static HTML demo workspace. |
| `deweyou-cli dev uninstall` | Remove current repo DDev state, legacy local state and excludes, old DDev passive hooks, and the runtime only when no other repo state remains. |

### Install Modes

| Mode | Repository Writes | Best For |
|------|-------------------|----------|
| `link` | Symlinks selected assets into `.agents/skills/`, `.agents/rules/`, and optionally root `DESIGN.md`. | Daily local work where cache updates should be visible immediately. |
| `copy` | Copies selected assets into `.agents/skills/`, `.agents/rules/`, and optionally root `DESIGN.md`. | Repositories that should keep a snapshot of selected assets. |
| `pointer` | Writes `.agents/manifest.json` and `AGENTS.md`; assets stay in the global cache. | Minimal repository footprint. |

## Skills

Skills are active workflows. They live in `skills/<name>/SKILL.md` and may also
include human-facing `README.md` and `README_ZH.md` files, references, scripts,
assets, previews, or eval cases. For DDev projects, install only the `ddev`
entry skill in the target repository; DDev loads module skills from the global
cache at `~/.deweyou/agents/assets/skills/<skill>/SKILL.md` and reads mandatory
operation-scoped rules from `~/.deweyou/agents/assets/rules/`.

| Skill | Description | Source |
|-------|-------------|--------|
| `ddev` | DDev personal cross-repository development harness workflow. It owns task lifecycle, mandatory cached coding and engineering rules, global `~/.deweyou/dev/` per-repo state, UI prototype gates, HTML demos, harness mapping, bounded loops, evidence, delivery routing, and memory routing. | [`skills/ddev/`](./skills/ddev/) |
| `problem-framing` | Grilling, brainstorming, tradeoff critique, and recommendation workflow for clarifying fuzzy requests before implementation. | [`skills/problem-framing/`](./skills/problem-framing/) |
| `repo-memory` | Durable repository memory workflow. It initializes and refreshes repo context, runs pre-commit memory checks, updates docs and UI design memory when work changes important knowledge, and checks local skill drift. | [`skills/repo-memory/`](./skills/repo-memory/) |
| `git-delivery` | Branch-aware git delivery workflow for start-of-work checks, intentional staging, commits, base-branch conflict checks, safe rebases, pushes, PR creation, CI follow-up, and automatic low-risk CI repair. | [`skills/git-delivery/`](./skills/git-delivery/) |
| `spec-driven-coding` | DDev-native coding workflow for features, behavior changes, debugging, TDD, verification, and requirement alignment before and during coding. | [`skills/spec-driven-coding/`](./skills/spec-driven-coding/) |
| `skill-eval` | Repository-local evaluation workflow for skills. It generates eval cases, runs routing or execution tests through an agent CLI, grades transcripts, and summarizes trigger accuracy. | [`skills/skill-eval/`](./skills/skill-eval/) |
| `product-notes` | Living product note workflow for classifying and capturing product ideas, positioning changes, iteration specs, decisions, insights, and reviews. | [`skills/product-notes/`](./skills/product-notes/) |
| `ui-design` | UX/UI design and prototype workflow for pattern research, flow design, visual style, implementation, review, and AI design prompts across web, mobile, HarmonyOS, mini programs, macOS, dashboards, and tools. | [`skills/ui-design/`](./skills/ui-design/) |
| `product-design` | Product design workflow for personal products. It researches existing products when needed, avoids enterprise process theater, and recommends right-sized directions, versions, or validation steps. | [`skills/product-design/`](./skills/product-design/) |

### Installing Skills Directly

Install one skill with the Skills CLI:

```bash
npx skills add deweyou/agents --skill repo-memory
```

Replace the skill name as needed:

```bash
npx skills add deweyou/agents --skill ddev
npx skills add deweyou/agents --skill problem-framing
npx skills add deweyou/agents --skill git-delivery
npx skills add deweyou/agents --skill spec-driven-coding
npx skills add deweyou/agents --skill skill-eval
npx skills add deweyou/agents --skill product-notes
npx skills add deweyou/agents --skill ui-design
npx skills add deweyou/agents --skill product-design
```

For DDev repository-wide setup, prefer
`deweyou-cli agent init --skills ddev --mode link --yes` so the repository has a
single DDev entry point. Install other skills directly only when you want to use
them standalone outside DDev.

## Rules

Rules are passive preferences and constraints. They live in `rules/<name>.md`
and are selected per repository through `deweyou-cli`. DDev additionally reads
`code-style` and `engineering-principles` directly from the global asset cache
before matching operations, so installing those two rules is optional for DDev.

| Rule | Description | Source |
|------|-------------|--------|
| `collaboration-defaults` | Default agent collaboration behavior for language, ambiguity, context, task order, parallel work, evidence, safety, and handoff. | [`rules/collaboration-defaults.md`](./rules/collaboration-defaults.md) |
| `code-style` | Code expression preferences for naming, functions, comments, errors, and tests. | [`rules/code-style.md`](./rules/code-style.md) |
| `engineering-principles` | Design preferences for module boundaries, abstraction, dependencies, state, and easy-to-delete code. | [`rules/engineering-principles.md`](./rules/engineering-principles.md) |
| `ddev-local-state` | Ownership, visibility, cleanup, and commit boundaries for global DDev local state under `~/.deweyou/dev`. | [`rules/ddev-local-state.md`](./rules/ddev-local-state.md) |
| `verification-evidence` | Evidence expectations for completion claims, skipped checks, live UI/runtime proof, and verification gaps. | [`rules/verification-evidence.md`](./rules/verification-evidence.md) |
| `loop-boundaries` | Bound implementation, debugging, verification, and CI repair loops so agents know when to continue, stop, or ask. | [`rules/loop-boundaries.md`](./rules/loop-boundaries.md) |

## Design

Design contracts live under [`design/`](./design/) in this asset hub. They are
project-level design contracts: part design rule, part token map, and part
component guidance. `ui-design` reads project-local `DESIGN.md` files before
applying visual style, and `deweyou-cli agent init --design dewey-interface`
installs [`design/dewey-interface.md`](./design/dewey-interface.md) into a target
repository as `DESIGN.md`.

| Design Contract | Description | Source |
|-----------------|-------------|--------|
| `dewey-interface` | Restrained, typographic, component-driven interface style for personal products. | [`design/dewey-interface.md`](./design/dewey-interface.md) |

## Development

After changing skills or rules:

```bash
pnpm run lint:assets
```

After changing asset scanning behavior:

```bash
pnpm test
pnpm run coverage
```

After changing CLI behavior:

```bash
pnpm run typecheck:cli
pnpm run test:cli
pnpm run coverage:cli
cd cli && npm pack --dry-run
```

Every new or modified skill must include updated eval cases at
`skills/<name>/evals/evals.json`. Running LLM-backed evals is separate and should
only happen when explicitly requested.

Every skill directory must include `README.md` and `README_ZH.md` with a summary,
installation command, features, SOP, and a Mermaid diagram when useful. Update
both READMEs whenever the skill workflow changes.
