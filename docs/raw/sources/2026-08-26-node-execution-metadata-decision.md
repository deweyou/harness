# Node execution metadata simplification

- Date: 2026-08-26
- Status: accepted
- Scope: Config v3 Node Definitions

Node `artifactTypes` is removed because structured outputs, immutable Exports,
and Evidence already represent produced material with clearer ownership.
Node `executionPolicy` is removed because Harness Core does not perform agent or
command execution and therefore cannot truthfully enforce timeout, retry,
backoff, or idempotency policy.

Node `authority` remains as the minimum semantic authorization required by a
Node Definition. Planned Nodes inherit that requirement without override, and
Plan proposal succeeds only when the active Commitment contains every required
authority. Host permissions and tool approvals remain the actual enforcement
boundary.
