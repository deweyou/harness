---
name: spec-driven-coding
description: >
  DDev-native coding workflow for features, behavior changes, debugging, TDD,
  and verification. Use when starting or continuing implementation work,
  requirement alignment, behavior-impacting refactors, ambiguous coding tasks,
  or bugfixes that need reproduction, tests, focused repair, and evidence.
---

# Spec-Driven Coding

Use this skill as the coding-flow module. It can run standalone, but when DDev
invokes it, return control to `ddev` after coding evidence is collected.

The goal is not heavyweight process. The goal is to keep behavior, tests,
verification, and requirement changes aligned before and during code changes.

## Scope Decision

Classify the task before editing:

- **Feature alignment flow**: new features, behavior changes, ambiguous
  requirements, multi-step implementation, user-facing workflows, architecture
  changes, or anything likely to need explicit acceptance criteria.
- **Lightweight bugfix flow**: narrow bugfixes with clear expected behavior,
  reproducible symptoms, and a small blast radius.
- **Debugging flow**: failures or unexpected behavior where the cause is not yet
  known.
- **No coding flow**: questions, read-only analysis, or review-only requests.

When uncertain, choose feature alignment flow and keep it thin.

## Feature Alignment Flow

Do not write implementation code until the behavior boundary is clear enough to
test or verify. A request to implement authorizes the development workflow; it
does not approve product requirements inferred by the agent.

Before implementation, capture:

- user goal and non-goals
- affected behavior and public surfaces
- acceptance criteria
- likely files or module boundaries
- verification commands or live checks
- open questions that would change behavior, data, security, migration, or UX

Ask the user only for unresolved questions that materially affect direction or
risk. Treat multiple reasonable user-visible behaviors, new pages or flows,
destructive semantics, permissions, persistence, migrations, security, and
public API behavior as material decisions.

For an underspecified new feature:

1. Ask the smallest set of material questions.
2. Produce a concise spec with goal, non-goals, behavior, acceptance criteria,
   and verification.
3. Show the spec to the user and wait for explicit confirmation before editing
   product source.

Do not treat an agent-authored spec, `task.md`, plan, acceptance list, or
prototype as user confirmation. If the user explicitly delegates reversible,
low-risk choices, state the chosen behavior and proceed without an additional
pause. Do not use delegated discretion to bypass confirmation for high-risk or
hard-to-reverse decisions.

When the behavior is fully defined by the user's words or an existing
authoritative contract, record `confirmation_not_required` with the source and
a short reason, then proceed. Mechanical edits and narrow bugfixes with
established expected behavior do not need a feature-spec pause.

For high-risk or broad work, write a concise plan and wait whenever material
requirements or user choices remain unresolved, even if implementation was
already authorized. For small work, the acceptance criteria and verification
map are enough only when no material product decision remains unresolved.

## Optional Compatibility

Superpowers-style brainstorming, specs, plans, or subagent execution may be used
only when the current harness exposes them and they help the task. They are not
required by this DDev-native workflow.

## Coding Flow

During implementation:

- Use TDD when behavior can be tested first or a regression is clear.
- Add or update unit tests for changed behavior.
- Preserve or improve coverage thresholds; never lower them to pass.
- Prefer focused integration or smoke checks when unit tests cannot cover the risk.
- Keep code changes scoped to the accepted behavior and plan.
- If requirements change during coding, decide whether the spec must be updated
  before continuing. Update task context or ask for alignment when the change
  affects behavior, architecture, scope, user expectations, or future routing.
- When invoked by DDev, update DDev evidence or decision state if it exists, but
  do not write durable repo documentation unless `repo-memory` is needed.

## Lightweight Bugfix Flow

For simple bugfixes:

1. Reproduce or inspect enough evidence to understand the failure.
2. Add a regression test first when practical.
3. Fix the smallest responsible boundary.
4. Run targeted verification.
5. Update the spec or repo memory only when the bug reveals durable behavior,
   assumptions, or constraints.

## Debugging Flow

For unclear failures:

1. Gather the symptom, command output, logs, state, and expected behavior.
2. Identify the nearest failing boundary.
3. Form one hypothesis at a time.
4. Run the smallest probe that can disprove or confirm it.
5. Fix only after evidence points to a cause.

Stop and ask when several plausible fixes would change behavior, data, API,
security, or UX differently.

## Completion Gate

Before claiming the work is done:

- run relevant tests, typecheck, lint, build, or coverage commands
- run live or manual checks when source-level tests cannot prove the claim
- run repo-memory when the work changed durable context
- hand off to git-delivery when the user wants to ship
- return control to DDev when this skill was invoked as a module

## Output

Report:

- which flow was used
- alignment status, acceptance source, and unresolved decisions or the reason
  confirmation was not required
- acceptance criteria, plan, or assumptions used
- tests added or skipped with reason
- verification commands and results
- whether repo memory or spec updates were needed after coding
- whether control returns to DDev or the standalone workflow is complete
