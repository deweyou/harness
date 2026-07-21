---
name: ddev
description: >
  DDev personal cross-repository development harness workflow. Use when the
  user explicitly invokes DDev or ddev, or when project instructions opt into
  DDev as the default development workflow. Coordinates global ~/.deweyou/dev
  state and product, UI, coding, delivery, and memory skills under one
  lifecycle owner.
---

# DDev

DDev is the lifecycle owner for Dewey's personal cross-repository development
work. It keeps a task bounded, inspectable, verifiable, and easy to resume
without turning every request into a heavyweight spec process.

`deweyou-cli dev` provides manually activated local runtime support. This skill
owns the agent workflow. Other skills are global capability modules loaded from
the Dewey asset cache when needed.

## Core Contract

- Own the task lifecycle from orientation through evidence and handoff.
- Activate only when the user invokes `$DDev`/`ddev` or when project
  instructions explicitly make DDev the default workflow. Do not rely on passive
  global hooks.
- If `deweyou-cli dev doctor` reports missing DDev runtime, tell the user how to
  install it. Do not silently install DDev.
- Prefer lightweight context over heavyweight process.
- Ask concise Grilling questions only when ambiguity changes direction, risk, or
  expected behavior.
- Treat a request to implement as authorization to start the development
  workflow, not as approval of requirements inferred by the agent.
- For a new feature with underspecified user-visible behavior, load
  `spec-driven-coding` before editing product source, produce a concise spec, and
  wait for explicit user confirmation of material product decisions.
- Create `~/.deweyou/dev/` state only for real implementation sessions, not for
  simple read-only answers.
- Treat DDev state as local, temporary working memory outside project source.
  Do not commit legacy project-local `.deweyou/dev/` if it appears.
- Load the mandatory `code-style` and `engineering-principles` rules from the
  global Dewey asset cache before operations to which they apply, even when the
  user has not installed those rules globally or in the repository.
- When requirement design touches UI, proactively load the `ui-design` module to
  produce a prototype before implementation.
- Verify claims with the smallest meaningful evidence. State gaps plainly.
- Ship only on explicit delivery intent. Do not commit, push, or open a PR
  silently.

## Module Resolution Contract

Repository setup only needs the `ddev` entry skill. DDev module skills live in
the global Dewey asset cache and should not be required in the repository
manifest:

```text
~/.deweyou/agents/assets/skills/<skill>/SKILL.md
```

Use this module registry:

| Situation | Module skill path |
| --- | --- |
| Grilling, brainstorming, option critique, recommendation | `~/.deweyou/agents/assets/skills/problem-framing/SKILL.md` |
| Product scope, next-version decisions, comparable product research | `~/.deweyou/agents/assets/skills/product-design/SKILL.md` |
| UI requirement prototypes, UX, visual design, implementation, live visual evidence | `~/.deweyou/agents/assets/skills/ui-design/SKILL.md` |
| Coding, debugging, TDD, verification, requirement alignment | `~/.deweyou/agents/assets/skills/spec-driven-coding/SKILL.md` |
| Commit, push, PR, base sync, CI follow-up | `~/.deweyou/agents/assets/skills/git-delivery/SKILL.md` |
| Durable repository knowledge after meaningful changes | `~/.deweyou/agents/assets/skills/repo-memory/SKILL.md` |

Before applying a module, read that module's `SKILL.md` from the absolute path
above. If the host already exposes the module as a native installed skill, using
the native skill is also acceptable; still keep DDev as lifecycle owner.

If a module file is missing during an explicit DDev run or `$DDev setup`, run or
ask the user to run:

```bash
deweyou-cli agent update
deweyou-cli dev install
deweyou-cli dev doctor
```

If the repository has no DDev entry skill and the user explicitly asks for DDev
setup, initialize only the entry skill:

```bash
deweyou-cli agent init --skills ddev --mode link --yes
```

Users may still install module skills directly into a specific harness or
repository. That is optional compatibility, not the default DDev dependency
model.

## Mandatory Rule Dependencies

DDev has two mandatory rule dependencies in the global Dewey asset cache:

| Operation | Required rule path |
| --- | --- |
| Writing, editing, or reviewing code | `~/.deweyou/agents/assets/rules/code-style.md` |
| Designing modules, refactoring boundaries, adding dependencies, or changing behavior with architectural impact | `~/.deweyou/agents/assets/rules/engineering-principles.md` |

Read each applicable rule in full before the affected operation. This is a DDev
workflow dependency, not a requirement for the user to install the rules into
global agent instructions or the repository manifest. Project-specific
instructions still take precedence where the rule itself allows them to.

Do not load these rules for unrelated DDev modes merely because DDev is active.
For example, a read-only runtime inspection or product brainstorm does not need
coding rules unless it turns into code review or an architectural decision.

If an applicable rule file is missing, run or ask the user to run:

```bash
deweyou-cli agent update
```

Re-check the exact rule path after the refresh. If it is still missing, stop the
affected coding or architecture operation and report the missing rule as a
blocker. Do not silently continue without a mandatory rule.

## Local Session Contract

For non-trivial implementation sessions, use:

```text
~/.deweyou/dev/
  config.json
  repos/
    <repo-id>/
      config.json
      sessions/
        <branch>/
          task.md
          brainstorm.md
          context.md
          graph.md
          decisions.md
          verification.md
          evidence.md
          demo.md
          demo/
            index.html
          retrospective.md
          events.jsonl
          summary.md
          stop-issues.txt
```

Keep these files short and human-readable:

- `task.md`: goal, scope, non-goals, acceptance criteria, acceptance source,
  alignment status, unresolved decisions, and current status.
- `brainstorm.md`: frame, divergent options, critiques, tradeoffs, and recommendation.
- `context.md`: relevant files, commands, docs, constraints, and facts.
- `graph.md`: lightweight step or dependency graph; use checkboxes or edges.
- `decisions.md`: decisions that changed the path and why.
- `verification.md`: planned verification gates.
- `evidence.md`: claims, commands, screenshots, live checks, and gaps.
- `demo.md`: demo path, local URL, visual checks, and demo evidence.
- `demo/index.html`: branch-session static HTML demo for sketches and prototypes.
- `retrospective.md`: candidates for repo-memory or DDev improvement.
- `events.jsonl`: append-only validated protocol events.
- `summary.md`: generated single-session view of requirements, nodes, claims,
  failures, reviews, recovery, delivery, and open issues.
- `stop-issues.txt`: optional diagnostics from earlier or explicit checks;
  there is no passive Stop hook in the MVP.

Do not create machine `state.json`, a node scheduler, subagent bindings, or a
complex recovery state machine in the MVP. For complex tasks, use `graph.md` and
`evidence.md` as the human recovery surface, and use validated protocol events
only to link nodes, evidence, failures, review verdicts, and restart hints.

### Structured Session Protocol

For non-trivial implementation sessions, record lifecycle facts with:

```bash
deweyou-cli dev record --kind <kind> --data '<json-object>'
deweyou-cli dev summary --format markdown
```

Supported kinds are `requirement`, `node`, `evidence`, `failure`, `review`,
`recovery`, and `delivery`. Each command appends one schema-versioned event to
`events.jsonl`; `summary` validates the full log and regenerates `summary.md`.

Use the protocol when a task has dependencies, multiple evidence claims, a
review verdict, a failure that may restart from a smaller boundary, or a delivery
handoff. Do not add event ceremony to a mechanical edit when `task.md` and one
verification result are clearer.

The protocol records decisions; it does not execute nodes. `restart_from` is a
reviewable recovery hint, not permission for an automatic retry. Keep the
human-readable session files authoritative for task intent and use event ids,
claim ids, and evidence ids to make proof traceable.

Do not put secrets, access tokens, full chat transcripts, or large raw logs in
event payloads. Record a redacted summary and an artifact path or external
evidence reference instead.

## Workflow

### 1. Orient

Read repository instructions, active rules, current git state, and any existing
DDev session for the branch. Identify whether the upcoming work requires either
mandatory DDev rule and resolve its cache path before the affected operation.

If project instructions say DDev is the default workflow for non-trivial
development tasks, treat that as repository-level opt-in. Otherwise use DDev
only when the user explicitly invokes it.

When DDev is invoked, check whether `deweyou-cli dev doctor` can confirm the
local runtime and global module cache. If DDev was invoked explicitly or the
user requested setup, run the repair commands when appropriate. If this is an
unrelated task that only has repository-level DDev opt-in and doctor reports a
missing runtime or module cache, stop and tell the user:

```bash
npm install -g deweyou-cli
deweyou-cli agent update
deweyou-cli agent init --skills ddev --mode link --yes
deweyou-cli dev install
```

Do not install or wire DDev automatically inside an unrelated task. If the user
explicitly asks to set up DDev, use `deweyou-cli agent update`,
`deweyou-cli agent init --skills ddev --mode link --yes`, and
`deweyou-cli dev install`, then verify with `deweyou-cli dev doctor`.

Classify the request:

- `task`: implementation, bugfix, refactor, asset, docs, or workflow change.
- `inspect`: read-only analysis, status, architecture question, or "look at
  this before changing it."
- `brainstorm`: divergent exploration, concept comparison, product/design
  directions, or "think with me before building."
- `demo`: create or serve a branch-session HTML demo to make a concept visible.
- `setup`: install, upgrade, diagnose, or explain DDev runtime setup.
- `ship`: explicit delivery request.
- `retrospect`: capture durable learning or clean up temporary context.
- `clean-context`: remove or summarize DDev-local state.
- `uninstall`: explicit request to remove current repository DDev state and the
  runtime only when no other repository state remains.

For read-only `inspect`, avoid creating session state unless the user asks
for a durable investigation trail.

For a `task`, classify the requirement before product-source edits. New
features, user-visible behavior changes, and ambiguous product requests must
enter the `spec-driven-coding` feature alignment flow early. Do not wait until
the Execute Loop to load the coding module for requirement alignment.

### 2. Problem Framing

Before implementation or demo work, load `problem-framing` from the global
module registry when the request needs Grilling, brainstorming, critique, or
option convergence.

Use it to resolve:

- desired behavior and non-goals
- audience, constraints, and taste
- acceptance criteria and evidence
- risk level and affected surfaces
- divergent options, tradeoffs, and recommendation
- whether an HTML demo would clarify the direction

When local state exists, write durable framing output to `brainstorm.md`.
Return to DDev for state, demo, evidence, delivery, memory, and cleanup.

### 2.5. UI Prototype Gate

When requirement design touches a user interface, load `ui-design` from the
global module registry before implementation. This includes new or changed
screens, flows, components, visual hierarchy, interaction states, responsive
behavior, generated UI prompts, or visual acceptance.

Ask `ui-design` for the smallest useful prototype artifact:

- low-fidelity screen or state structure
- visual prototype plan or prototype image prompt
- branch-session static HTML demo when seeing the flow would clarify direction
- component-level prototype notes for existing design systems

Record the chosen prototype path, URL, screenshot/render check, or explicit gap
in `demo.md` and `evidence.md` when local state exists. Do not trigger this gate
for backend, CLI, data, or infra work that merely mentions a UI label unless the
actual interface behavior or visual state changes.

### 2.75. Requirement Alignment Gate

Before editing product source, classify requirement alignment with
`spec-driven-coding`:

- `alignment_required`: material product behavior is missing or inferred by the
  agent. Ask only the questions that change the result, present a concise spec
  with acceptance criteria, and wait for explicit user confirmation.
- `confirmed`: the user explicitly approved the relevant requirement, spec, or
  prototype.
- `confirmation_not_required`: the requested behavior is already fully defined
  by the user's words or an existing authoritative contract, or the remaining
  choice is a reversible low-risk implementation detail that the user explicitly
  delegated. Record the source and a short reason before proceeding.

Treat new pages, new flows, multiple reasonable product behaviors, destructive
semantics, permissions, data persistence, migrations, security, and public API
behavior as material decisions. A request such as "implement a todo list"
authorizes the workflow but does not approve agent-selected behavior for those
decisions. Writing acceptance criteria into `task.md` or another internal note
never counts as user confirmation.

When local session state exists, record the current alignment status,
acceptance source, and unresolved decisions in `task.md` before pausing.

The gate does not require a pause for mechanical edits, narrow bugfixes with
established expected behavior, or work whose acceptance criteria are already
complete. A prototype may be created before confirmation to make a UI decision
visible, but do not convert it into product source until the gate permits it.

### 3. Capture Context And Acceptance

For implementation sessions, create or update the local session. Keep the files
thin:

- summarize the task in `task.md`
- record `acceptance_source` as `user`, `existing_contract`, or `inferred`
- record `alignment_status` as `alignment_required`, `confirmed`, or
  `confirmation_not_required`, including unresolved decisions or the no-pause
  reason
- add inspected facts to `context.md`
- add the next steps or dependencies to `graph.md`
- add verification intent to `verification.md`
- for non-trivial sessions, record the requirement event after alignment is
  resolved so later evidence has a stable acceptance source

This is working memory, not project documentation.

### 4. Harness Map

Identify the available harness before editing:

- repository test, lint, typecheck, build, and smoke commands
- live preview or browser/app verification path
- product, UI, coding, delivery, and memory module paths that apply
- mandatory `code-style` or `engineering-principles` rule paths that apply
- branch-session HTML demo path and preview URL when concept work needs a visual
- UI prototype artifact or gap when requirement design includes interface work
- files or generated artifacts that must stay out of commits

Do not invent expensive checks when a smaller one proves the current claim.

### 5. Execute Loop

Enter this loop only after the Requirement Alignment Gate is `confirmed` or
`confirmation_not_required`.

Run a bounded loop:

1. Make the smallest coherent change.
2. Run the nearest useful check.
3. Record evidence or the blocker; use a validated `node`, `evidence`, or
   `failure` event when the task uses the structured protocol.
4. Repair only when the next step is clear. Record a `review` or `recovery`
   event before using `restart_from` on an affected boundary.
5. Stop when repeated failures indicate missing context or a user decision.

Use `graph.md` to keep step state visible when the task has dependencies. Use
`evidence.md` to tie claims to proof.

For coding work, load `spec-driven-coding` as the DDev-native coding module. For
UI requirement design, prototypes, implementation, or visual evidence, load
`ui-design`. For product-scope choices, load `product-design`.

Before code is written, edited, or reviewed, read the cached `code-style` rule.
Before module design, boundary refactoring, dependency changes, or
architecturally significant behavior changes, also read the cached
`engineering-principles` rule. Apply both when both operation classes are
present.

### 5.5. HTML Demo Loop

When a concept needs to be seen, use the local demo workspace:

```bash
deweyou-cli dev demo --no-server
deweyou-cli dev demo --port 4173
```

The default path is
`~/.deweyou/dev/repos/<repo-id>/sessions/<branch>/demo/index.html`.

Use it for sketches, product explorations, interaction states, and throwaway
visual prototypes. Keep demos outside commits by default. If the demo becomes
real product code, intentionally move the useful parts into source files and
record that decision in `decisions.md`.

### 6. Evidence

Before claiming completion, report:

- checks run and results
- checks skipped and why
- live evidence when visual, browser, runtime, or integration behavior matters
- remaining risks or unverified assumptions

Record the same claims and proof in `evidence.md` when the session has local
state. When structured events were used, run `deweyou-cli dev summary` and check
that `summary.md` does not leave failed nodes, unverified claims, blocked reviews,
or planned recovery unexplained.

### 7. Delivery

When the user says `$DDev ship`, "提交吧", "开 PR", "push", or an equivalent
delivery request, load `git-delivery` from the global module registry.

Protect the staging boundary:

- keep DDev global state out of staging; treat project-local `.deweyou/dev/` as
  legacy state and leave it unstaged by default
- exclude unrelated dirty files
- run repo-memory before commit when durable knowledge may have changed
- report exact blockers instead of forcing delivery

### 8. Retrospect And Cleanup

Route durable knowledge to `repo-memory` only when it is expensive to recover
from code alone. Do not copy temporary session notes wholesale into docs.

`product-notes` and `skill-eval` remain independent. Use them only when the user
explicitly asks to capture product notes or run/update skill evaluations.

## Skill Routing

Use global skills as capability modules:

| Situation | Skill |
| --- | --- |
| Grilling, brainstorming, option critique, recommendation | `problem-framing` |
| Product scope, next-version decisions, comparable product research | `product-design` |
| UI requirement prototypes, UX, visual design, implementation, live visual evidence | `ui-design` |
| Coding, debugging, TDD, verification, requirement alignment | `spec-driven-coding` |
| Commit, push, PR, base sync, CI follow-up | `git-delivery` |
| Durable repository knowledge after meaningful changes | `repo-memory` |

After a module skill completes its domain work, resume DDev ownership for
evidence, delivery decision, memory routing, and cleanup.

## Modes

Use these as DDev modes:

- `$DDev <task>`: run the normal development lifecycle.
- `$DDev inspect <question>`: read-only investigation with evidence.
- `$DDev brainstorm <topic>`: generate, critique, compare, and recommend directions.
- `$DDev demo <idea>`: create or update the HTML demo and serve it locally.
- `$DDev setup`: run or explain `deweyou-cli dev install` and `doctor`.
- `$DDev ship`: hand off to git-delivery.
- `$DDev retrospect`: decide what should become durable memory.
- `$DDev clean-context`: summarize or remove local DDev session state.
- `$DDev uninstall`: run `deweyou-cli dev uninstall` only on explicit request.

## Output

Keep user-facing output concise and concrete:

- `mode`: task, inspect, brainstorm, demo, setup, ship, retrospect, clean-context,
  or uninstall
- `state`: not created, read, created, updated, cleaned, or blocked
- `acceptance`: criteria used or blocker
- `alignment`: alignment status, acceptance source, and unresolved decisions or
  the reason confirmation was not required
- `skills`: module skills or absolute module paths used and why
- `rules`: mandatory cached rules read for the operations performed, or not applicable
- `evidence`: checks run, skipped, or blocked
- `delivery`: not requested, handed to git-delivery, or blocked
- `memory`: not needed, routed to repo-memory, or blocked
