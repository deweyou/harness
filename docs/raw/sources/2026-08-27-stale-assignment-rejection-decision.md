# Stale assignment rejection decision

Captured: 2026-08-27

The user confirmed that `execution_start` must be bound to the assignment
returned by `ready_nodes`.

The caller echoes the Commitment revision, Plan revision, and Planned Node ID.
Core verifies that both revisions remain active and that the node is ready in
that exact Plan before allocating an execution identity. The start event stores
both revisions, and authoritative event replay rejects a stale Plan or
Commitment if state changed during the command. Reusing an idempotency key for a
different assignment is rejected as a conflict.
