import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConfig, RunStore, type CommandContext } from '../src/core/state/store.js';
import type { ResolvedHarnessConfig, Run } from '../src/core/types.js';

const config: ResolvedHarnessConfig = {
  version: 2,
  sourceFiles: [],
  resources: {},
  nodes: { work: { executor: { kind: 'agent' }, outputs: ['result'], claimTypes: ['acceptance'] } },
};

function context(key: string): CommandContext {
  return { traceId: 'trace', spanId: `span-${key}`, idempotencyKey: key };
}

function clock(): () => Date {
  let tick = 0;
  return () => new Date(Date.parse('2026-08-21T00:00:00.000Z') + tick++ * 1_000);
}

async function setup(): Promise<{ store: RunStore; run: Run; workspace: string; stateRoot: string; claimId: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'harness-v2-state-workspace-'));
  const stateRoot = await mkdtemp(join(tmpdir(), 'harness-v2-state-root-'));
  const store = new RunStore({ stateRoot, now: clock() });
  const run = await store.createRun({
    workspacePath: workspace,
    request: { prompt: 'work' },
    config,
    commitment: {
      objective: 'Produce the requested result',
      scope: ['workspace'],
      authority: ['read-workspace', 'deliver:user'],
      destination: 'user',
      acceptance: [{ description: 'The result is verified' }],
    },
  });
  const projection = await store.getProjection(run.workspace.id, run.id);
  return { store, run, workspace, stateRoot, claimId: projection.commitments[1]!.acceptanceClaimIds[0]! };
}

async function activatePlan(store: RunStore, run: Run, claimId: string): Promise<void> {
  const plan = await store.proposePlan(run.workspace.id, run.id, 1, [{
    id: 'work-1',
    definitionId: 'work',
    dependsOn: [],
    targetClaimIds: [claimId],
    authority: ['read-workspace'],
  }], context('plan'));
  await store.activatePlan(run.workspace.id, run.id, plan.revision, context('activate'));
}

describe('RunStore v2 semantic commands', () => {
  it('does not complete from successful nodes without accepted Claims', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', context('start'));
    await store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [], context('finish'));

    await expect(store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete-early')))
      .rejects.toMatchObject({ code: 'ACCEPTANCE_INCOMPLETE' });
    expect((await store.getProjection(run.workspace.id, run.id)).status).toBe('running');
  });

  it('records digest Evidence, satisfies the current Claim, and completes explicitly', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const evidence = await store.recordEvidence(run.workspace.id, run.id, {
      content: 'tests passed',
      kind: 'test',
      summary: 'Targeted tests passed',
      commitmentRevision: 1,
      inputDigests: { source: 'abc' },
    }, context('evidence'));
    expect(evidence.id).not.toBe(evidence.digest);
    expect(evidence.locator).toContain(evidence.digest);

    await store.updateClaim(run.workspace.id, run.id, claimId, 'satisfied', [evidence.id], context('claim'));
    const accepted = await store.getProjection(run.workspace.id, run.id);
    expect(accepted.commitmentAcceptanceSatisfied).toBe(true);
    expect(accepted.status).toBe('running');

    const completed = await store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete'));
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
    expect(completed.retrospective).toBeDefined();
  });

  it('replays semantic command idempotency and rejects conflicting event content', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const first = await store.startExecution(run.workspace.id, run.id, 'work-1', context('same-start'));
    const replay = await store.startExecution(run.workspace.id, run.id, 'work-1', context('same-start'));
    expect(replay).toEqual(first);

    await store.finishExecution(run.workspace.id, run.id, first.executionId, 'succeeded', [], context('same-finish'));
    await expect(store.finishExecution(run.workspace.id, run.id, first.executionId, 'failed', [], context('same-finish')))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('recovers running executions as interrupted without rewriting attempts', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', context('start-interrupted'));
    const recovered = await store.recoverInterrupted(run.workspace.id, run.id, 'recover-trace');
    expect(recovered.nodeExecutions.find((item) => item.id === execution.executionId)?.status).toBe('interrupted');
    expect(recovered.nodeExecutions.find((item) => item.id === execution.executionId)?.attempt).toBe(1);
  });

  it('supersedes the active Plan on Commitment revision and generates attributed proposals', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const evidence = await store.recordEvidence(run.workspace.id, run.id, {
      content: 'the skill omitted a required check',
      kind: 'review',
      summary: 'Review found a missing check',
      commitmentRevision: 1,
    }, context('feedback-evidence'));
    await store.recordResourceActivation(run.workspace.id, run.id, 'review-skill', 'digest-1', context('activate-resource'));
    await store.recordResourceFeedback(
      run.workspace.id,
      run.id,
      'review-skill',
      'missing-instruction',
      'The skill omitted a required check.',
      [evidence.id],
      context('feedback'),
    );
    await store.updateClaim(run.workspace.id, run.id, claimId, 'satisfied', [evidence.id], context('claim-feedback'));
    await store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete-feedback'));

    const retrospective = await store.getRetrospective(run.workspace.id, run.id);
    expect(retrospective.retrospective.observations).toHaveLength(1);
    expect(retrospective.proposals).toHaveLength(1);
    const proposalId = retrospective.proposals[0]!.id;
    const accepted = await store.decideProposal(run.workspace.id, run.id, proposalId, 'accepted', context('accept-proposal'), 'confirmed');
    expect(accepted.status).toBe('accepted');
    expect((await store.getRetrospective(run.workspace.id, run.id)).proposals[0]?.status).toBe('accepted');

    const second = await setup();
    await activatePlan(second.store, second.run, second.claimId);
    const revised = await second.store.reviseCommitment(second.run.workspace.id, second.run.id, {
      objective: 'Produce the revised result',
      scope: ['workspace'],
      authority: ['read-workspace', 'deliver:user'],
      destination: 'user',
      acceptance: [{ description: 'The revised result is verified' }],
    }, context('revise'));
    const projection = await second.store.getProjection(second.run.workspace.id, second.run.id);
    expect(revised.revision).toBe(2);
    expect(projection.activePlanRevision).toBeUndefined();
    expect(projection.plans[1]?.status).toBe('superseded');
    expect(projection.claims[second.claimId]?.status).toBe('invalidated');
  });

  it('detects event-chain tampering and finds config by walking upward', async () => {
    const { store, run, workspace } = await setup();
    const eventsPath = join(store.runDirectory(run.workspace.id, run.id), 'events.jsonl');
    const content = await readFile(eventsPath, 'utf8');
    await writeFile(eventsPath, content.replace('Produce the requested result', 'tampered'));
    await expect(store.readEvents(run.workspace.id, run.id)).rejects.toMatchObject({ code: 'INVALID_EVENT_HASH' });

    await writeFile(join(workspace, 'harness.yaml'), 'version: 2\n');
    const nested = join(workspace, 'a', 'b');
    await mkdir(nested, { recursive: true });
    expect(await findConfig(nested)).toBe(join(await realpath(workspace), 'harness.yaml'));
  });
});
