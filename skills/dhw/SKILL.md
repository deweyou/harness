---
name: dhw
description: >
  Deweyou Harness Work. Use when the user invokes /dhw or asks to start or
  resume durable work governed by a Commitment, evidence-backed Claims, and a
  task-scoped Plan. Keeps exploration free, activates capabilities
  progressively, delegates bounded node executions, and records replayable
  state through the Deweyou Harness MCP server.
user-invocable: true
---

# Deweyou Harness Work

`/dhw` is a domain-neutral controller for durable agent work. The agent may
explore and discuss freely. Create a Run only when the work needs a durable
commitment, acceptance record, delegation, recovery, or delivery boundary.

`harness.yaml` declares reusable resources and node capabilities. It does not
declare a workflow. The Plan belongs to one Run and may be revised when the
Commitment changes.

## Controller Boundary

The main agent must:

- keep material user choices and external authority in the main conversation
- create and revise the current Commitment through semantic MCP commands
- propose a small Plan DAG whose nodes serve the Commitment's acceptance Claims
- activate only the rules, knowledge, skills, executors, and host capabilities
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

1. Find the workspace root and call `config_inspect`.
2. Explore enough to understand whether durable execution is useful. Do not
   create a Run for a read-only explanation or a small conversational answer.
3. Call `run_create` with the local workspace path. Core resolves it to a
   stable logical WorkspaceRef for the local repository, plus an initial
   Commitment: objective, scope, authority, intended destination, acceptance
   Claims, and unresolved material decisions.
4. Use `capabilities_list` for summaries. Load full content with
   `capability_activate` only when it is relevant to the current Run or node.
5. Propose a Plan containing node instances, dependencies, inputs, expected
   outputs, Claim links, and authority. Call `plan_propose`, inspect the result,
   then call `plan_activate` when it matches the current Commitment revision.

To resume, call `run_get` with interrupted-execution recovery enabled. Re-list
and reactivate the current node's required capabilities using fresh activation
receipts. Never assume compressed or handed-off context retained executable
instructions.

## Plan And Execution Loop

Read [execution-loop.md](references/execution-loop.md) before dispatching work.

1. Ask Core for ready planned nodes in the active Plan revision.
2. For each ready node, activate its declared capabilities and inspect its
   authority boundary.
3. Call `execution_start`; use the returned execution identity and attempt.
4. Let the host adapter invoke the configured project-owned StructuredExecutor
   boundary. Pass cancellation and idempotency through unchanged; Cordis owns
   only the executor capability's scoped lifecycle.
5. Store large or raw output as Evidence. Call `execution_finish` exactly once
   with a concise structured result and Evidence references.
6. Evaluate affected Claims explicitly. A successful node does not satisfy a
   Claim by itself.
7. Continue until no node is ready, the Commitment changes, or a material
   decision requires the user.

Independent ready nodes may run concurrently when their mutation and authority
boundaries do not overlap. A changed requirement creates a new Commitment
revision and supersedes the active Plan; preserve all prior executions and
Evidence.

## Verification And Completion

Read [verification.md](references/verification.md) before changing a Claim and
[safety-and-delivery.md](references/safety-and-delivery.md) before consequential
external action.

Claims are `open`, `satisfied`, `invalidated`, or `waived`. Satisfy a Claim only
with relevant Evidence tied to the current input and Commitment revision.
Waiving an acceptance Claim requires the authority recorded by the Commitment.

Call `run_complete` only after the destination and authority are current and
every acceptance Claim is satisfied or validly waived. Core must reject
completion for open Claims, stale Plan revisions, or stale Evidence.

The final response distinguishes what was produced, verified, and delivered,
and states every remaining uncertainty. Retrospective resource suggestions are
evidence-attributed follow-up work; they never rewrite a resource inside the
completed Run.

## Privacy

The Run bundle under `~/.deweyou/harness/` is replayable state. Record the
minimum structured context needed to reconstruct decisions, assignments,
Evidence, and outcomes. Never record secrets, environment dumps, unrelated
conversation, or unredacted large logs.
