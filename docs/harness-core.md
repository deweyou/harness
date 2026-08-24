# Harness Core

Harness Core is a deterministic, domain-neutral control and state plane for
durable agent work. Agents decide how to explore and perform work. Core records
what has been committed, which claims define acceptance, which task-scoped Plan
is active, what each execution produced, and whether the Run may complete.

There is no Workflow or fixed Stage model. Core rejects unsupported
configuration and event versions rather than translating them during Run
execution. The `harness-work` Skill may migrate workspace configuration before
Run creation, with user-visible handling for semantic changes; historical Run
events are never rewritten.

## Boundary

Core owns:

- Run, Commitment, Claim, Plan, Planned Node, Node Execution, Evidence, and
  Export contracts
- semantic command validation, identifiers, revisions, attempts, timestamps,
  event ordering, and replay
- Plan DAG validation and ready-node calculation
- acceptance and completion invariants
- capability activation receipts and evidence-attributed retrospectives

Agents and host adapters own:

- exploration, judgment, and Plan proposals
- subagent, command, or tool execution
- host-native approvals and external side effects
- domain-specific verification meaning

Knowledge Providers own source content, indexes, retrieval, and publication.
Core may record Evidence-backed feedback and lifecycle state for a proposed
knowledge change, but acceptance authorizes a separate maintenance task rather
than mutating the provider inside the completed Run. Repository providers may
use scoped `AGENTS.md` and `docs/` files; that layout is a provider convention,
not a Core storage contract.

Knowledge publication may occur during any authorized Run stage when current
repository behavior changes. Activated knowledge should describe the current
useful state; superseded alternatives and design evolution remain in Specs, Run
events, Evidence, and version history unless a legacy constraint is still
operationally relevant.

Cordis is used behind the project-owned `CapabilityRuntime` boundary. It owns
dynamic provider registration, scoped capability lookup, and lifecycle cleanup.
It never owns Run or acceptance authority. Cordis isolation is in-process
lifecycle isolation, not a security sandbox.

## Configuration

`harness.yaml` selects one workspace preparation strategy and declares reusable
resources and Node Definitions:

```yaml
version: 2
strategy: worktree

resources:
  review-skill:
    kind: skill
    source:
      type: workspace
      path: .agents/skills/review

nodes:
  review:
    name: Review
    description: Review one bounded result
    executor:
      kind: agent
      skills: [review-skill]
    inputs: [change]
    outputs: [review-result]
    claimTypes: [quality]
    authority: [read-workspace]
    executionPolicy:
      idempotent: true
      timeoutMs: 900000
```

`strategy` is either `branch` or `worktree` and defaults to `branch`. It is
owned by the root configuration and cannot be set by imports. `harness-work`
does not prepare Git state for questions, other read-only work, or
configuration-only maintenance. After implementation intent is known and before
the first project mutation or mutation-bearing Run, it fetches the resolved
remote base and creates a task branch in the current checkout or a separate
worktree. A user-requested base branch overrides the inferred remote default,
but base selection and Git mechanics are not additional configuration fields.

Node Definitions do not contain dependencies. A Planned Node binds a reusable
definition to Run-specific inputs, dependencies, expected outputs, target
Claims, and delegated authority.

Imports remain recursive and cycle-checked. `as` namespaces imported resource
and node IDs and rewrites their resource references. Workspace resource paths
resolve relative to the declaring configuration file.

## Durable Model

### Run And Workspace

A Run has a globally unique identity and a logical `WorkspaceRef`. A local path
is only a locator used by the local repository implementation. Future remote
execution can mount the same logical workspace elsewhere without changing Core
identity.

### Commitment And Claims

A Commitment revision records objective, scope, authority, destination,
acceptance Claim IDs, and unresolved decisions. Material changes create a new
revision; history is immutable.

Claims are `open`, `satisfied`, `invalidated`, or `waived`. Satisfied and waived
acceptance Claims require current Evidence. A waiver also requires the authority
declared by the current Commitment.

### Plan And Execution

A Plan is a proposed, active, or superseded DAG bound to one Commitment
revision. Plans are immutable and revisions are contiguous inside a Run.
Revising a Plan does not imply replaying previous work. A controller may propose
a minimal executable delta containing only affected or newly required nodes;
unaffected executions and current Evidence remain available through Run history.

A Node Execution is one attempt of one Planned Node. Attempts are contiguous
per Plan revision and Planned Node. Starting, finishing, retrying, and
interrupting executions are semantic commands; clients do not allocate attempts
or append arbitrary events. Starting an attempt snapshots its Planned Node input
into the event stream. Finishing it may record a concise structured output. Each
structured payload is limited to 64 KiB. The same terminal command may attach
immutable JSON or Markdown Exports, either from inline content or a source file
inside the Run workspace. Core snapshots source files into the Run bundle and
records their digest and Run-relative locator. Raw verification material and
binary content belong in digest-addressed Evidence instead.

### Evidence And Exports

Evidence proves Claims. It records its Commitment revision and relevant input
digests so Core can reject stale proof after inputs or requirements change.

Exports present durable Node results for people or tools. An Export records its
execution, Commitment revision, media type, digest, size, and immutable snapshot
locator. `role` is an optional domain-neutral hint such as `spec`, `report`, or
`result`; Core does not assign special lifecycle behavior to it. A bare local
path is never Export identity.

## Capability Runtime

Providers can expose skills, rules, knowledge, executors, host integrations,
approvals, or telemetry. Lookup is scoped from general to specific:

```text
global -> workspace -> run -> planned node -> execution
```

Agents list summaries first, then activate full content on demand. Every
activation returns a receipt with provider, scope, locator, and digest.
Idempotency keys replay the same activation and reject different input.
Disposing a Cordis fiber releases effects owned by that provider or activation.

Strong isolation remains a host concern: use a separate subagent session,
process, container, filesystem sandbox, or credential boundary as required.

## Events And Repository

`events.jsonl` is authoritative and hash-chained. `state.json`, resource locks,
active Plan views, and dashboards are rebuildable projections. Immutable config
snapshots and digest-addressed blobs are supporting artifacts, not mutable
authority.

Core depends on a `RunRepository` interface. Harness ships a local filesystem
implementation under `~/.deweyou/harness/`. A database or cloud event store can
implement the same append/read contract later without changing semantic
commands.

The local repository also maintains `~/.deweyou/harness/index/runs.json` as a
rebuildable global Run index. It contains only list-level metadata derived from
each Run's authoritative events and supporting snapshots. The Dashboard and
`run_list` use this index to show active and archived Runs across workspaces;
Run detail is always materialized from the verified event projection.

The MCP process opportunistically starts one read-only Dashboard server on
`127.0.0.1:7777`. If a healthy Harness Dashboard already owns that port, a new
process reuses it instead of starting another server. Set
`DEWEYOU_DASHBOARD_AUTOSTART=0` to disable startup or
`DEWEYOU_DASHBOARD_PORT` to override the port. Run detail exposes every Node
Execution attempt's structured input, output, Evidence links, Exports, and
activity. JSON Exports use the generic JSON viewer and Markdown Exports use the
generic Markdown viewer; a Spec is simply a Markdown Export with role `spec`.
After completion, Core also writes a rebuildable
`reports/retrospective.md` inside the Run bundle and the Dashboard exposes it as
a read-only Report view. Events and retrospective JSON remain authoritative;
the Markdown file is a presentation projection.

Old `~/.deweyou/dev/` state is intentionally ignored. Harness never reads, migrates,
or deletes it.

## Completion

`run_complete` succeeds only when:

1. the referenced Commitment and active Plan revisions are current;
2. no material decision remains unresolved;
3. every acceptance Claim is satisfied or validly waived;
4. every referenced Evidence item exists and targets the current Commitment
   revision and inputs; and
5. the requested destination is within the current authority.

Successful nodes alone never complete a Run.

## Future Extension Seams

Harness reserves inexpensive seams for cloud and multi-agent execution:

- logical workspace identity separate from mounts
- repository abstraction and store-authoritative ordering
- Node Definition, Planned Node, and Node Execution separation
- structured executors with cancellation and idempotency
- digest-addressed Exports and Evidence
- globally unique identities and semantic commands

Harness intentionally does not implement a cloud coordinator, remote scheduler,
device or agent registry, lease and heartbeat protocol, object store,
cross-device sync, mailbox, P2P transport, multi-tenancy, cloud auth, vault, or
billing.

## Public MCP Surface

The MCP server exposes semantic operations rather than raw event mutation:

- `config_inspect`
- `run_create`, `run_get`, `run_list`, `commitment_revise`, `run_complete`
- `plan_propose`, `plan_activate`, `ready_nodes`
- `execution_start`, `execution_finish`
- `evidence_record`, `claim_update`
- `resource_feedback_record`
- `capabilities_list`, `capability_activate`
- `retrospective_get`, `proposal_decide`

The server does not launch subagents, choose product intent, or grant external
authority.

_Last updated: 2026-08-24 — documented generic Node Exports and Dashboard viewers._
