# Run-scoped ready assignment decision

Captured: 2026-08-26

The user confirmed that execution must not reconstruct a Node Definition from a
workspace configuration that may have changed after Run creation.

`ready_nodes` returns ready assignments. Each assignment contains the compact
Planned Node plus its complete Node Definition resolved from the Run's
`cache/config.snapshot.yaml`. The resolved view exposes the exact Agent Skills
or Command string, description, input/output contracts, and minimum authority.
It is not persisted as duplicate Plan data.

The response also carries one shared dispatch envelope: Run ID, logical
Workspace identity and execution path, active Commitment revision, and active
Plan revision. A controller can therefore delegate an assignment without
combining mutable or stale context from separate calls.
