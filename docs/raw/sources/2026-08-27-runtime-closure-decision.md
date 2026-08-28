# Runtime closure decision

Captured: 2026-08-27

The user accepted the remaining runtime consistency recommendations together.

A Run cannot complete while a Node Execution is running. Completion freezes
Commitment, Plan, Claim, Evidence, resource activation, and execution mutation,
while retrospective generation, resource feedback, and proposal decisions stay
available.

Terminal attempts never automatically return from `ready_nodes`. A failed,
blocked, cancelled, or interrupted latest attempt can continue only through an
explicit `execution_retry` carrying a reason and Evidence owned by the preceding
attempt. Successful and skipped attempts cannot be retried.

Evidence binds to one Node Execution. Core derives the Commitment revision,
Plan revision, Planned Node ID, and canonical input digest. A later Plan that
changes the same Planned Node input makes old Evidence stale while preserving
unaffected proof. Satisfied Claims can be refreshed explicitly with new current
Evidence.

Semantic command idempotency compares canonical command input. Reusing a key
with the same input replays the original result; reusing it with different input
is an `IDEMPOTENCY_CONFLICT`, including commands whose event payload contains
generated identities.
