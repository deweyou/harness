# Plan And Execution

The controller owns Plan proposals and scheduling. Executors own bounded node
executions.

A Node Definition describes reusable capability and must not name another node.
A Planned Node binds a definition to Run-specific inputs, dependencies, output
contracts, Claims, and authority. A Node Execution is one immutable attempt.

Every assignment includes:

- Run, Commitment revision, Plan revision, planned node, and execution identity
- exact objective, inputs, dependency artifacts, and input digests
- activated capability receipts and full skill instructions where required
- allowed mutation and external-action boundaries
- expected structured output, Evidence, and Claim links
- cancellation signal, idempotency key, timeout, and retry policy

`execution_start` snapshots the Planned Node's structured input for that
attempt. Pass a concise, JSON-serializable result to `execution_finish` when the
attempt has useful machine-readable output. Input and output are each limited to
64 KiB. Put large payloads, raw command output, logs, and files in Evidence and
reference their identities from the attempt. Do not place secrets, credentials,
tokens, or unredacted environment data in either structured payload.

Retry only an evidence-backed technical failure. A retry creates a new
execution identity and preserves the previous attempt. Changes to objective,
scope, acceptance, or authority require a new Commitment and Plan revision.

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
