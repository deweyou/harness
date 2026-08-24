import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConfig, RunStore, type CommandContext } from '../src/core/state/store.js';
import type { ResolvedHarnessConfig, Run } from '../src/core/types.js';

const config: ResolvedHarnessConfig = {
  version: 2,
  strategy: 'branch',
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
  const workspace = await mkdtemp(join(tmpdir(), 'harness-state-workspace-'));
  const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-root-'));
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
    input: { task: 'compile', options: { strict: true } },
    targetClaimIds: [claimId],
    authority: ['read-workspace'],
  }], context('plan'));
  await store.activatePlan(run.workspace.id, run.id, plan.revision, context('activate'));
}

describe('RunStore semantic commands', () => {
  it('does not complete from successful nodes without accepted Claims', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', context('start'));
    await store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [], context('finish'), { result: 'compiled' });

    await expect(store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete-early')))
      .rejects.toMatchObject({ code: 'ACCEPTANCE_INCOMPLETE' });
    expect((await store.getProjection(run.workspace.id, run.id)).status).toBe('running');
    expect((await store.getProjection(run.workspace.id, run.id)).nodeExecutions[0]).toMatchObject({
      input: { task: 'compile', options: { strict: true } },
      output: { result: 'compiled' },
    });
  });

  it('rejects oversized structured node data in favor of Evidence', async () => {
    const { store, run, claimId } = await setup();
    await expect(store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'large-input',
      definitionId: 'work',
      dependsOn: [],
      input: { content: 'x'.repeat(70_000) },
      targetClaimIds: [claimId],
    }], context('large-plan'))).rejects.toMatchObject({ code: 'STRUCTURED_PAYLOAD_TOO_LARGE' });

    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', context('large-output-start'));
    await expect(store.finishExecution(
      run.workspace.id,
      run.id,
      execution.executionId,
      'succeeded',
      [],
      context('large-output-finish'),
      { content: 'x'.repeat(70_000) },
    )).rejects.toMatchObject({ code: 'STRUCTURED_PAYLOAD_TOO_LARGE' });
  });

  it('snapshots JSON and Markdown Exports and rejects unsafe sources', async () => {
    const { store, run, claimId, workspace } = await setup();
    await mkdir(join(workspace, 'docs'));
    await writeFile(join(workspace, 'docs', 'spec.md'), '# Current spec\n');
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', context('export-start'));
    const projection = await store.finishExecution(
      run.workspace.id,
      run.id,
      execution.executionId,
      'succeeded',
      [],
      context('export-finish'),
      { result: 'compiled' },
      [
        { name: 'Implementation spec', mediaType: 'text/markdown', role: 'spec', sourcePath: 'docs/spec.md' },
        { name: 'Result data', mediaType: 'application/json', role: 'result', content: '{"ok":true}' },
      ],
    );
    const exports = projection.nodeExecutions[0]!.exports!;
    expect(exports).toEqual([
      expect.objectContaining({ name: 'Implementation spec', role: 'spec', sourceLocator: 'docs/spec.md', mediaType: 'text/markdown' }),
      expect.objectContaining({ name: 'Result data', role: 'result', mediaType: 'application/json' }),
    ]);
    await expect(store.finishExecution(
      run.workspace.id,
      run.id,
      execution.executionId,
      'succeeded',
      [],
      context('export-finish'),
      { result: 'compiled' },
      [
        { name: 'Implementation spec', mediaType: 'text/markdown', role: 'spec', sourcePath: 'docs/spec.md' },
        { name: 'Result data', mediaType: 'application/json', role: 'result', content: '{"ok":true}' },
      ],
    )).resolves.toMatchObject({ nodeExecutions: [expect.objectContaining({ id: execution.executionId })] });
    await expect(store.getExecutionExport(run.workspace.id, run.id, exports[0]!.id)).resolves.toMatchObject({ content: '# Current spec\n' });
    await expect(readFile(join(store.runDirectory(run.workspace.id, run.id), exports[0]!.locator), 'utf8')).resolves.toBe('# Current spec\n');
    await writeFile(join(store.runDirectory(run.workspace.id, run.id), exports[0]!.locator), '# Tampered\n');
    await expect(store.getExecutionExport(run.workspace.id, run.id, exports[0]!.id)).rejects.toMatchObject({ code: 'EXPORT_DIGEST_MISMATCH' });

    const second = await setup();
    await activatePlan(second.store, second.run, second.claimId);
    const unsafe = await second.store.startExecution(second.run.workspace.id, second.run.id, 'work-1', context('unsafe-export-start'));
    const outsideSource = join(second.stateRoot, 'outside.md');
    await writeFile(outsideSource, '# Outside\n');
    await symlink(outsideSource, join(second.workspace, 'outside-link.md'));
    await expect(second.store.finishExecution(
      second.run.workspace.id,
      second.run.id,
      unsafe.executionId,
      'succeeded',
      [],
      context('unsafe-export-finish'),
      undefined,
      [{ name: 'Outside', mediaType: 'text/markdown', sourcePath: 'outside-link.md' }],
    )).rejects.toMatchObject({ code: 'EXPORT_SOURCE_OUTSIDE_WORKSPACE' });
    await expect(second.store.finishExecution(
      second.run.workspace.id,
      second.run.id,
      unsafe.executionId,
      'succeeded',
      [],
      context('invalid-json-export'),
      undefined,
      [{ name: 'Invalid JSON', mediaType: 'application/json', content: '{' }],
    )).rejects.toThrow('must contain valid JSON');
    await expect(second.store.finishExecution(
      second.run.workspace.id,
      second.run.id,
      unsafe.executionId,
      'succeeded',
      [],
      context('oversized-export'),
      undefined,
      [{ name: 'Too large', mediaType: 'text/markdown', content: 'x'.repeat(1_024 * 1_024 + 1) }],
    )).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE' });
  });

  it('supports a minimal patch Plan without replaying unaffected executions', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const original = await store.startExecution(run.workspace.id, run.id, 'work-1', context('original-start'));
    await store.finishExecution(run.workspace.id, run.id, original.executionId, 'succeeded', [], context('original-finish'));

    const patchPlan = await store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'spacing-patch',
      definitionId: 'work',
      dependsOn: [],
      input: { target: 'button-spacing' },
      targetClaimIds: [claimId],
    }], context('patch-plan'));
    await store.activatePlan(run.workspace.id, run.id, patchPlan.revision, context('patch-activate'));

    const projection = await store.getProjection(run.workspace.id, run.id);
    expect(projection.activeCommitmentRevision).toBe(1);
    expect(projection.activePlanRevision).toBe(2);
    expect(projection.plans[1]?.status).toBe('superseded');
    expect(projection.nodeExecutions).toEqual([
      expect.objectContaining({ id: original.executionId, planRevision: 1, plannedNodeId: 'work-1', status: 'succeeded' }),
    ]);
    await expect(store.readyNodes(run.workspace.id, run.id)).resolves.toEqual([
      expect.objectContaining({ id: 'spacing-patch', input: { target: 'button-spacing' } }),
    ]);
  });

  it('records digest Evidence, satisfies the current Claim, and completes explicitly', async () => {
    const { store, run, claimId, stateRoot } = await setup();
    expect(await store.listRuns('active')).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        runId: run.id,
        title: 'Produce the requested result',
        activeCommitmentRevision: 1,
        acceptanceSatisfied: 0,
        acceptanceTotal: 1,
      }),
    ]);
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
    expect(await store.listRuns('active')).toEqual([]);
    expect(await store.listRuns('archived')).toEqual([
      expect.objectContaining({ runId: run.id, status: 'completed', acceptanceSatisfied: 1 }),
    ]);

    await writeFile(join(stateRoot, 'index', 'runs.json'), '{"schemaVersion":1,"runs":[]}\n');
    expect(await store.listRuns()).toEqual([
      expect.objectContaining({ runId: run.id, schemaVersion: 2, status: 'completed' }),
    ]);
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
    const report = await store.getRetrospectiveReport(run.workspace.id, run.id);
    expect(report).toContain('# Retrospective: Produce the requested result');
    expect(report).toContain('- accepted: review-skill');
    expect(await readFile(join(store.runDirectory(run.workspace.id, run.id), 'reports', 'retrospective.md'), 'utf8')).toBe(report);

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
