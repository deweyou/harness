# Harness architecture

## Summary

Harness is not a Workflow engine. It lets an agent explore freely, then adds
durable control only when work needs a Commitment, acceptance Claims, a
task-scoped Plan, delegated execution, recovery, or delivery authority.

The current design decision is recorded in
[`docs/raw/sources/2026-08-21-harness-v2-decision.md`](../raw/sources/2026-08-21-harness-v2-decision.md).

## Model

```text
Run
 ├─ Commitment revision -> acceptance Claim IDs
 ├─ Claim -> Evidence digests
 ├─ Plan revision -> Planned Nodes + dependencies
 │                    └─ Node Definition from harness.yaml
 └─ Node Execution attempts
```

The important separations are:

- `harness.yaml` owns the branch/worktree strategy, reusable resources, and Node
  Definitions.
- Workspace preparation is lazy: it happens after implementation intent is
  known and before the first project mutation or mutation-bearing Run. It is
  not a Plan node; read-only questions and configuration-only maintenance never
  trigger it.
- A Commitment owns current intent, scope, authority, destination, acceptance,
  and unresolved decisions.
- A Plan owns the currently executable dependencies for one Run and Commitment
  revision. A later revision may be a minimal patch delta; it does not restart
  unaffected design, implementation, or verification work.
- A Node Execution owns one immutable attempt, including a bounded structured
  input snapshot and optional structured output.
- Evidence owns a digest identity, locator, Commitment revision, and input
  digests.

## Authority and state

Clients call semantic commands. They do not append arbitrary events or allocate
revision, attempt, identity, timestamp, or sequence fields.

`events.jsonl` is the authoritative hash chain. `state.json` is a rebuildable
projection. Config snapshots and digest-addressed Evidence are immutable
supporting artifacts. Resource activation is also recorded in the event chain,
so no mutable resource-lock side file can override replay.

Completed Runs also contain `reports/retrospective.md`. It is generated from the
retrospective and proposal projection for human review and Dashboard preview;
it is rebuildable and never replaces the event chain or JSON data.

A Run is only eligible for `run_complete` after the active Commitment has no
unresolved decision and every acceptance Claim is satisfied or validly waived
with current Evidence. Eligibility does not itself complete the Run; completion
is an explicit semantic command.

During incremental iteration, the controller classifies work as `reuse`,
`rerun`, or `add`. Only the latter two become nodes in the revised Plan.
Unchanged material boundaries keep the current Commitment; changes to objective,
scope, acceptance, authority, destination, or unresolved material decisions
create a new Commitment revision.

## Knowledge maintenance

Harness may attribute evidence-backed feedback to an activated Knowledge
resource and generate a post-completion proposal. It owns the Evidence,
proposal, decision, and validation lineage, not the knowledge content or index.
An accepted proposal becomes a separate maintenance task against the owning
repository or Knowledge Provider.

For repository-owned knowledge, `AGENTS.md` is a concise instruction and routing
layer while `docs/` contains maintained explanations and synthesis. Complex
repositories may repeat that pair at durable module boundaries. The root owns
cross-module knowledge; nested files record local differences without copying
root instructions.

The repository-specific convention is recorded in the
[knowledge maintenance decision](../raw/sources/2026-08-24-repository-knowledge-maintenance-decision.md).

## Capability Runtime

`CapabilityRuntime` is owned by this repository. The Cordis implementation
provides scoped provider registration, progressive activation, idempotency, and
lifecycle cleanup across global, workspace, Run, planned-node, and execution
scopes.

Cordis is intentionally outside Core authority. It cannot revise a Commitment,
activate a Plan, change a Claim, or complete a Run. Its isolation is in-process;
strong isolation uses host-native subagents, sessions, processes, containers,
filesystem sandboxes, or credential boundaries.

## Code map

| Concern | Location |
| --- | --- |
| Domain contracts | `src/core/types.ts` |
| Plan DAG and ready nodes | `src/core/graph.ts` |
| Commitment, Plan, Claim invariants | `src/core/runtime.ts` |
| Event replay projection | `src/core/state/projection.ts` |
| Retrospective Markdown projection | `src/core/retrospective-report.ts` |
| Repository boundary and semantic commands | `src/core/state/store.ts` |
| Cordis capability lifecycle | `src/core/capabilities.ts` |
| Workspace resource provider | `src/core/resources.ts` |
| Public semantic MCP tools | `src/mcp/server.ts` |
| Controller behavior | `skills/harness-work/SKILL.md` |
| Configuration lifecycle | `skills/harness-work/references/configuration.md` |
| Public contract | `docs/harness-core.md` |

## Future seams, not current features

The local implementation reserves logical workspace identity, a
`RunRepository` interface, digest-based artifact identity, structured executor
contracts, cancellation, idempotency, and global identifiers. These keep a
future cloud or cross-device executor from forcing a Core rewrite.

There is no current coordinator, remote scheduler, worker lease, agent/device
registry, object store, mailbox, P2P transport, cross-device synchronization,
multi-tenancy, cloud auth, vault, or billing implementation.

## Change checklist

When changing Core:

1. Keep Workflow and fixed Stage absent from executable contracts.
2. Keep Node Definition dependencies out of `harness.yaml`.
3. Add a semantic command instead of exposing raw event mutation.
4. Ensure the event projection rejects the same invalid transition.
5. Test stale revision, idempotency, replay, and completion invariants.
6. Update `docs/harness-core.md`, this Wiki, schemas, and `/harness-work` together.
