# Plan Claim coverage decision

Captured: 2026-08-26

The user confirmed that `targetClaimIds` should become a visible, enforced
traceability relationship rather than passive stored metadata.

- Each open acceptance Claim in a new Commitment must have at least one Planned
  Node path.
- `targetClaimIds` remains optional on an individual node, must be unique there,
  and may only reference acceptance Claims of the Plan's Commitment.
- An incremental Plan for the same Commitment may rely on Claim coverage already
  established by an earlier Plan revision, so a small patch does not need to
  restate unaffected work.
- Dashboard Node Details resolve target IDs into Claim description, current
  status, and Evidence count.
- Node success never satisfies a Claim automatically. Evidence recording and an
  explicit Claim update remain separate semantic actions.
