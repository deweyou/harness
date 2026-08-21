import { describe, expect, test } from 'vitest';
import { readyPlannedNodes, validatePlanGraph } from '../src/core/graph.js';
import { assertClaimDecision, assertCommitmentRevision, assertNodeExecution, assertPlanRevision, isCommitmentAccepted } from '../src/core/runtime.js';
import type { Claim, Commitment, Evidence, NodeExecution, Plan, Run } from '../src/core/types.js';

const run: Run = {
  schemaVersion: 2,
  id: 'run-1',
  workspace: { id: 'workspace' },
  workspacePath: '/workspace',
  createdAt: '2026-08-21T00:00:00.000Z',
  hostSessions: [],
};

const commitment: Commitment = {
  id: 'commitment-1',
  runId: run.id,
  revision: 1,
  objective: 'Ship the agreed outcome',
  scope: ['core'],
  authority: ['edit-core'],
  destination: 'local worktree',
  acceptanceClaimIds: ['claim-verified'],
  unresolvedDecisions: [],
  createdAt: '2026-08-21T00:00:01.000Z',
};

const plan: Plan = {
  schemaVersion: 2,
  id: 'plan-1',
  runId: run.id,
  revision: 1,
  commitmentRevision: commitment.revision,
  status: 'proposed',
  createdAt: '2026-08-21T00:00:02.000Z',
  nodes: [
    { id: 'implement', definitionId: 'agent-work', dependsOn: [], targetClaimIds: ['claim-verified'] },
    { id: 'verify', definitionId: 'agent-work', dependsOn: ['implement'], targetClaimIds: ['claim-verified'] },
  ],
};

describe('v2 Plan graph and runtime invariants', () => {
  test('keeps dependencies on run-scoped PlannedNodes and calculates readiness', () => {
    validatePlanGraph(plan);
    expect(readyPlannedNodes(plan, []).map((node) => node.id)).toEqual(['implement']);
    const execution: NodeExecution = {
      id: 'execution-1',
      runId: run.id,
      planRevision: 1,
      plannedNodeId: 'implement',
      attempt: 1,
      status: 'succeeded',
      evidenceIds: [],
    };
    expect(readyPlannedNodes(plan, [execution]).map((node) => node.id)).toEqual(['verify']);
  });

  test('rejects missing dependencies, duplicate dependencies, and cycles', () => {
    expect(() => validatePlanGraph({ ...plan, nodes: [{ id: 'a', definitionId: 'work', dependsOn: ['missing'] }] })).toThrow(/missing node/);
    expect(() => validatePlanGraph({ ...plan, nodes: [{ id: 'a', definitionId: 'work', dependsOn: ['b', 'b'] }, { id: 'b', definitionId: 'work', dependsOn: [] }] })).toThrow(/repeats dependency/);
    expect(() => validatePlanGraph({ ...plan, nodes: [{ id: 'a', definitionId: 'work', dependsOn: ['b'] }, { id: 'b', definitionId: 'work', dependsOn: ['a'] }] })).toThrow(/dependency cycle/);
  });

  test('requires contiguous Commitment and Plan revisions in the same Run', () => {
    expect(() => assertCommitmentRevision(run, commitment)).not.toThrow();
    const revisedCommitment: Commitment = {
      ...commitment,
      id: 'commitment-2',
      revision: 2,
      supersedesRevision: commitment.revision,
    };
    expect(() => assertCommitmentRevision(run, revisedCommitment, commitment)).not.toThrow();
    expect(() => assertCommitmentRevision(run, { ...revisedCommitment, revision: 3 }, commitment)).toThrow(/contiguous/);
    expect(() => assertPlanRevision(run, commitment, plan)).not.toThrow();
    expect(() => assertPlanRevision(run, commitment, { ...plan, id: 'plan-3', revision: 3 }, plan)).toThrow(/contiguous/);
  });

  test('keeps node attempts contiguous without imposing workflow loop policy', () => {
    const first: NodeExecution = {
      id: 'execution-1',
      runId: run.id,
      planRevision: 1,
      plannedNodeId: 'implement',
      attempt: 1,
      status: 'failed',
      evidenceIds: [],
    };
    const second = { ...first, id: 'execution-2', attempt: 2 };
    expect(() => assertNodeExecution(plan, first, [])).not.toThrow();
    expect(() => assertNodeExecution(plan, second, [first])).not.toThrow();
    expect(() => assertNodeExecution(plan, { ...second, attempt: 4 }, [first])).toThrow(/expected attempt 2/);
  });

  test('completes only from satisfied Claims for the current Commitment with fresh Evidence', () => {
    const proof: Evidence = {
      id: 'proof-1',
      runId: run.id,
      kind: 'test',
      summary: 'All assertions passed',
      createdAt: '2026-08-21T00:00:03.000Z',
      digest: 'sha256:proof',
      locator: 'evidence/proof-1.json',
      commitmentRevision: commitment.revision,
      inputDigests: { source: 'sha256:source' },
    };
    const satisfied: Claim = {
      id: 'claim-verified',
      runId: run.id,
      commitmentId: commitment.id,
      description: 'The outcome is verified',
      status: 'satisfied',
      evidenceIds: [proof.id],
      createdAt: '2026-08-21T00:00:04.000Z',
    };
    expect(() => assertClaimDecision(commitment, satisfied, { [proof.id]: proof })).not.toThrow();
    expect(isCommitmentAccepted(commitment, { [satisfied.id]: satisfied }, { [proof.id]: proof })).toBe(true);
    expect(isCommitmentAccepted(commitment, { [satisfied.id]: { ...satisfied, status: 'open' } }, { [proof.id]: proof })).toBe(false);
    expect(() => assertClaimDecision(commitment, { ...satisfied, evidenceIds: [] }, {})).toThrow(/requires Evidence/);
    const newerCommitment: Commitment = { ...commitment, id: 'commitment-2', revision: 2, supersedesRevision: commitment.revision };
    expect(isCommitmentAccepted(newerCommitment, { [satisfied.id]: satisfied }, { [proof.id]: proof })).toBe(false);
    expect(isCommitmentAccepted({ ...commitment, unresolvedDecisions: ['Choose destination'] }, { [satisfied.id]: satisfied }, { [proof.id]: proof })).toBe(false);
  });
});
