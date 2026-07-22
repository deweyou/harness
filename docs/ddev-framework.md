# DDev Framework Technical Plan

```mermaid
flowchart LR
    Update["deweyou-cli update"] --> Cache["CLI and agent cache"]
    Cache --> Install["dev install"]
    Install --> Session["explicit task session"]
    Session --> Close["close"]
    Close --> Archive["archive"]
    Close --> Clean["clean --force"]
```

*Status: MVP implementation plan*

DDev is Dewey's personal cross-repository development harness. It is not a
general team agent platform. It gives one agent session a small local runtime,
a clear workflow owner, and enough written state to resume, verify, ship, and
learn without replaying the whole chat.

```text
DDev = Problem Framing + Harness + Demo + Loop + Evidence + Memory

Agent entry:      ddev / $DDev, or explicit project AGENTS.md opt-in
CLI namespace:    deweyou-cli dev ...
Global runtime:   ~/.deweyou/dev/
Module skills:    ~/.deweyou/agents/assets/skills/<skill>/SKILL.md
Mandatory rules:  ~/.deweyou/agents/assets/rules/{code-style,engineering-principles}.md
Per-repo state:   ~/.deweyou/dev/repos/<repo-id>/
```

## Goals

- Provide one default personal development workflow across repositories.
- Keep task context current, thin, and inspectable.
- Make task-scoped work resumable across branches and worktrees without
  committing runtime state.
- Make verification evidence explicit before completion or delivery claims.
- Make brainstorming concrete by comparing options, stress-testing tradeoffs,
  and turning selected ideas into local HTML demos when useful.
- Let product, UI, coding, delivery, and memory skills live in the global Dewey
  asset cache and act as modules under one lifecycle owner.
- Keep DDev manually activated so it can coexist with other harness agents on
  the same machine.
- Keep DDev ownership limited to global `~/.deweyou/dev/` state and DDev-owned
  hook cleanup.

## Non-goals

- Do not build a general DAG/node runtime in the MVP.
- Keep machine state limited to identity, lifecycle, compatibility, and
  append-only evidence. Do not add schedulers, review nodes, or subagent
  bindings yet.
- Do not require repositories to commit DDev runtime state.
- Do not replace project tests, CI, lint, browser checks, or review.
- Do not couple `product-notes` or `skill-eval` into the default development
  lifecycle.
- Do not install passive global hooks by default.
- Do not depend on Superpowers as the default backend. Superpowers ideas can be
  mirrored in DDev, and Superpowers can remain an optional compatibility path.

## Architecture

```mermaid
flowchart TD
    User["User request"] --> DDev["ddev skill"]
    CLI["deweyou-cli dev"] --> Runtime["~/.deweyou/dev"]
    Runtime --> State["~/.deweyou/dev/repos/<repo-id>/sessions/<session-id>"]
    DDev --> State
    Cache["~/.deweyou/agents/assets/skills"] --> Modules["global module skills"]
    RuleCache["~/.deweyou/agents/assets/rules"] --> Rules["mandatory operation-scoped rules"]
    DDev --> Modules
    DDev --> Rules
    Rules --> CodeStyle["code-style"]
    Rules --> Engineering["engineering-principles"]
    Modules --> Coding["spec-driven-coding"]
    Modules --> UI["ui-design"]
    Modules --> Framing["problem-framing"]
    Modules --> Product["product-design"]
    Modules --> Delivery["git-delivery"]
    Modules --> Memory["repo-memory"]
```

### Control Plane: `deweyou-cli dev`

The CLI owns deterministic local infrastructure:

- [`cli/src/cli/dev-session.ts#L1`](../cli/src/cli/dev-session.ts#L1) owns the
  task-session lifecycle and cleanup safety.
- [`cli/src/cli/dev-manifest.ts#L1`](../cli/src/cli/dev-manifest.ts#L1) owns the
  runtime compatibility handshake.
- [`skills/ddev/runtime.json#L1`](../skills/ddev/runtime.json#L1) is the
  machine-readable module and schema registry.

- `install`: initialize manual runtime and per-repository configuration without
  creating a task session.
- `session start|list|status|close|archive|clean`: manage explicit task
  lifecycles. Normal completion uses `close`; permanent cleanup requires
  `--force` and refuses active sessions.
- `status`: show runtime and repository state.
- `doctor`: diagnose runtime/CLI compatibility, the manifest-backed module
  cache, session state, legacy
  repo-local state, legacy git excludes, and absence of old DDev passive hooks.
- `clean`: legacy compatibility for session cleanup, with the same `--force`
  requirement.
- `demo`: create the task-session `demo/index.html` file and optionally serve
  it over a local static HTTP server.
- `record`: validate and append one requirement, node, evidence, failure,
  review, recovery, or delivery event.
- `summary`: validate `events.jsonl`, regenerate `summary.md`, and print a
  Markdown or JSON single-session view.
- `uninstall`: remove the current repository's global state, legacy repo-local
  state and exact legacy git exclude lines, old DDev passive hooks from earlier
  versions, and the runtime only when no other repository state remains.

The CLI does not decide product behavior, implementation strategy, completion,
commit, push, or PR creation.

### Runtime Plane: Manual Activation

The MVP runtime is manual. `deweyou-cli dev install` prepares local state and
removes old DDev passive hooks, but it does not add `SessionStart`,
`UserPromptSubmit`, `Stop`, or any other global Codex hook.

This keeps DDev safe to install on machines that already run other harness
agents. A repository can still opt into DDev as its default workflow through
`AGENTS.md`; that is a project instruction, not a device-level passive hook.

### Workflow Plane: `ddev`

`ddev` owns the task lifecycle:

```text
Orient
  -> Problem framing, when exploration or Grilling is needed
  -> Early spec-driven-coding alignment for new or ambiguous behavior
  -> UI prototype gate, when requirement design touches UI
  -> Requirement alignment gate before product-source edits
  -> Capture task/context/graph/verification
  -> Harness map
  -> HTML demo, when visibility helps
  -> Execute bounded loop
  -> Evidence
  -> Delivery, when requested
  -> Retrospect and cleanup
```

Other skills are global modules under `~/.deweyou/agents/assets/skills/`. The
authoritative list comes from `skills/ddev/runtime.json`; DDev reads the selected
module's own trigger contract and returns control to `ddev` after domain work.

`product-notes` and `skill-eval` stay independent and explicit.

DDev also owns two mandatory, operation-scoped rule dependencies. Before
writing, editing, or reviewing code, it reads
`~/.deweyou/agents/assets/rules/code-style.md`. Before module design, boundary
refactoring, dependency changes, or architecturally significant behavior
changes, it reads
`~/.deweyou/agents/assets/rules/engineering-principles.md`. These files are read
from the asset cache even when the user has not installed the rules globally or
in the repository. If an applicable file remains missing after
`deweyou-cli update --agents-only`, the affected operation stops as blocked.

The module list and runtime/event schema handshake come from
`skills/ddev/runtime.json` in the asset cache. The CLI validates the manifest's
minimum version and required capabilities during install and doctor. Runtime
config is a materialized view, not a second registry.

## Local State Contract

```text
~/.deweyou/dev/
  config.json
  repos/
    <repo-id>/
      config.json
      sessions/
        <session-id>/
          session.json
          task.md
          events.jsonl
          summary.md
          demo/              # optional
            index.html
          <other-artifacts>  # optional
      archives/
        <session-id>/
      checkouts/
        <checkout-id>.json
```

Core file roles:

- `session.json`: task identity and active/closed/archived lifecycle state;
  branch and head are metadata only.
- `task.md`: concise task intent, acceptance, alignment, and status.
- `events.jsonl`: append-only schema-versioned protocol events.
- `summary.md`: generated single-session view of latest nodes, claims, failures,
  reviews, recovery hints, delivery, and open issues.

Demo, graph, context, decision, evidence, and retrospective files are created
only when the task needs them. Directories are private (`0700`), files are
private (`0600`), metadata and summaries use atomic replacement, and event
validation plus append is serialized with a lock. Payload and log sizes are
bounded; event JSON may come from `--data`, `--data-file`, or stdin.

This state is local working memory outside project source. New DDev installs do
not write project `.gitignore` or `.git/info/exclude`; project-local
`.deweyou/dev/` is treated only as legacy state.

Repository ids prefer a normalized origin remote and otherwise use the Git
common directory or absolute path fallback. This lets worktrees share repository
state while keeping a separate current-session pointer per checkout. Existing
path-identified repo roots and branch-named session directories remain visible
as legacy state; install and list never move or delete them implicitly.

## Artifact / Claim / Evidence In MVP

MVP keeps this human-readable:

- Artifact: a file, diff, screenshot, report, command output, PR, deployment, or
  URL that was produced or inspected.
- Claim: the behavior or state DDev says is true.
- Evidence: the check or observation that proves, weakens, or blocks the claim.

Use `evidence.md` like this:

```markdown
## Claims

- [verified] Explicit session start creates the four core task files.
- [verified] DDev install leaves passive Codex hooks absent.

## Evidence

- `pnpm run typecheck:cli` passed on 2026-07-08.
- `pnpm --filter deweyou-cli test -- dev.test.ts args.test.ts` passed.
- `deweyou-cli dev doctor` reported DDev passive hooks absent.
```

For non-trivial sessions, the CLI adds a small machine-readable protocol without
replacing the human-readable files:

```bash
deweyou-cli dev record --kind node --data \
  '{"node_id":"implement","node_type":"implementation","status":"completed"}'
deweyou-cli dev record --kind evidence --data \
  '{"evidence_id":"test-1","claim_id":"tests-pass","evidence_type":"command","status":"verified","summary":"Targeted tests passed."}'
deweyou-cli dev summary --format markdown
```

`record` validates duplicate ids, ISO timestamps, session identity, references,
state transitions, and delivery consistency before appending under a file lock.
`summary` rejects malformed or semantically inconsistent persisted events
instead of silently dropping evidence. An empty log is reported as incomplete,
not as “no open issues.” A failure or review event may carry `restart_from`; it
is a recovery hint, not an automatic retry.

## Lightweight DAG In MVP

MVP uses `graph.md`, not a scheduler:

```markdown
# Graph

- [x] Implement CLI session and manual runtime support
- [ ] Update skills and docs
- [ ] Run asset and CLI validation
- [ ] Install and validate local state
```

For heavier tasks, `graph.md` can show edges:

```text
API contract -> server implementation -> UI integration -> E2E evidence
```

The graph is for human recovery and reasoning. It does not imply node runtime,
automatic scheduling, or subagent binding.

## Problem Framing In MVP

Grilling and brainstorming are handled by the global `problem-framing` skill.
DDev loads it as a module rather than carrying all creative process instructions
itself.

Use this loop:

1. Frame the problem, audience, constraints, taste, and non-goals.
2. Diverge into 3-5 meaningfully different directions.
3. Stress-test each direction with tradeoffs, failure modes, and verification cost.
4. Converge on one recommendation plus one backup path.
5. Decide whether a local HTML demo would make the idea clearer than more text.

Write the durable working output to `brainstorm.md`. Keep raw ideation temporary,
then return control to DDev for demos, evidence, delivery, and cleanup.

When the converged requirement includes UI, DDev loads `ui-design` from the
global cache for a prototype before implementation. The prototype can be a
screen/state structure, a prototype image prompt, a component-level sketch, or a
local HTML demo when seeing the interaction would reduce uncertainty.

## Requirement Alignment In MVP

New features, user-visible behavior changes, and ambiguous product requests load
`spec-driven-coding` before product-source edits. A request to implement starts
the workflow; it does not approve requirements inferred by the agent.

DDev records one of three alignment states:

- `alignment_required`: material behavior is missing or inferred; show a concise
  spec and wait for explicit user confirmation.
- `confirmed`: the user explicitly approved the relevant requirement, spec, or
  prototype.
- `confirmation_not_required`: behavior is already defined by the user or an
  authoritative contract, or the user explicitly delegated a reversible,
  low-risk choice.

Internal notes and prototypes are evidence of work, not evidence of user
approval. Mechanical edits and narrow bugfixes with established expected
behavior can proceed without an unnecessary confirmation pause.

## HTML Demo In MVP

Use the local demo workspace when a concept needs to be seen:

```bash
deweyou-cli dev demo --no-server
deweyou-cli dev demo --port 4173
```

The demo lives at
`~/.deweyou/dev/repos/<repo-id>/sessions/<session-id>/demo/index.html` and is local
working state. It is useful for product sketches, UI states, interaction
prototypes, and comparing brainstormed options before touching product code.
DDev should record the prototype path, local URL, visual check, or explicit gap
in `demo.md` and `evidence.md`.

## MVP Commands

```bash
deweyou-cli dev install [--dry-run]
deweyou-cli dev session start --title "task"
deweyou-cli dev session list
deweyou-cli dev session status [--id id]
deweyou-cli dev session close [--id id]
deweyou-cli dev session archive [--id id]
deweyou-cli dev session clean [--id id|--all] [--dry-run] --force
deweyou-cli dev status
deweyou-cli dev doctor
deweyou-cli dev clean [--branch name|--all] [--dry-run] --force
deweyou-cli dev demo [--id id|--branch name] [--host host] [--port port] [--no-server] [--dry-run]
deweyou-cli dev record [--id id|--branch name] --kind kind (--data json|--data-file path)
deweyou-cli dev summary [--id id|--branch name] [--format markdown|json]
deweyou-cli dev uninstall [--dry-run]
```

Recommended repository setup:

```bash
deweyou-cli update --agents-only
deweyou-cli agent init \
  --skills ddev \
  --rules ddev-local-state,verification-evidence,loop-boundaries \
  --mode link \
  --yes
deweyou-cli dev install
deweyou-cli dev doctor
```

Global or project installation of `code-style` and `engineering-principles` is
optional for DDev. DDev reads the cached rule files directly when their
operation scope applies.

## Ownership Boundary

DDev owns only:

- `~/.deweyou/dev/`
- `~/.deweyou/dev/repos/<repo-id>/`
- legacy `<repo>/.deweyou/dev/` cleanup when uninstalling
- the exact legacy `.deweyou/dev/` local git exclude line
- old DDev passive hooks from earlier DDev versions

It does not inspect, diagnose, exclude, or clean local state from other harness
agents.

## Future Work

These are intentionally outside MVP:

- DAG/node scheduler
- executable Review Node
- subagent binding
- complex recovery state machine
- report generation over many sessions
- automatic cross-session analysis and skill mutation
- optional compatibility backend for Superpowers-style workflows

Adoption triggers and boundaries live in
[`docs/ddev-evolution.md`](./ddev-evolution.md). Only add these capabilities
when repeated session evidence shows the lightweight protocol is insufficient.

---
*Last updated: 2026-07-22 | Reason: Added explicit task sessions, runtime compatibility handshake, and safe lifecycle cleanup.*
