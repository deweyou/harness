import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { findConfig, RunStore } from '../src/core/state/store.js';
import type { EventInput, ResolvedHarnessConfig } from '../src/core/types.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const config: ResolvedHarnessConfig = {
  version: 1,
  sourceFiles: [],
  resources: {},
  nodes: { work: { executor: { type: 'agent' } } },
  workflows: {
    flow: {
      name: 'Flow',
      description: 'A workflow.',
      selectable: true,
      rules: [],
      knowledge: [],
      stages: { execute: [{ use: 'work', id: 'work', needs: [] }] },
    },
  },
};

function event(type: EventInput['type'], timestamp: string, payload: Record<string, unknown>, idempotencyKey?: string): EventInput {
  return { type, timestamp, traceId: 'trace', spanId: `span-${timestamp}`, payload, ...(idempotencyKey ? { idempotencyKey } : {}) };
}

describe('RunStore', () => {
  test('creates the complete Run bundle and keeps every loop execution duration', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-'));
    directories.push(stateRoot);
    const workspace = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
    directories.push(workspace);
    const store = new RunStore({ stateRoot, now: () => new Date('2026-08-16T00:00:00.000Z') });
    const run = await store.createRun({ workspacePath: workspace, workflowId: 'flow', request: { prompt: 'work' }, config, hostSessionId: 'host-1' });
    expect((await store.getProjection(run.workspaceId, run.id)).nodeStatuses).toEqual({ 'execute:work': 'pending' });
    const append = (input: EventInput) => store.appendEvent(run.workspaceId, run.id, input);

    await append(event('stage.started', '2026-08-16T00:00:01.000Z', { stage: 'execute', stageVisit: 1 }));
    await append(event('node.started', '2026-08-16T00:00:02.000Z', { nodeExecutionId: 'exec-1', nodeId: 'work', stage: 'execute', stageVisit: 1, attempt: 1 }));
    await append(event('node.failed', '2026-08-16T00:00:02.100Z', { nodeExecutionId: 'exec-1' }));
    await append(event('node.started', '2026-08-16T00:00:03.000Z', { nodeExecutionId: 'exec-2', nodeId: 'work', stage: 'execute', stageVisit: 1, attempt: 2 }));
    await append(event('node.succeeded', '2026-08-16T00:00:03.200Z', { nodeExecutionId: 'exec-2' }));
    await append(event('stage.completed', '2026-08-16T00:00:03.500Z', { stage: 'execute', stageVisit: 1 }));
    await append(event('stage.started', '2026-08-16T00:00:04.000Z', { stage: 'execute', stageVisit: 2 }));
    await append(event('node.started', '2026-08-16T00:00:05.000Z', { nodeExecutionId: 'exec-3', nodeId: 'work', stage: 'execute', stageVisit: 2, attempt: 1 }));
    await append(event('node.succeeded', '2026-08-16T00:00:05.300Z', { nodeExecutionId: 'exec-3' }));
    await append(event('stage.completed', '2026-08-16T00:00:06.000Z', { stage: 'execute', stageVisit: 2 }));

    const projection = await store.getProjection(run.workspaceId, run.id);
    expect(projection.nodeExecutions).toHaveLength(3);
    expect(projection.nodeExecutions.map((execution) => execution.durationMs)).toEqual([100, 200, 300]);
    expect(projection.timing).toMatchObject({ executionTimeMs: 600, retryTimeMs: 200, reworkTimeMs: 300, wallTimeMs: 6000, criticalPathMs: 600 });
    expect(projection.stageVisits.execute).toBe(2);
    expect(projection.stageVisitExecutions).toEqual([
      {
        stage: 'execute',
        stageVisit: 1,
        status: 'completed',
        startedAt: '2026-08-16T00:00:01.000Z',
        endedAt: '2026-08-16T00:00:03.500Z',
        durationMs: 2500,
      },
      {
        stage: 'execute',
        stageVisit: 2,
        status: 'completed',
        startedAt: '2026-08-16T00:00:04.000Z',
        endedAt: '2026-08-16T00:00:06.000Z',
        durationMs: 2000,
      },
    ]);
    expect(projection.nodeStatuses['execute:work']).toBe('succeeded');

    const bundle = store.runDirectory(run.workspaceId, run.id);
    for (const path of ['run.json', 'request.json', 'config.snapshot.yaml', 'resources.lock.json', 'plan.json', 'events.jsonl', 'state.json', 'artifacts.json']) {
      await expect(readFile(join(bundle, path), 'utf8')).resolves.toBeTruthy();
    }
  });

  test('deduplicates append retries and detects a modified hash chain', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-'));
    directories.push(stateRoot);
    const workspace = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
    directories.push(workspace);
    const store = new RunStore({ stateRoot, now: () => new Date('2026-08-16T00:00:00.000Z') });
    const run = await store.createRun({ workspacePath: workspace, workflowId: 'flow', request: {}, config });
    const input = event('workflow.selected', '2026-08-16T00:00:01.000Z', { workflowId: 'flow' }, 'select-flow');
    const first = await store.appendEvent(run.workspaceId, run.id, input);
    const second = await store.appendEvent(run.workspaceId, run.id, input);
    expect(second.id).toBe(first.id);
    expect(await store.readEvents(run.workspaceId, run.id)).toHaveLength(2);
    await expect(
      store.appendEvent(run.workspaceId, run.id, { ...input, payload: { workflowId: 'different' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const eventsPath = join(store.runDirectory(run.workspaceId, run.id), 'events.jsonl');
    const content = await readFile(eventsPath, 'utf8');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(eventsPath, content.replace('workflow.selected', 'run.completed')));
    await expect(store.readEvents(run.workspaceId, run.id)).rejects.toMatchObject({ code: 'INVALID_EVENT_HASH' });
  });

  test('marks started executions interrupted on resume and stores content-addressed evidence once', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-'));
    directories.push(stateRoot);
    const workspace = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
    directories.push(workspace);
    const store = new RunStore({ stateRoot, now: () => new Date('2026-08-16T00:00:00.000Z') });
    const run = await store.createRun({ workspacePath: workspace, workflowId: 'flow', request: {}, config });
    await store.appendEvent(run.workspaceId, run.id, event('node.started', '2026-08-16T00:00:01.000Z', { nodeExecutionId: 'dangling', nodeId: 'work', stage: 'execute', stageVisit: 1, attempt: 1 }));
    const recovered = await store.recoverInterrupted(run.workspaceId, run.id, 'resume-trace');
    expect(recovered.nodeExecutions[0]?.status).toBe('interrupted');

    const first = await store.writeEvidence(run.workspaceId, run.id, 'same proof');
    const second = await store.writeEvidence(run.workspaceId, run.id, 'same proof');
    expect(second).toEqual(first);
  });

  test('projects activated resources, evidence, blocked and completed outcomes', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-'));
    directories.push(stateRoot);
    const workspace = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
    directories.push(workspace);
    const store = new RunStore({ stateRoot, now: () => new Date('2026-08-16T00:00:00.000Z') });
    const run = await store.createRun({ workspacePath: workspace, workflowId: 'flow', request: {}, config });
    await store.appendEvent(run.workspaceId, run.id, event('resource.activated', '2026-08-16T00:00:01.000Z', { resourceId: 'writer' }));
    await store.appendEvent(run.workspaceId, run.id, event('evidence.recorded', '2026-08-16T00:00:02.000Z', { evidenceId: 'proof' }));
    await store.appendEvent(run.workspaceId, run.id, event('node.started', '2026-08-16T00:00:03.000Z', { nodeExecutionId: 'blocked', nodeId: 'work', stage: 'execute', stageVisit: 1, attempt: 1 }));
    await store.appendEvent(run.workspaceId, run.id, event('node.blocked', '2026-08-16T00:00:04.000Z', { nodeExecutionId: 'blocked' }));
    expect((await store.getProjection(run.workspaceId, run.id)).status).toBe('blocked');
    await store.appendEvent(run.workspaceId, run.id, event('run.completed', '2026-08-16T00:00:05.000Z', { outcome: 'partial' }));
    const projection = await store.rebuildProjection(run.workspaceId, run.id);
    expect(projection).toMatchObject({ status: 'completed', activatedResources: ['writer'], evidenceIds: ['proof'] });
  });

  test('finds harness.yaml by walking upward and rejects unknown workflows', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-'));
    directories.push(stateRoot);
    const workspace = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
    directories.push(workspace);
    const nested = join(workspace, 'packages', 'app');
    await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
      await mkdir(nested, { recursive: true });
      await writeFile(join(workspace, 'harness.yaml'), 'version: 1\n');
    });
    await expect(findConfig(nested)).resolves.toBe(join(await import('node:fs/promises').then(({ realpath }) => realpath(workspace)), 'harness.yaml'));
    await expect(new RunStore({ stateRoot }).createRun({ workspacePath: workspace, workflowId: 'missing', request: {}, config })).rejects.toMatchObject({
      code: 'MISSING_WORKFLOW',
    });
  });

  test('tracks host sessions and atomically updates the resource lock', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-state-'));
    directories.push(stateRoot);
    const workspace = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
    directories.push(workspace);
    const store = new RunStore({ stateRoot, now: () => new Date('2026-08-16T00:00:00.000Z') });
    const run = await store.createRun({ workspacePath: workspace, workflowId: 'flow', request: {}, config, hostSessionId: 'host-1' });
    const metadata = await store.attachHostSession(run.workspaceId, run.id, 'host-2');
    expect(metadata.hostSessions).toEqual(['host-1', 'host-2']);
    await store.attachHostSession(run.workspaceId, run.id, 'host-2');
    const lock = await store.updateResourceLock(run.workspaceId, run.id, [
      { resourceId: 'writer', kind: 'skill', mode: 'full', status: 'loaded', locator: '/skill/SKILL.md', digest: 'abc', content: 'ignored' },
    ]);
    expect(lock).toEqual({ writer: { kind: 'skill', mode: 'full', status: 'loaded', locator: '/skill/SKILL.md', digest: 'abc' } });
  });
});
