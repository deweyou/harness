---
name: dhw
description: >
  Deweyou Harness Work. Use when the user invokes /dhw, asks to run or resume a
  Harness workflow, or asks which configured workflow fits a task. Selects a
  workflow from harness.yaml, orchestrates its four fixed stages, dispatches
  resources progressively, delegates detailed agent nodes to subagents, and
  records durable Run evidence through the Deweyou Harness MCP server.
---

# Deweyou Harness Work

`/dhw` is the controller for a domain-neutral, configuration-owned workflow.
The plugin owns orchestration and evidence; `harness.yaml` owns workflows,
nodes, rules, knowledge, and skill references.

## Controller Boundary

The main agent must:

- select and monitor one workflow
- keep user decisions and stage gates in the main conversation
- ask the Harness MCP server to validate config, persist events, calculate ready
  nodes, dispatch resources, and rebuild state
- assign one detailed agent-node execution to one subagent when the host
  supports subagents
- run independent ready nodes concurrently when safe
- integrate node outputs and decide whether acceptance evidence is sufficient

The main agent must not absorb a large node task merely because it can perform
the work itself. A pure `agent` node still prefers a subagent; an agent node with
skills dispatches those skills first and includes them in the assignment. Use a
local fallback only when subagents are unavailable or the node is truly trivial,
and record that fallback.

The MCP server is a deterministic control and state plane. It does not launch
subagents and does not decide product or editorial intent.

## Start Or Resume

1. Find the workspace root and call `config_inspect`.
2. Compare the user request with every selectable workflow's `name` and
   `description`.
3. Select one workflow only when the match is clear. If two remain materially
   plausible, show the short choices and ask the user.
4. Call `run_create` only after selecting a workflow. Do not create a Run for a
   read-only explanation of Harness itself.
5. Call `resources_dispatch` with `scope: workflow` and the Run ID: rules load in full;
   knowledge loads as metadata first.
   If a required receipt is missing, inspect its structured preparation command,
   obtain any host/user approval required for network or filesystem changes,
   run it without string interpolation, and redispatch. Never install silently.
6. Record `workflow.selected`, then enter the first configured stage in the
   canonical order: align, execute, verify, deliver.

To resume, call `run_get` with `recoverInterrupted: true`, then call
`run_rehydrate`. Redispatch workflow rules, knowledge metadata, current-node
skills, and every activated on-demand/supporting resource before continuing.
Do the same after context compaction or a host-session handoff. Never assume the
compressed context retained executable resource instructions.

## Stage Loop

Read [alignment.md](references/alignment.md) before the align stage,
[execution-loop.md](references/execution-loop.md) before dispatching nodes,
[verification.md](references/verification.md) before verification, and
[safety-and-delivery.md](references/safety-and-delivery.md) before delivery or
any action that changes external state.

Stages are fixed and ordered. A workflow may omit stages but may not add or
reorder them:

1. `align`: agree on objective, constraints, acceptance, and material choices.
2. `execute`: produce the requested result.
3. `verify`: test or inspect the result against acceptance evidence.
4. `deliver`: hand the result to its intended destination after any required
   user authorization.

`verification_rejected` loops to execute. A material scope or requirement error
returns to align. `delivery_rejected` returns to execute. Never overwrite prior
attempts: increment `stageVisit`, allocate a new `nodeExecutionId`, and preserve
the per-node `attempt`.

Hard v0.1 limits are two attempts for one node in one stage and three visits to
one stage. Retry only evidence-backed, retryable technical failures. Otherwise
record `node.blocked`, report the blocker, and ask only for the missing decision.

## Node Dispatch

For each stage:

1. Record `stage.started` with `stage` and `stageVisit`.
2. Call `ready_nodes` using completed and already-started instance IDs.
3. For each ready node, resolve its reusable node definition.
4. For `agent` nodes, call `resources_dispatch` with `scope: node` and the Run ID, record every
   successful `resource.activated` receipt, and give one subagent a bounded
   assignment containing inputs, constraints, expected output, evidence, and
   the dispatched skill text. Empty `skills` means a pure agent assignment.
5. For `command` nodes, the controller may run the configured command directly.
   Treat command text as workspace-owned code: show or inspect consequential
   commands before running them and follow host approval rules.
6. Record `node.started` before execution and exactly one terminal node event.
7. Store large/raw output as content-addressed evidence; keep event payloads
   short, structured, and redacted.
8. Repeat until no node remains. If no node is ready and unfinished nodes remain,
   stop because the validated DAG and observed state disagree.

Use a single trace for the Run and child spans for stages, node executions,
commands, subagents, tools, and evidence. Preserve parent span links.

## Privacy And Evidence

The Run bundle under `~/.deweyou/harness/` is the only future dashboard,
retrospective, and evaluation data source. Record enough structured evidence to
reconstruct decisions, durations, retries, rework, assignments, and outcomes.
Do not record secrets, environment dumps, unrelated conversation, or unredacted
large logs. Evidence proves a claim; the event records the claim and evidence
identity.

## Completion

Do not equate implementation with verification or delivery. Finish only when:

- configured stage nodes are terminal
- acceptance claims have relevant evidence or an explicit recorded gap
- delivery was performed only with the authority required for that destination
- `run.completed` records the outcome
- the final response states what was produced, what was verified, what was
  delivered, and what remains uncertain
