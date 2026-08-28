# Plan And Execution

The controller owns Plan proposals and scheduling. Executors own bounded node
executions.

A Node Definition describes reusable capability and must not name another node.
A Planned Node binds a definition to Run-specific inputs, dependencies, output
contracts, Claims, and authority. A Node Execution is one immutable attempt.
The optional Planned Node phase is display metadata only; never infer readiness
or completion from it.

Propose Plans only against the Run's `cache/config.snapshot.yaml`. Workspace
configuration edits made after Run creation apply to new Runs, not the active
Run. Validate planned input against that snapshot before Plan activation and
revalidate it when execution starts.

For a new Commitment, link Planned Nodes so every open acceptance Claim appears
in at least one node's `targetClaimIds`. An incremental Plan for the unchanged
Commitment may omit links already established by an earlier Plan revision.
Keep each node's links unique and limited to that Commitment's acceptance
Claims. These links explain intended coverage; they do not satisfy Claims.

Every assignment includes:

- Run, Commitment revision, Plan revision, planned node, and execution identity
- exact objective, inputs, dependency artifacts, and input digests
- activated capability receipts and full skill instructions where required
- allowed mutation and external-action boundaries
- expected structured output, Evidence, and Claim links
- expected JSON or Markdown Exports and their optional roles
- cancellation signal, idempotency key, and any host-owned timeout or retry boundary

Obtain the assignment from `ready_nodes`. Its Planned Node is Run-specific; its
Node Definition is resolved from `cache/config.snapshot.yaml` and carries the
exact Agent Skills or Command string, description, ports, and authority for
execution. The shared envelope provides Run ID, logical Workspace and execution
path, Commitment revision, and Plan revision. Pass that context through when
delegating and do not reconstruct it from the current workspace `harness.yaml`.

Echo the envelope's `commitmentRevision`, `planRevision`, and Planned Node ID in
`execution_start`. If Core reports a stale Commitment or Plan, do not retry the
old assignment: fetch ready assignments again. Use a new idempotency key for a
different assignment.

Activate Run resources with `runId`. Treat the first activation receipt as the
Run's pinned content identity; subsequent activation must return the same digest
from `cache/resources/`, including after a Harness server restart.

`execution_start` validates declared input ports against the Run's frozen Node
Definition and snapshots the structured input for that attempt. Pass a concise,
JSON-serializable result to `execution_finish` when the
attempt has useful machine-readable output. Input and output are each limited to
64 KiB. A successful attempt must provide every declared output port and each
value must satisfy its inline JSON Schema. Non-success terminal states may keep
incomplete diagnostic output. Put large payloads, raw command output, logs, and files in Evidence and
reference their identities from the attempt. Do not place secrets, credentials,
tokens, or unredacted environment data in either structured payload.

For a Command Node, the host executes the frozen command once with the
assignment's `workspace.path` as cwd. Shell selection, environment construction,
timeouts, cancellation, and process isolation remain host-owned and are not
configuration fields. Report exit `0` as `succeeded`, non-zero as `failed`, an
intentional cancellation as `cancelled`, and unexpected process or session loss
as `interrupted`. Preserve raw stdout/stderr and useful shell or exit metadata as
Evidence when needed. If outputs are declared, construct a separate bounded
object that satisfies those schemas; never parse stdout as JSON by default.

Use Exports for durable results that should be inspected directly by people or
tools. Inline small content or reference a source file inside the Run workspace;
Core snapshots it into the Run bundle. JSON must be valid and Markdown is
rendered as text-safe content in the Dashboard. Evidence remains the proof used
to decide Claims; an Export does not satisfy a Claim by itself.

Record Evidence against the current execution identity; Core derives its Plan,
Planned Node, Commitment revision, and input digest from authoritative state.
After a relevant Node succeeds, evaluate its linked Claims explicitly with
`claim_update`. Never infer satisfaction from execution status alone. If a
later Plan changes the same Planned Node input, refresh a previously satisfied
Claim with Evidence from the new successful execution.

Retry only an evidence-backed technical failure. A retry creates a new
execution identity and preserves the previous attempt. Use `execution_retry`
with the immediately preceding failed, blocked, cancelled, or interrupted
execution, a non-empty reason, and Evidence owned by that execution. Terminal
attempts never return from `ready_nodes`, and `skipped` or successful attempts
cannot be retried. Changes to objective, scope, acceptance, or authority require
a new Commitment and Plan revision.

## Incremental Iteration

When feedback or a small correction arrives during an active Run, compare it
with the current Commitment, Plan, executions, inputs, Evidence, and Claims.
Classify prior and proposed work before creating another Plan revision:

- `reuse`: unaffected completed work and still-current Evidence; preserve it in
  history and omit it from the executable delta
- `rerun`: work whose inputs or outputs are affected and must execute again
- `add`: new patch or focused verification work needed by the change

A new Plan revision is the current executable snapshot, not an instruction to
replay the entire delivery path. For an unchanged Commitment, propose only the
`rerun` and `add` nodes and keep their dependencies local to that delta. A small
UI correction, for example, should normally produce one patch node and one
focused verification node, not another design and full implementation pass.

Before activating the delta, let unaffected running Attempts finish when their
mutation boundaries do not overlap. Interrupt affected or overlapping Attempts
and preserve their partial output as Evidence when useful. Never run an old and
replacement mutation concurrently against the same target.

Re-evaluate only affected Claims. Reuse Evidence only when its Commitment
revision and relevant input digests remain current. Preserve superseded Plans,
all Attempts, and stale Evidence for review even when they no longer satisfy a
Claim. If objective, scope, acceptance, authority, destination, or a material
decision changes, revise the Commitment first and then propose the smallest
valid Plan for the new revision.

Cordis disposal cleans up in-process capability effects. It does not provide a
security boundary. Use an isolated subagent session or process/container when a
task needs stronger context, filesystem, credential, or tool isolation.
