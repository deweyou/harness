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

Context Providers own source content, indexes, retrieval, and publication.
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

`harness.yaml` selects one workspace preparation strategy and declares
repository Context, reusable Skills, and Node Definitions:

```yaml
version: 3
strategy: worktree

context:
  project-context:
    source:
      entry: AGENTS.md

skills:
  review-skill:
    source:
      entry: .agents/skills/review

nodes:
  review:
    kind: agent
    description: Review one bounded result
    skill: [review-skill]
    inputs:
      change:
        type: object
        description: Change to review.
    outputs:
      review-result:
        type: object
        description: Structured review result.
    authority: [read-workspace]
```

Every source has a required `entry` and an optional `repo`. Without `repo`, the
entry resolves relative to its declaring configuration. With `repo`, Skill
entries are selected through `npx skills`, while Context entries are explicit
files in the repository's latest default-branch checkout. Harness records the
loaded content digest and, when Git exposes one, the resolved revision.

Run-scoped activation resolves definitions from `cache/config.snapshot.yaml`.
The first activation copies the full Skill directory or Context file into
`cache/resources/` and pins its digest and optional Git revision. Later
activations, including after server restart, verify and reuse that Run-local
copy. Activations without a Run scope continue to inspect current workspace
configuration and do not create a Run pin.

All configured Context is loaded at repository/Run scope. Node `skill` may
reference only IDs declared under `skills`; Skills are activated for the Node
that declares them. Context and Skill IDs must be unique across both maps.

Context entries always identify one explicit file. Harness does not infer a
`CONTEXT.md`, `README.md`, or other entrypoint from a context directory. Skill
entries may identify a Skill directory because `SKILL.md` is a standardized
entrypoint.

A Node has `kind: agent` or `kind: command` and a required non-empty
`description` explaining when to use it. The description is discovery and
display metadata only; it does not affect scheduling. Agent Nodes may declare
`skill`. Command Nodes declare one shell command string:

```yaml
nodes:
  test:
    kind: command
    description: Run the repository test suite
    command: pnpm test
```

The whole string is one execution with one result. Commands that need separate
status, retry, or dependency edges belong in separate Nodes; an atomic shell
pipeline may remain in one Command Node.

Harness does not spawn the process. The host executes the frozen command once,
with `workspace.path` from the ready assignment as its working directory and a
host-owned shell and environment. Configuration does not select a shell, cwd,
or environment. The host maps exit code `0` to `succeeded`, a non-zero exit to
`failed`, an intentional cancellation to `cancelled`, and an unexpected process
or session loss to `interrupted`. A command that cannot run yet may be reported
as `blocked`; work intentionally bypassed by the controller may be `skipped`.

Raw stdout, stderr, and useful process metadata such as shell and exit code are
stored as Evidence when they need to be retained. They are not copied into the
bounded structured output. If the Command Node declares output ports, the host
adapter submits a separate JSON-serializable result to `execution_finish` and
Core validates it exactly like Agent Node output. Harness never assumes stdout
is JSON and does not perform that conversion.

Node `inputs` and `outputs` are maps of named ports. Each port is an inline JSON
Schema with a required `description`; Node Definitions declare contracts but
never name another Node. Core validates planned input immediately before an
execution starts and validates every declared output when an execution reports
success. Failed, blocked, or interrupted attempts may keep incomplete
diagnostic output. Large values remain Evidence or Exports rather than port
payloads.

Planned Nodes do not redeclare expected output names. Runtime validation and
Dashboard presentation both derive them from the Run's frozen Node Definition,
so the output contract has one authoritative source.

Run creation stores the resolved configuration at
`cache/config.snapshot.yaml` inside the Run bundle. Despite the directory name,
this is Run-lifetime persistent execution data rather than disposable cache.
Plan proposal, execution boundaries, and Dashboard projection all read this
same snapshot. Later workspace configuration changes affect only new Runs.

Node `authority` declares the minimum semantic authorization required to use
that definition. A Planned Node inherits it without override, and Plan proposal
fails unless the active Commitment contains every required authority. Harness
records and validates this boundary; host permissions and tool approvals remain
the actual enforcement layer.

`strategy` is either `branch` or `worktree` and defaults to `branch`. It is
owned by the root configuration and cannot be set by imports. `harness-work`
does not prepare Git state for questions, other read-only work, or
configuration-only maintenance. After implementation intent is known and before
the first project mutation or mutation-bearing Run, `workspace_prepare` fetches
the resolved remote base and creates or rebases a task branch in the current
checkout or a separate worktree. It persists a Receipt under
`~/.deweyou/harness/preparations/`. Public `run_create` requires that Receipt
and verifies the configured strategy, canonical path, task branch, HEAD, fetched
base revision, and ancestry before creating durable Run state. A user-requested
base branch overrides the inferred remote default, but base selection and Git
mechanics are not additional configuration fields.

Node Definitions do not contain dependencies. A Planned Node binds a reusable
definition to Run-specific inputs, dependencies, target Claims, and inherited
authority. The Node ID is both its stable reference and
default display label; config does not duplicate it with a `name` field.
Planned Nodes may carry one optional display-only `phase`: `planning`,
`implementation`, `integration`, `verification`, or `delivery`. Phase never
adds dependencies, changes readiness, or creates Stage state; the DAG remains
authoritative.

Imports remain recursive and cycle-checked. `as` namespaces imported Context,
Skill, and Node IDs and rewrites Node Skill references. Local resource entries
resolve relative to the declaring configuration file. Import paths must also be
relative to their declaring configuration; absolute and machine-specific paths
are rejected.

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
Every open acceptance Claim must have at least one Planned Node path. An
initial Plan establishes that coverage with `targetClaimIds`; an incremental
Plan for the same Commitment may rely on coverage established by an earlier
Plan revision instead of restating unaffected paths. Target Claim IDs are
unique per node and must belong to the Plan's Commitment.

Revising a Plan does not imply replaying previous work. A controller may propose
a minimal executable delta containing only affected or newly required nodes;
unaffected executions and current Evidence remain available through Run history.
Coverage is traceability, not acceptance: a successful Node Execution never
changes Claim status. Evidence must still be recorded and the Claim updated
through an explicit semantic command.

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

Only a never-attempted node appears in `ready_nodes`. A failed, blocked,
cancelled, or interrupted latest attempt remains terminal until the controller
uses `execution_retry` with a non-empty reason and Evidence owned by that
attempt. The retry creates the next immutable attempt. A skipped or successful
attempt cannot be retried.

`execution_start` must echo the Commitment revision, Plan revision, and Planned
Node ID from the assignment envelope. Core rejects stale Commitment or Plan
revisions before allocating an execution identity, verifies the node is still
ready in that exact Plan, and records both revisions in the start event. Event
replay repeats the active-revision checks, closing the race between assignment
discovery and event commit. Reusing an idempotency key with a different
assignment is an explicit conflict.

`ready_nodes` returns ready execution assignments rather than bare Planned
Nodes. Its envelope identifies the Run, logical Workspace and execution path,
active Commitment revision, and active Plan revision. Each assignment combines
the compact Planned Node with its complete Node Definition resolved from the
Run's `cache/config.snapshot.yaml`, including the Agent Skills or Command
string, description, port contracts, and minimum authority. The definition is
an execution-time view and is not duplicated into the immutable Plan. Workspace
configuration edits cannot change an active Run's assignments.

### Evidence And Exports

Evidence proves Claims. Every Evidence item is bound to one Node Execution;
Core derives its Commitment revision, Plan revision, Planned Node ID, and input
digest from authoritative Run state. Callers cannot supply these bindings. A
later Plan that changes the input of the same Planned Node makes prior Evidence
stale, while Evidence for unaffected nodes remains reusable. A satisfied Claim
may be explicitly refreshed with new current Evidence.

Exports present durable Node results for people or tools. An Export records its
execution, Commitment revision, media type, digest, size, and immutable snapshot
locator. `role` is an optional domain-neutral hint such as `spec`, `report`, or
`result`; Core does not assign special lifecycle behavior to it. A bare local
path is never Export identity.

## Capability Runtime

Providers can expose skills, context, executors, host integrations,
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
active Plan views, and dashboards are rebuildable projections. Immutable Run
cache snapshots and digest-addressed blobs are supporting artifacts, not mutable
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
5. no Node Execution is still running; and
6. the requested destination is within the current authority.

Successful nodes alone never complete a Run. After completion, execution-domain
commands are frozen; retrospective generation, resource feedback, and proposal
decisions remain available.

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

- `config_inspect`, `workspace_prepare`
- `run_create`, `run_get`, `run_list`, `commitment_revise`, `run_complete`
- `plan_propose`, `plan_activate`, `ready_nodes`
- `execution_start`, `execution_retry`, `execution_finish`
- `evidence_record`, `claim_update`
- `resource_feedback_record`
- `capabilities_list`, `capability_activate`
- `retrospective_get`, `proposal_decide`

The server does not launch subagents, choose product intent, or grant external
authority.

_Last updated: 2026-08-27 — made retries explicit, Evidence bindings authoritative, and Run completion terminal._
