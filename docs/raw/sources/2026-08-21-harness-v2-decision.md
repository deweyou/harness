# Harness v2 decision

- Confirmed at: 2026-08-21 (Asia/Shanghai)
- Authority: repository owner in the implementation task
- Scope: Deweyou Harness v2

The repository owner approved a clean v2 redesign with these constraints:

1. Remove Workflow and fixed Stage as public and internal orchestration concepts. There is no v1 compatibility or migration requirement because v1 was not put into use.
2. Keep `harness.yaml` domain-neutral and limited to reusable resources and node definitions. A task-scoped Plan is proposed dynamically after a Run has a durable Commitment.
3. Model acceptance as Claims backed by content-addressed Evidence. Completing every planned node is not sufficient; the current Commitment's acceptance claims decide whether a Run may complete.
4. Separate Node Definition, Planned Node, and Node Execution. Dependencies belong to a Plan instance, not a reusable node definition.
5. Replace the public arbitrary event append surface with semantic commands. Core owns identifiers, revisions, attempts, timestamps, ordering, and transition validation.
6. Introduce a project-owned Capability Runtime boundary for dynamic resource/skill loading and execution isolation. Cordis may implement that boundary, but it must not own Run, Commitment, Claim, Plan, Evidence, or authority decisions.
7. Reserve low-cost seams for future cloud and multi-agent execution: repository abstraction, logical workspace references, digest-based artifact identity, structured executors with cancellation and idempotency, and globally unique identities. Do not add a cloud coordinator, remote scheduler, device registry, lease protocol, object store, or multi-tenant control plane in v2.
