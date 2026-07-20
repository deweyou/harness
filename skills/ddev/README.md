# ddev

> Personal cross-repository development harness workflow for DDev sessions.

## What it does

`ddev` is the workflow owner for DDev. It orients on the repository, grills only
for important ambiguity, manages global `~/.deweyou/dev/` per-repository session
state for real implementation work, maps the available harness, runs bounded
implementation and verification loops, and routes explicit delivery or durable
memory work to the right global module skill.

DDev is manually activated. It starts when the user invokes `$DDev`/`ddev`, or
when project instructions explicitly opt into DDev as the default workflow for
non-trivial development tasks. It does not rely on passive global hooks.

The MVP stays human-readable: `task.md`, `context.md`, `graph.md`,
`brainstorm.md`, `verification.md`, `evidence.md`, `demo.md`, and related notes
under `~/.deweyou/dev/repos/<repo-id>/sessions/<branch>/`.

For concept work, DDev loads `problem-framing` from the global Dewey asset cache
for Grilling, brainstorming, critique, and recommendation, then uses
`deweyou-cli dev demo` to create or serve a branch-session static HTML demo when
seeing the idea would help. When requirement design includes UI, DDev
proactively loads `ui-design` to produce a prototype before implementation.

## When it triggers

- The user invokes `$DDev`, `DDev`, or `ddev`.
- Project instructions such as `AGENTS.md` explicitly make DDev the default
  workflow for non-trivial development tasks.
- The user asks to run the personal harness for a development task.
- The user asks to brainstorm, explore alternatives, sketch a concept, or draw
  an HTML demo before implementation.
- Requirement design affects screens, flows, components, interaction states, or
  visual acceptance and needs a UI prototype before coding.
- The user asks to start, continue, inspect, ship, retrospect, or clean up a
  DDev session.
- The user asks to set up, diagnose, upgrade, or uninstall DDev runtime state.
- A task needs one lifecycle owner across product, UI, coding, delivery, and
  memory modules.

## Installation

```bash
npx skills add https://github.com/deweyou/agents --skill ddev
```

For the full local runtime, install or update `deweyou-cli`, refresh assets, and
install only the `ddev` entry skill in the target repository:

```bash
npm install -g deweyou-cli
deweyou-cli agent update
deweyou-cli agent init --skills ddev --mode link --yes
deweyou-cli dev install
deweyou-cli dev doctor
```

Module skills stay in `~/.deweyou/agents/assets/skills/<skill>/SKILL.md` and
DDev loads them by absolute path when needed. Users may still install module
skills directly for standalone use. If DDev is missing on a machine, tell the
user to install or initialize it instead of silently wiring it during an
unrelated task.

## Source

This skill is maintained in `deweyou/agents` and indexed by `deweyou-cli agent update`.
