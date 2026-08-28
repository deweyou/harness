# Raw source registry

This registry contains the immutable sources used by the repository Wiki.

| Source | Type | Captured at | Scope |
| --- | --- | --- | --- |
| [Harness v2 decision](sources/2026-08-21-harness-v2-decision.md) | User-confirmed design decision | 2026-08-21 | v2 Core, configuration, capability runtime, and future extension seams |
| [Repository knowledge maintenance decision](sources/2026-08-24-repository-knowledge-maintenance-decision.md) | User-confirmed design decision | 2026-08-24 | Root and module knowledge scope, maintenance authorization, and provider boundary |
| [Current knowledge publication decision](sources/2026-08-24-current-knowledge-publication-decision.md) | User-confirmed policy refinement | 2026-08-24 | Inline maintenance timing, current-state publication, and separation from Spec history |
| [Problem framing, Spec, Export, and knowledge initialization decision](sources/2026-08-24-framing-spec-export-decision.md) | User-confirmed design decision | 2026-08-24 | Lightweight framing, Spec lifecycle, generic Node Exports, Dashboard viewers, and knowledge initialization |
| [Workspace preparation Receipt decision](sources/2026-08-25-workspace-preparation-receipt-decision.md) | User-confirmed design decision | 2026-08-25 | Framework-enforced branch/worktree preparation and mandatory Receipt validation before Run creation |
| [Relative-only Harness imports](sources/2026-08-25-relative-import-path-decision.md) | User-confirmed design decision | 2026-08-25 | Portable repository configuration and relative import resolution |
| [Unified context resource decision](sources/2026-08-25-context-resource-decision.md) | User-confirmed design decision | 2026-08-25 | Config v3 resource kinds and removal of resource descriptions |
| [Explicit Context file decision](sources/2026-08-25-explicit-context-file-decision.md) | User-confirmed design decision | 2026-08-25 | Context sources identify files without directory entrypoint inference |
| [Unified resource source decision](sources/2026-08-25-unified-resource-source-decision.md) | User-confirmed design decision | 2026-08-25 | Optional repo plus entry source contract and kind-selected materialization |
| [Node identity decision](sources/2026-08-25-node-identity-decision.md) | User-confirmed design decision | 2026-08-25 | Node ID replaces duplicate configured display name |
| [Context and Skill collection decision](sources/2026-08-25-context-skill-collection-decision.md) | User-confirmed design decision | 2026-08-25 | Repository-scoped Context, Node-scoped Skill references, and removal of configured resource kind |
| [Flat Node kind decision](sources/2026-08-25-flat-node-kind-decision.md) | User-confirmed design decision | 2026-08-25 | Agent and command Node kinds, string shell commands, and removal of the executor wrapper |
| [Inline Node port schema decision](sources/2026-08-26-inline-node-port-schema-decision.md) | User-confirmed design decision | 2026-08-26 | Decoupled input/output contracts using inline JSON Schema and runtime boundary validation |
| [Planned Node phase decision](sources/2026-08-26-planned-node-phase-decision.md) | User-confirmed design decision | 2026-08-26 | Optional five-value Plan classification, display-only semantics, and removal of claimTypes |
| [Node execution metadata simplification](sources/2026-08-26-node-execution-metadata-decision.md) | User-confirmed design decision | 2026-08-26 | Removal of unused artifact and execution policy fields plus non-overridable authority requirements |
| [Single-source Node outputs](sources/2026-08-26-single-source-node-outputs-decision.md) | User-confirmed design decision | 2026-08-26 | Removal of duplicate Planned Node expectedOutputs and derivation from frozen definitions |
| [Run configuration cache](sources/2026-08-26-run-config-cache-decision.md) | User-confirmed design decision | 2026-08-26 | Persistent cached config snapshot shared by Plan, execution, and Dashboard |
| [Run resource pinning](sources/2026-08-26-run-resource-pinning-decision.md) | User-confirmed design decision | 2026-08-26 | Lazy Run-local Context and Skill content pinning across service restarts |
| [Plan Claim coverage](sources/2026-08-26-plan-claim-coverage-decision.md) | User-confirmed design decision | 2026-08-26 | Acceptance Claim coverage, incremental Plan reuse, Dashboard traceability, and explicit Claim evaluation |
| [Required Node description](sources/2026-08-26-required-node-description-decision.md) | User-confirmed design decision | 2026-08-26 | Required Node discovery metadata and Dashboard presentation without scheduling semantics |
| [Run-scoped ready assignments](sources/2026-08-26-run-scoped-ready-assignment-decision.md) | User-confirmed design decision | 2026-08-26 | Execution assignments resolved from frozen Run Node Definitions |
| [Stale assignment rejection](sources/2026-08-27-stale-assignment-rejection-decision.md) | User-confirmed design decision | 2026-08-27 | Revision-bound execution start and authoritative stale-assignment rejection |
| [Host-owned Command execution](sources/2026-08-27-host-owned-command-execution-decision.md) | User-confirmed design decision | 2026-08-27 | Command cwd, process-status mapping, Evidence logs, and structured output boundary |
| [Runtime closure decision](sources/2026-08-27-runtime-closure-decision.md) | User-confirmed design decision | 2026-08-27 | Run terminal boundary, explicit retry, authoritative Evidence freshness, and semantic idempotency |
