# Planned Node phases

- Date: 2026-08-26
- Source: product design conversation
- Status: accepted

Planned Nodes may optionally declare one coarse phase: `planning`,
`implementation`, `integration`, `verification`, or `delivery`. Phase belongs
to a Run-scoped Planned Node rather than its reusable Node Definition.

Phase is display and filtering metadata only. It never creates dependencies,
controls readiness, determines completion, or introduces Stage state. The Plan
DAG and Claims remain authoritative. The unused Node Definition `claimTypes`
field is removed rather than retaining a second classification system.
