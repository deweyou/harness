# Harness Core v2

Harness Core is a deterministic, domain-neutral control and state plane for
durable agent work. Agents decide how to explore and perform work. Core records
what has been committed, which claims define acceptance, which task-scoped Plan
is active, what each execution produced, and whether the Run may complete.

There is no Workflow or fixed Stage model in v2. Version 1 configuration and
events are rejected rather than translated.

## Boundary

Core owns:

- Run, Commitment, Claim, Plan, Planned Node, Node Execution, Evidence, and
  Artifact contracts
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

Cordis is used behind the project-owned `CapabilityRuntime` boundary. It owns
dynamic provider registration, scoped capability lookup, and lifecycle cleanup.
It never owns Run or acceptance authority. Cordis isolation is in-process
lifecycle isolation, not a security sandbox.

## Configuration

`harness.yaml` declares reusable resources and Node Definitions:

```yaml
version: 2

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

A Node Execution is one attempt of one Planned Node. Attempts are contiguous
per Plan revision and Planned Node. Starting, finishing, retrying, and
interrupting executions are semantic commands; clients do not allocate attempts
or append arbitrary events.

### Evidence And Artifacts

Evidence and Artifacts use a digest as identity plus a locator. A bare local
path is never an identity. Evidence records its Commitment revision and relevant
input digests so Core can reject stale proof after inputs or requirements
change.

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

Core depends on a `RunRepository` interface. v2 ships a local filesystem
implementation under `~/.deweyou/harness/`. A database or cloud event store can
implement the same append/read contract later without changing semantic
commands.

Old `~/.deweyou/dev/` state is intentionally ignored. v2 never reads, migrates,
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

v2 reserves inexpensive seams for cloud and multi-agent execution:

- logical workspace identity separate from mounts
- repository abstraction and store-authoritative ordering
- Node Definition, Planned Node, and Node Execution separation
- structured executors with cancellation and idempotency
- digest-addressed Artifacts and Evidence
- globally unique identities and semantic commands

v2 intentionally does not implement a cloud coordinator, remote scheduler,
device or agent registry, lease and heartbeat protocol, object store,
cross-device sync, mailbox, P2P transport, multi-tenancy, cloud auth, vault, or
billing.

## Public MCP Surface

The MCP server exposes semantic operations rather than raw event mutation:

- `config_inspect`
- `run_create`, `run_get`, `commitment_revise`, `run_complete`
- `plan_propose`, `plan_activate`, `ready_nodes`
- `execution_start`, `execution_finish`
- `evidence_record`, `claim_update`
- `resource_feedback_record`
- `capabilities_list`, `capability_activate`
- `retrospective_get`, `proposal_decide`

The server does not launch subagents, choose product intent, or grant external
authority.
