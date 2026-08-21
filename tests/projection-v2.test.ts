import { describe, expect, test } from 'vitest';
import { projectRun } from '../src/core/state/projection.js';
import type { Commitment, Evidence, HarnessEvent, HarnessEventType, Plan, Run } from '../src/core/types.js';

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
  objective: 'Deliver a verified core',
  scope: ['core'],
  authority: ['edit-core', 'deliver:local worktree'],
  destination: 'local worktree',
  acceptanceClaimIds: ['claim-1'],
  unresolvedDecisions: [],
  createdAt: '2026-08-21T00:00:01.000Z',
};

const plan: Plan = {
  schemaVersion: 2,
  id: 'plan-1',
  runId: run.id,
  revision: 1,
  commitmentRevision: 1,
  status: 'proposed',
  createdAt: '2026-08-21T00:00:02.000Z',
  nodes: [{ id: 'work', definitionId: 'agent-work', dependsOn: [], targetClaimIds: ['claim-1'] }],
};

const proof: Evidence = {
  id: 'proof-1',
  runId: run.id,
  kind: 'test',
  summary: 'Targeted tests passed',
  digest: 'sha256:proof',
  locator: 'evidence/proof-1.json',
  commitmentRevision: 1,
  inputDigests: { source: 'sha256:source' },
  createdAt: '2026-08-21T00:00:05.000Z',
};

function events(...entries: Array<{ type: HarnessEventType; payload: Record<string, unknown> }>): HarnessEvent[] {
  return entries.map((entry, index) => ({
    schemaVersion: 2,
    id: `event-${index + 1}`,
    runId: run.id,
    sequence: index + 1,
    timestamp: new Date(Date.parse(run.createdAt) + index * 1_000).toISOString(),
    previousHash: index === 0 ? null : `hash-${index}`,
    hash: `hash-${index + 1}`,
    traceId: 'trace',
    spanId: `span-${index + 1}`,
    type: entry.type,
    payload: entry.payload,
  }));
}

describe('v2 Run projection', () => {
  test('accepts explicit completion for the active Plan and accepted Commitment', () => {
    const projection = projectRun(events(
      { type: 'run.created', payload: { run } },
      { type: 'commitment.revised', payload: { commitment } },
      { type: 'plan.proposed', payload: { plan } },
      { type: 'plan.activated', payload: { planRevision: 1 } },
      { type: 'claim.opened', payload: { claim: { id: 'claim-1', runId: run.id, commitmentId: commitment.id, description: 'Core is verified', status: 'open', evidenceIds: [], createdAt: '2026-08-21T00:00:04.000Z' } } },
      { type: 'node.started', payload: { executionId: 'execution-1', planRevision: 1, plannedNodeId: 'work', attempt: 1 } },
      { type: 'evidence.recorded', payload: { evidence: proof } },
      { type: 'node.succeeded', payload: { executionId: 'execution-1', evidenceIds: [proof.id] } },
      { type: 'claim.satisfied', payload: { claimId: 'claim-1', evidenceIds: [proof.id] } },
      { type: 'run.completed', payload: { commitmentRevision: 1, planRevision: 1, destination: 'local worktree' } },
    ));

    expect(projection).toMatchObject({
      status: 'completed',
      commitmentAcceptanceSatisfied: true,
      activeCommitmentRevision: 1,
      activePlanRevision: 1,
      nodeStatuses: { '1:work': 'succeeded' },
      timing: { executionTimeMs: 2_000, criticalPathMs: 2_000 },
    });
    expect(projection.plans[1]?.status).toBe('active');
    expect(projection.claims['claim-1']?.status).toBe('satisfied');
  });

  test('a revised Commitment invalidates prior completion and deactivates its Plan', () => {
    const revisionTwo: Commitment = {
      ...commitment,
      id: 'commitment-2',
      revision: 2,
      supersedesRevision: 1,
      acceptanceClaimIds: ['claim-2'],
      createdAt: '2026-08-21T00:00:10.000Z',
    };
    const projection = projectRun(events(
      { type: 'run.created', payload: { run } },
      { type: 'commitment.revised', payload: { commitment } },
      { type: 'plan.proposed', payload: { plan } },
      { type: 'plan.activated', payload: { planRevision: 1 } },
      { type: 'commitment.revised', payload: { commitment: revisionTwo, supersededPlanRevision: 1 } },
    ));
    expect(projection.status).toBe('running');
    expect(projection.activeCommitmentRevision).toBe(2);
    expect(projection.activePlanRevision).toBeUndefined();
  });

  test('fails closed when a satisfied Claim cites stale Evidence', () => {
    const staleProof = { ...proof, commitmentRevision: 2 };
    expect(() => projectRun(events(
      { type: 'run.created', payload: { run } },
      { type: 'commitment.revised', payload: { commitment } },
      { type: 'evidence.recorded', payload: { evidence: staleProof } },
      { type: 'claim.opened', payload: { claim: { id: 'claim-1', runId: run.id, commitmentId: commitment.id, description: 'Core is verified', status: 'open', evidenceIds: [], createdAt: '2026-08-21T00:00:04.000Z' } } },
      { type: 'claim.satisfied', payload: { claimId: 'claim-1', evidenceIds: [proof.id] } },
    ))).toThrow(/targets Commitment revision 2/);
  });
});
