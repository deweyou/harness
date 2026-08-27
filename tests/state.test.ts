import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConfig, RUN_CONFIG_SNAPSHOT_PATH, RunStore, type CommandContext } from '../src/core/state/store.js';
import type { ResolvedHarnessConfig, Run } from '../src/core/types.js';

const config: ResolvedHarnessConfig = {
  version: 3,
  strategy: 'branch',
  sourceFiles: [],
  context: {},
  skills: {},
  nodes: {
    work: {
      kind: 'agent',
      description: 'Perform the requested work.',
      outputs: { result: { type: 'string', description: 'Compiled result.' } },
    },
  },
};

function context(key: string): CommandContext {
  return { traceId: 'trace', spanId: `span-${key}`, idempotencyKey: key };
}

function clock(): () => Date {
  let tick = 0;
  return () => new Date(Date.parse('2026-08-21T00:00:00.000Z') + tick++ * 1_000);
}

async function setup(runConfig = config): Promise<{ store: RunStore; run: Run; workspace: string; stateRoot: string; claimId: string }> {
  const workspace = await mkdtemp(join(tmpdir(), 'harness-state-workspace-'));
  const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-root-'));
  const store = new RunStore({ stateRoot, now: clock() });
  const run = await store.createRun({
    workspacePath: workspace,
    request: { prompt: 'work' },
    config: runConfig,
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
  it('validates declared input and successful output ports against the Run snapshot', async () => {
    const portConfig: ResolvedHarnessConfig = {
      ...config,
      nodes: {
        work: {
          kind: 'agent',
          description: 'Perform work with typed ports.',
          inputs: {
            environment: {
              type: 'object',
              description: 'Backend environment.',
              required: ['baseUrl'],
              properties: { baseUrl: { type: 'string' } },
            },
          },
          outputs: { result: { type: 'string', description: 'Compiled result.' } },
        },
      },
    };
    const { store, run, claimId } = await setup(portConfig);
    await expect(readFile(join(store.runDirectory(run.workspace.id, run.id), RUN_CONFIG_SNAPSHOT_PATH), 'utf8'))
      .resolves.toContain('version: 3');
    await expect(readFile(join(store.runDirectory(run.workspace.id, run.id), 'config.snapshot.yaml'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const invalidPlan = await store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'invalid',
      definitionId: 'work',
      dependsOn: [],
      input: { environment: {} },
      targetClaimIds: [claimId],
    }], context('invalid-port-plan'));
    await store.activatePlan(run.workspace.id, run.id, invalidPlan.revision, context('invalid-port-activate'));
    await expect(store.startExecution(run.workspace.id, run.id, 'invalid', 1, invalidPlan.revision, context('invalid-port-start')))
      .rejects.toMatchObject({ code: 'PORT_VALUE_MISMATCH' });

    const validPlan = await store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'valid',
      definitionId: 'work',
      dependsOn: [],
      input: { environment: { baseUrl: 'http://localhost:7777' } },
      targetClaimIds: [claimId],
    }], context('valid-port-plan'));
    await store.activatePlan(run.workspace.id, run.id, validPlan.revision, context('valid-port-activate'));
    const execution = await store.startExecution(run.workspace.id, run.id, 'valid', 1, validPlan.revision, context('valid-port-start'));
    await expect(store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [], context('missing-port-output')))
      .rejects.toMatchObject({ code: 'MISSING_PORT_VALUE' });
    await expect(store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [], context('invalid-port-output'), { result: 42 }))
      .rejects.toMatchObject({ code: 'PORT_VALUE_MISMATCH' });
    await expect(store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [], context('valid-port-output'), { result: 'compiled' }))
      .resolves.toMatchObject({ nodeExecutions: [expect.objectContaining({ status: 'succeeded' })] });
  });

  it('does not complete from successful nodes without accepted Claims', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('start'));
    await store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [], context('finish'), { result: 'compiled' });

    await expect(store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete-early')))
      .rejects.toMatchObject({ code: 'ACCEPTANCE_INCOMPLETE' });
    expect((await store.getProjection(run.workspace.id, run.id)).status).toBe('running');
    expect((await store.getProjection(run.workspace.id, run.id)).nodeExecutions[0]).toMatchObject({
      input: { task: 'compile', options: { strict: true } },
      output: { result: 'compiled' },
    });
  });

  it('rejects stale assignment revisions before starting an execution', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    await expect(store.startExecution(run.workspace.id, run.id, 'work-1', 2, 1, context('stale-commitment-start')))
      .rejects.toMatchObject({ code: 'STALE_COMMITMENT_REVISION' });

    const replacement = await store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'work-1', definitionId: 'work', dependsOn: [], targetClaimIds: [claimId],
    }], context('replacement-plan'));
    await store.activatePlan(run.workspace.id, run.id, replacement.revision, context('replacement-activate'));
    await expect(store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('stale-plan-start')))
      .rejects.toMatchObject({ code: 'STALE_PLAN_REVISION' });
    await expect(store.startExecution(run.workspace.id, run.id, 'work-1', 1, replacement.revision, context('current-assignment-start')))
      .resolves.toMatchObject({ attempt: 1 });
  });

  it('requires open acceptance Claims to have a Plan path and preserves coverage across incremental Plans', async () => {
    const { store, run, claimId } = await setup();
    const uncoveredNode = { id: 'uncovered', definitionId: 'work', dependsOn: [] };
    await expect(store.proposePlan(run.workspace.id, run.id, 1, [uncoveredNode], context('uncovered-plan')))
      .rejects.toMatchObject({ code: 'UNCOVERED_ACCEPTANCE_CLAIM' });
    await expect(store.proposePlan(run.workspace.id, run.id, 1, [{ ...uncoveredNode, targetClaimIds: ['not-an-acceptance-claim'] }], context('unrequired-claim')))
      .rejects.toMatchObject({ code: 'UNREQUIRED_CLAIM' });
    await expect(store.proposePlan(run.workspace.id, run.id, 1, [{ ...uncoveredNode, targetClaimIds: [claimId, claimId] }], context('duplicate-claim')))
      .rejects.toMatchObject({ code: 'DUPLICATE_TARGET_CLAIM' });

    const initialPlan = await store.proposePlan(run.workspace.id, run.id, 1, [{ ...uncoveredNode, targetClaimIds: [claimId] }], context('covered-plan'));
    expect(initialPlan.revision).toBe(1);
    const incrementalPlan = await store.proposePlan(run.workspace.id, run.id, 1, [{ id: 'small-fix', definitionId: 'work', dependsOn: [] }], context('incremental-plan'));
    expect(incrementalPlan).toMatchObject({ revision: 2, nodes: [{ id: 'small-fix' }] });
  });

  it('resolves ready Command assignments from the frozen Run configuration', async () => {
    const commandConfig: ResolvedHarnessConfig = {
      ...config,
      nodes: {
        check: {
          kind: 'command',
          description: 'Run the frozen verification command.',
          command: 'pnpm test',
          outputs: { result: { type: 'object', description: 'Test result.' } },
        },
      },
    };
    const { store, run, claimId } = await setup(commandConfig);
    const plan = await store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'check-tests', definitionId: 'check', dependsOn: [], targetClaimIds: [claimId],
    }], context('command-assignment-plan'));
    await store.activatePlan(run.workspace.id, run.id, plan.revision, context('command-assignment-activate'));

    await expect(store.readyNodeAssignments(run.workspace.id, run.id)).resolves.toEqual({
      runId: run.id,
      workspace: { ...run.workspace, path: expect.any(String) },
      commitmentRevision: 1,
      planRevision: plan.revision,
      assignments: [{
        plannedNode: expect.objectContaining({ id: 'check-tests', definitionId: 'check' }),
        definition: {
          kind: 'command',
          description: 'Run the frozen verification command.',
          command: 'pnpm test',
          outputs: { result: { type: 'object', description: 'Test result.' } },
        },
      }],
    });
    const execution = await store.startExecution(
      run.workspace.id,
      run.id,
      'check-tests',
      1,
      plan.revision,
      context('command-assignment-start'),
    );
    await expect(store.finishExecution(
      run.workspace.id,
      run.id,
      execution.executionId,
      'succeeded',
      [],
      context('command-missing-structured-output'),
    )).rejects.toMatchObject({ code: 'MISSING_PORT_VALUE' });
    const commandLog = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: execution.executionId,
      kind: 'command-log',
      summary: 'pnpm test exited with code 0',
      content: 'stdout and stderr snapshot',
    }, context('command-log-evidence'));
    await expect(store.finishExecution(
      run.workspace.id,
      run.id,
      execution.executionId,
      'succeeded',
      [commandLog.id],
      context('command-valid-structured-output'),
      { result: { passed: true } },
    )).resolves.toMatchObject({
      nodeExecutions: [expect.objectContaining({
        id: execution.executionId,
        status: 'succeeded',
        evidenceIds: [commandLog.id],
        output: { result: { passed: true } },
      })],
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
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('large-output-start'));
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
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('export-start'));
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
    const unsafe = await second.store.startExecution(second.run.workspace.id, second.run.id, 'work-1', 1, 1, context('unsafe-export-start'));
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
      { result: 'compiled' },
      [{ name: 'Outside', mediaType: 'text/markdown', sourcePath: 'outside-link.md' }],
    )).rejects.toMatchObject({ code: 'EXPORT_SOURCE_OUTSIDE_WORKSPACE' });
    await expect(second.store.finishExecution(
      second.run.workspace.id,
      second.run.id,
      unsafe.executionId,
      'succeeded',
      [],
      context('invalid-json-export'),
      { result: 'compiled' },
      [{ name: 'Invalid JSON', mediaType: 'application/json', content: '{' }],
    )).rejects.toThrow('must contain valid JSON');
    await expect(second.store.finishExecution(
      second.run.workspace.id,
      second.run.id,
      unsafe.executionId,
      'succeeded',
      [],
      context('oversized-export'),
      { result: 'compiled' },
      [{ name: 'Too large', mediaType: 'text/markdown', content: 'x'.repeat(1_024 * 1_024 + 1) }],
    )).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE' });
  });

  it('supports a minimal patch Plan without replaying unaffected executions', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const original = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('original-start'));
    await store.finishExecution(run.workspace.id, run.id, original.executionId, 'succeeded', [], context('original-finish'), { result: 'compiled' });

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
    await expect(store.readyNodeAssignments(run.workspace.id, run.id)).resolves.toEqual({
      runId: run.id,
      workspace: { ...run.workspace, path: expect.any(String) },
      commitmentRevision: 1,
      planRevision: patchPlan.revision,
      assignments: [{
        plannedNode: expect.objectContaining({ id: 'spacing-patch', definitionId: 'work' }),
        definition: expect.objectContaining({
          kind: 'agent',
          description: 'Perform the requested work.',
          outputs: { result: { type: 'string', description: 'Compiled result.' } },
        }),
      }],
    });
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
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('evidence-start'));
    const evidence = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: execution.executionId,
      content: 'tests passed',
      kind: 'test',
      summary: 'Targeted tests passed',
    }, context('evidence'));
    expect(evidence.id).not.toBe(evidence.digest);
    expect(evidence.locator).toContain(evidence.digest);
    await store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [evidence.id], context('evidence-finish'), { result: 'compiled' });

    await store.updateClaim(run.workspace.id, run.id, claimId, 'satisfied', [evidence.id], context('claim'));
    const accepted = await store.getProjection(run.workspace.id, run.id);
    expect(accepted.commitmentAcceptanceSatisfied).toBe(true);
    expect(accepted.status).toBe('running');

    const completed = await store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete'));
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
    expect(completed.retrospective).toBeDefined();
    await expect(store.completeRun(run.workspace.id, run.id, 1, 1, 'user', context('complete')))
      .resolves.toMatchObject({ status: 'completed' });
    await expect(store.completeRun(run.workspace.id, run.id, 1, 1, 'other', context('complete')))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
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
    const first = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('same-start'));
    const replay = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('same-start'));
    expect(replay).toEqual(first);
    await expect(store.startExecution(run.workspace.id, run.id, 'different-node', 1, 1, context('same-start')))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    await store.finishExecution(run.workspace.id, run.id, first.executionId, 'succeeded', [], context('same-finish'), { result: 'compiled' });
    await expect(store.finishExecution(run.workspace.id, run.id, first.executionId, 'failed', [], context('same-finish')))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires an explicit evidence-backed retry and never automatically requeues terminal attempts', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const first = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('retry-first-start'));
    const diagnostic = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: first.executionId,
      content: 'transient executor failure',
      kind: 'diagnostic',
      summary: 'The executor lost its connection',
    }, context('retry-diagnostic'));
    await store.finishExecution(run.workspace.id, run.id, first.executionId, 'failed', [diagnostic.id], context('retry-first-finish'));

    await expect(store.readyNodes(run.workspace.id, run.id)).resolves.toEqual([]);
    await expect(store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('implicit-retry')))
      .rejects.toMatchObject({ code: 'NODE_NOT_READY' });
    await expect(store.retryExecution(run.workspace.id, run.id, first.executionId, 1, 1, 'Try again', [], context('retry-without-evidence')))
      .rejects.toMatchObject({ code: 'RETRY_EVIDENCE_REQUIRED' });

    const retry = await store.retryExecution(
      run.workspace.id,
      run.id,
      first.executionId,
      1,
      1,
      'The transient connection failure is understood',
      [diagnostic.id],
      context('explicit-retry'),
    );
    expect(retry).toMatchObject({ attempt: 2, executionId: expect.any(String) });
    await expect(store.retryExecution(
      run.workspace.id,
      run.id,
      first.executionId,
      1,
      1,
      'The transient connection failure is understood',
      [diagnostic.id],
      context('explicit-retry'),
    )).resolves.toEqual(retry);
    await expect(store.retryExecution(
      run.workspace.id,
      run.id,
      first.executionId,
      1,
      1,
      'Different reason',
      [diagnostic.id],
      context('explicit-retry'),
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await store.getProjection(run.workspace.id, run.id)).nodeExecutions[1]).toMatchObject({
      id: retry.executionId,
      attempt: 2,
      retryOfExecutionId: first.executionId,
      retryReason: 'The transient connection failure is understood',
      retryEvidenceIds: [diagnostic.id],
    });

    const second = await setup();
    await activatePlan(second.store, second.run, second.claimId);
    const skipped = await second.store.startExecution(second.run.workspace.id, second.run.id, 'work-1', 1, 1, context('skip-start'));
    const skipEvidence = await second.store.recordEvidence(second.run.workspace.id, second.run.id, {
      executionId: skipped.executionId,
      content: 'not applicable',
      kind: 'decision',
      summary: 'The node was intentionally skipped',
    }, context('skip-evidence'));
    await second.store.finishExecution(second.run.workspace.id, second.run.id, skipped.executionId, 'skipped', [skipEvidence.id], context('skip-finish'));
    await expect(second.store.retryExecution(second.run.workspace.id, second.run.id, skipped.executionId, 1, 1, 'Retry skipped work', [skipEvidence.id], context('retry-skipped')))
      .rejects.toMatchObject({ code: 'EXECUTION_NOT_RETRYABLE' });
  });

  it('rejects active execution completion and freezes operational commands after completion', async () => {
    const { store, run, claimId } = await setup();
    const plan = await store.proposePlan(run.workspace.id, run.id, 1, [
      { id: 'verified', definitionId: 'work', dependsOn: [], targetClaimIds: [claimId] },
      { id: 'background', definitionId: 'work', dependsOn: [] },
    ], context('completion-plan'));
    await store.activatePlan(run.workspace.id, run.id, plan.revision, context('completion-activate'));
    const verified = await store.startExecution(run.workspace.id, run.id, 'verified', 1, plan.revision, context('verified-start'));
    const proof = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: verified.executionId,
      content: 'verification passed',
      kind: 'test',
      summary: 'Verification passed',
    }, context('verified-evidence'));
    await store.finishExecution(run.workspace.id, run.id, verified.executionId, 'succeeded', [proof.id], context('verified-finish'), { result: 'compiled' });
    await store.updateClaim(run.workspace.id, run.id, claimId, 'satisfied', [proof.id], context('verified-claim'));
    const background = await store.startExecution(run.workspace.id, run.id, 'background', 1, plan.revision, context('background-start'));

    await expect(store.completeRun(run.workspace.id, run.id, 1, plan.revision, 'user', context('complete-running')))
      .rejects.toMatchObject({ code: 'RUN_HAS_ACTIVE_EXECUTIONS' });
    await store.finishExecution(run.workspace.id, run.id, background.executionId, 'skipped', [], context('background-skip'));
    await store.completeRun(run.workspace.id, run.id, 1, plan.revision, 'user', context('complete-after-terminal'));
    await expect(store.readyNodes(run.workspace.id, run.id)).rejects.toMatchObject({ code: 'RUN_ALREADY_COMPLETED' });
    await expect(store.startExecution(run.workspace.id, run.id, 'background', 1, plan.revision, context('start-after-complete')))
      .rejects.toMatchObject({ code: 'RUN_ALREADY_COMPLETED' });
  });

  it('invalidates Evidence when a later Plan changes the same Planned Node input and allows Evidence refresh', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const first = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('fresh-first-start'));
    const firstProof = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: first.executionId,
      content: 'first input verified',
      kind: 'test',
      summary: 'Initial input passed',
    }, context('fresh-first-evidence'));
    await store.finishExecution(run.workspace.id, run.id, first.executionId, 'succeeded', [firstProof.id], context('fresh-first-finish'), { result: 'compiled' });
    await store.updateClaim(run.workspace.id, run.id, claimId, 'satisfied', [firstProof.id], context('fresh-first-claim'));
    expect((await store.getProjection(run.workspace.id, run.id)).commitmentAcceptanceSatisfied).toBe(true);

    const changedPlan = await store.proposePlan(run.workspace.id, run.id, 1, [{
      id: 'work-1',
      definitionId: 'work',
      dependsOn: [],
      input: { task: 'compile', options: { strict: false } },
      targetClaimIds: [claimId],
    }], context('fresh-changed-plan'));
    await store.activatePlan(run.workspace.id, run.id, changedPlan.revision, context('fresh-changed-activate'));
    expect((await store.getProjection(run.workspace.id, run.id)).commitmentAcceptanceSatisfied).toBe(false);
    await expect(store.completeRun(run.workspace.id, run.id, 1, changedPlan.revision, 'user', context('fresh-stale-complete')))
      .rejects.toMatchObject({ code: 'ACCEPTANCE_INCOMPLETE' });

    const second = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, changedPlan.revision, context('fresh-second-start'));
    const secondProof = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: second.executionId,
      content: 'changed input verified',
      kind: 'test',
      summary: 'Changed input passed',
    }, context('fresh-second-evidence'));
    await store.finishExecution(run.workspace.id, run.id, second.executionId, 'succeeded', [secondProof.id], context('fresh-second-finish'), { result: 'compiled' });
    await store.updateClaim(run.workspace.id, run.id, claimId, 'satisfied', [secondProof.id], context('fresh-second-claim'));
    expect((await store.getProjection(run.workspace.id, run.id)).commitmentAcceptanceSatisfied).toBe(true);
  });

  it('rejects conflicting semantic command replays before generated payloads can mask them', async () => {
    const first = await setup();
    const planNodes = [{ id: 'work-1', definitionId: 'work', dependsOn: [], targetClaimIds: [first.claimId] }];
    await first.store.proposePlan(first.run.workspace.id, first.run.id, 1, planNodes, context('semantic-plan'));
    await expect(first.store.proposePlan(first.run.workspace.id, first.run.id, 1, [{ ...planNodes[0]!, input: { changed: true } }], context('semantic-plan')))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const second = await setup();
    const revision = {
      objective: 'Revised objective',
      scope: ['workspace'],
      authority: ['read-workspace', 'deliver:user'],
      destination: 'user',
      acceptance: [{ description: 'Revised result is verified' }],
    };
    await second.store.reviseCommitment(second.run.workspace.id, second.run.id, revision, context('semantic-commitment'));
    await expect(second.store.reviseCommitment(second.run.workspace.id, second.run.id, { ...revision, objective: 'Conflicting objective' }, context('semantic-commitment')))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('recovers running executions as interrupted without rewriting attempts', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('start-interrupted'));
    const recovered = await store.recoverInterrupted(run.workspace.id, run.id, 'recover-trace');
    expect(recovered.nodeExecutions.find((item) => item.id === execution.executionId)?.status).toBe('interrupted');
    expect(recovered.nodeExecutions.find((item) => item.id === execution.executionId)?.attempt).toBe(1);
  });

  it('supersedes the active Plan on Commitment revision and generates attributed proposals', async () => {
    const { store, run, claimId } = await setup();
    await activatePlan(store, run, claimId);
    const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', 1, 1, context('feedback-start'));
    const evidence = await store.recordEvidence(run.workspace.id, run.id, {
      executionId: execution.executionId,
      content: 'the skill omitted a required check',
      kind: 'review',
      summary: 'Review found a missing check',
    }, context('feedback-evidence'));
    await store.finishExecution(run.workspace.id, run.id, execution.executionId, 'succeeded', [evidence.id], context('feedback-finish'), { result: 'compiled' });
    await store.recordResourceActivation(run.workspace.id, run.id, 'review-skill', 'digest-1', context('activate-resource'), 'revision-1');
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

    expect((await store.readEvents(run.workspace.id, run.id)).find((event) => event.type === 'resource.activated')?.payload)
      .toMatchObject({ resourceId: 'review-skill', digest: 'digest-1', revision: 'revision-1' });

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

    await writeFile(join(workspace, 'harness.yaml'), 'version: 3\n');
    const nested = join(workspace, 'a', 'b');
    await mkdir(nested, { recursive: true });
    expect(await findConfig(nested)).toBe(join(await realpath(workspace), 'harness.yaml'));
  });
});
