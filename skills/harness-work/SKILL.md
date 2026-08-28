---
name: harness-work
description: >
  Deweyou Harness Work. Use when the user invokes /harness-work; asks to
  create, update, or migrate harness.yaml; or asks to start or resume durable
  work governed by a Commitment, evidence-backed Claims, and a task-scoped
  Plan; or repository work reveals a necessary update to durable knowledge in
  AGENTS.md and docs. Keeps exploration free, activates capabilities
  progressively, delegates bounded node executions, and records replayable
  state through the Deweyou Harness MCP server.
user-invocable: true
---

# Deweyou Harness Work

`/harness-work` is the plugin's single user-facing entry for configuration and
durable agent work. The agent may
explore and discuss freely. Create a Run only when the work needs a durable
commitment, acceptance record, delegation, recovery, or delivery boundary.

`harness.yaml` declares repository Context, reusable Skills, and node
capabilities. It does not
declare a workflow. The Plan belongs to one Run and may be revised when the
Commitment changes.

## Workspace Preparation Gate

Loading this Skill does not authorize or trigger Git workspace preparation.
Explore in the current checkout until task implementation is actually intended.

Do not prepare a branch or worktree for questions, explanations, code reading,
Dashboard or Run inspection, diagnosis, review, planning, or other read-only
work. Prepare only when the user explicitly asks to implement a repository
change, or when an ongoing task reaches its first necessary project mutation
and that mutation is within the user's authority. Commands that generate or
rewrite tracked files count as mutation.

Creating, updating, or migrating `harness.yaml` follows the configuration
lifecycle and does not by itself prepare a task workspace or create a Run.

Once prepared, keep using the returned workspace for the rest of the task. Do
not prepare again for each command, Plan revision, or node. If exploration ends
without mutation, leave Git state unchanged and do not create an empty Run.

## Controller Boundary

The main agent must:

- keep material user choices and external authority in the main conversation
- create and revise the current Commitment through semantic MCP commands
- propose a small Plan DAG whose nodes serve the Commitment's acceptance Claims
- activate only the Context and Skills needed for the current assignment
  needed for the current assignment
- delegate one bounded agent execution to one subagent when supported
- record content-addressed Evidence and connect it to explicit Claims
- complete only when the current Commitment's acceptance Claims are resolved

Core owns identities, revisions, attempts, timestamps, event ordering, and
transition validation. Never append arbitrary events or invent those fields in
the controller. Cordis owns capability lifecycles only; it is not Run or Plan
authority.

## Start Or Resume

Read [commitment.md](references/commitment.md) before creating durable state.
When the requested outcome is ambiguous, has meaningful alternatives, asks for
critique, or needs a durable Spec, also read
[framing-and-spec.md](references/framing-and-spec.md). Framing is a natural
conversation before or during durable work; it is not a fixed Stage and does
not require a Run by itself.

1. Find the workspace root and explore read-only until the workspace preparation gate
   is resolved. A conversational or read-only result ends here without Git
   preparation or Run creation.
2. Resume an existing Run from its recorded workspace. Do not prepare another
   branch or worktree for it.
3. Inspect the Harness configuration. Read
   [configuration.md](references/configuration.md) when `harness.yaml` is
   absent and the user requested Harness execution or configuration, when the
   user explicitly requests a configuration change, or when `config_inspect`
   reports an unsupported version. Apply and validate requested configuration
   lifecycle work in the current workspace. A configuration-only request ends
   here without task workspace preparation or Run creation.
4. For new implementation work, before the first project mutation, read
   [workspace-preparation.md](references/workspace-preparation.md) and prepare
   the workspace with `workspace_prepare` using the inspected `strategy`.
   Validate the configuration again from the returned workspace and retain its
   preparation Receipt for `run_create`.
5. Create durable state only when the work needs a Commitment, acceptance
   record, delegation, recovery, or delivery boundary. Call `run_create` with
   the prepared workspace path and Receipt identity. Core verifies the current
   branch, revision, base, and configured strategy, then resolves the path to a
   stable logical WorkspaceRef for the local repository, plus an initial
   Commitment: objective, scope, authority, intended destination, acceptance
   Claims, and unresolved material decisions.
6. Use `capabilities_list` for summaries. Activate every configured Context for
   the Run and record its digest-bearing receipt. Activate a Node's declared
   Skills when that Node is assigned; do not treat Context as Node-local.
7. Propose a Plan containing node instances, dependencies, inputs, Claim links,
   inherited authority, and an optional coarse phase (`planning`,
   `implementation`, `integration`, `verification`, or `delivery`) for
   Dashboard organization. Phase never substitutes for dependencies. Call `plan_propose`, inspect the result,
   then call `plan_activate` when it matches the current Commitment revision.

To resume, call `run_get` with interrupted-execution recovery enabled. Re-list
and reactivate the current node's required capabilities using fresh activation
receipts. Never assume compressed or handed-off context retained executable
instructions.

## Plan And Execution Loop

Read [execution-loop.md](references/execution-loop.md) before dispatching work.

Before revising an in-progress Plan, perform a bounded impact analysis. Classify
prior work as `reuse`, `rerun`, or `add`. Reuse unaffected executions and current
Evidence; include only `rerun` and `add` work in the new Plan revision. Do not
rerun discovery, design, implementation, or broad verification merely because
the Plan revision changed.

1. Ask Core for ready assignments in the active Plan revision. Use the resolved
   Node Definition returned by `ready_nodes`; never reload it from the mutable
   workspace configuration. Preserve the returned Run, Workspace, Commitment,
   and Plan envelope unchanged when dispatching an assignment.
2. For each ready assignment, activate its declared Skills and inspect its
   authority boundary.
3. Call `execution_start` with the assignment envelope's Commitment revision,
   Plan revision, and Planned Node ID unchanged; use the returned execution
   identity and attempt. On a stale-revision error, discard the assignment and
   call `ready_nodes` again.
4. Dispatch the Node according to its configured `kind`. An Agent Node performs
   the bounded assignment with its activated Skills. A Command Node executes
   its frozen `command` string once through the host in the assignment's
   `workspace.path`. Map exit `0` to `succeeded`, non-zero to `failed`, explicit
   cancellation to `cancelled`, and unexpected loss to `interrupted`. Pass
   cancellation and idempotency through unchanged.
5. Store large or raw verification material as Evidence bound to the current
   execution; Core derives its Plan, Planned Node, Commitment, and input digest.
   Publish durable,
   human-readable or machine-readable node results as immutable Markdown or
   JSON Exports. A task Spec is a Markdown Export with role `spec`; it is not a
   special Core object. Call `execution_finish` exactly once with a concise
   structured result, Evidence references, and any Exports.
6. Evaluate affected Claims explicitly. A successful node does not satisfy a
   Claim by itself.
7. Continue until no node is ready, the Commitment changes, or a material
   decision requires the user.

A terminal attempt does not become ready again. Retry only a failed, blocked,
cancelled, or interrupted latest attempt through `execution_retry`, with a
non-empty reason and Evidence from that attempt. Never retry `skipped` work;
represent newly required work in a revised Plan instead.

Independent ready nodes may run concurrently when their mutation and authority
boundaries do not overlap. A changed requirement creates a new Commitment
revision and supersedes the active Plan; preserve all prior executions and
Evidence.

For a small correction that leaves objective, scope, acceptance, authority, and
destination unchanged, keep the current Commitment. Propose a minimal patch Plan
containing only affected implementation and verification nodes. Escalate to a
new Commitment revision only when one of those material boundaries changes.

## Verification And Completion

Read [verification.md](references/verification.md) before changing a Claim and
[safety-and-delivery.md](references/safety-and-delivery.md) before consequential
external action.

Claims are `open`, `satisfied`, `invalidated`, or `waived`. Satisfy a Claim only
with relevant Evidence tied to the current input and Commitment revision.
Waiving an acceptance Claim requires the authority recorded by the Commitment.

Call `run_complete` only after the destination and authority are current and
every acceptance Claim is satisfied or validly waived and no execution remains
running. Core must reject completion for open Claims, stale Plan revisions,
stale Evidence, or active executions. After completion, do not issue execution,
Plan, Commitment, Claim, Evidence, or resource-activation mutations.

The final response distinguishes what was produced, verified, and delivered,
and states every remaining uncertainty. Retrospective resource suggestions are
evidence-attributed follow-up work; they never rewrite a resource inside the
completed Run.

## Knowledge Maintenance

Read [knowledge-maintenance.md](references/knowledge-maintenance.md) when the
user explicitly asks to preserve or review repository knowledge, or accepts a
proposal targeting a Context resource. Also read it during any stage of
authorized repository work when a verified change would otherwise leave current
repository knowledge missing, stale, or contradictory. Ordinary questions and
useful answers alone do not implicitly authorize knowledge-base edits.

Treat an accepted proposal as input to a separate maintenance task. Prepare the
configured workspace before editing repository knowledge, preserve source
Evidence and the prior resource digest, and record validation against the new
digest. Keep Harness domain-neutral: concrete repository knowledge remains in
the target repository and is activated through a configured Context Provider.
Publish only current useful knowledge. Keep superseded alternatives and the
reasoning that led from one design to another in the task Spec, Run, or Evidence,
not in the active knowledge consumed by future agents.

## Privacy

The Run bundle under `~/.deweyou/harness/` is replayable state. Record the
minimum structured context needed to reconstruct decisions, assignments,
Evidence, and outcomes. Never record secrets, environment dumps, unrelated
conversation, or unredacted large logs. Node input and output are persisted and
visible in the Dashboard, so sanitize them before calling execution commands;
use Evidence for large or raw content.
