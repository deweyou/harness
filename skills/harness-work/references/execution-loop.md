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

Retry only an evidence-backed technical failure. A retry creates a new
execution identity and preserves the previous attempt. Changes to objective,
scope, acceptance, or authority require a new Commitment and Plan revision.

Cordis disposal cleans up in-process capability effects. It does not provide a
security boundary. Use an isolated subagent session or process/container when a
task needs stronger context, filesystem, credential, or tool isolation.
