import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ResolvedHarnessConfig } from '../src/core/types.js';
import { RunStore } from '../src/core/state/store.js';
import { createDashboardRequestHandler, createDashboardServer, maintainDashboardServer } from '../src/dashboard/server.js';

const temporaryDirectories: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const config: ResolvedHarnessConfig = {
  version: 2,
  sourceFiles: [],
  resources: {},
  nodes: { work: { name: 'Do work', executor: { kind: 'agent' } } },
};

function context(id: string) {
  return { traceId: 'trace', spanId: `span-${id}`, idempotencyKey: `key-${id}` };
}

async function fixture() {
  const stateRoot = await mkdtemp(join(tmpdir(), 'harness-dashboard-state-'));
  const workspace = await mkdtemp(join(tmpdir(), 'harness-dashboard-workspace-'));
  const assetRoot = await mkdtemp(join(tmpdir(), 'harness-dashboard-assets-'));
  temporaryDirectories.push(stateRoot, workspace, assetRoot);
  await mkdir(join(assetRoot, 'assets'));
  await writeFile(join(assetRoot, 'index.html'), '<!doctype html><main>Dashboard shell</main>');
  await writeFile(join(assetRoot, 'assets', 'app.js'), 'console.log("dashboard")');
  await writeFile(join(assetRoot, 'asset.bin'), 'binary');
  let tick = 0;
  const store = new RunStore({ stateRoot, now: () => new Date(Date.parse('2026-08-22T00:00:00.000Z') + tick++ * 1000) });
  const run = await store.createRun({
    workspacePath: workspace,
    request: { title: 'Fallback title' },
    config,
    commitment: {
      objective: 'Global dashboard work',
      scope: ['dashboard'],
      authority: ['read-workspace', 'deliver:user'],
      destination: 'user',
      acceptance: [{ description: 'Dashboard exposes v2 Run state' }],
    },
  });
  const projection = await store.getProjection(run.workspace.id, run.id);
  const claimId = Object.keys(projection.claims)[0]!;
  const plan = await store.proposePlan(run.workspace.id, run.id, 1, [{
    id: 'work-1', definitionId: 'work', dependsOn: [], targetClaimIds: [claimId], expectedOutputs: ['dashboard'],
  }], context('plan'));
  await store.activatePlan(run.workspace.id, run.id, plan.revision, context('activate'));
  const execution = await store.startExecution(run.workspace.id, run.id, 'work-1', context('start'));
  await store.finishExecution(run.workspace.id, run.id, execution.executionId, 'blocked', [], context('blocked'));
  return { assetRoot, run, store };
}

async function request(handler: ReturnType<typeof createDashboardRequestHandler>, url: string, method = 'GET') {
  let status = 0;
  let headers: Record<string, string | number | readonly string[]> = {};
  const chunks: Uint8Array[] = [];
  await handler({ method, url }, {
    writeHead(code, values) {
      status = code;
      headers = values as Record<string, string | number | readonly string[]>;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    },
  });
  const body = Buffer.concat(chunks);
  return { status, headers, body, json: () => JSON.parse(body.toString('utf8')) as unknown, text: () => body.toString('utf8') };
}

describe('Dashboard HTTP server', () => {
  test('serves the global Run list, Run details, events, and SPA assets', async () => {
    const { assetRoot, run, store } = await fixture();
    const handler = createDashboardRequestHandler({ assetRoot, store });

    expect((await request(handler, '/api/health')).json()).toEqual({
      service: 'deweyou-harness-dashboard', status: 'ok',
    });
    const list = (await request(handler, '/api/runs')).json() as { runs: Array<Record<string, unknown>> };
    expect(list.runs).toEqual([
      expect.objectContaining({
        id: run.id,
        title: 'Global dashboard work',
        status: 'blocked',
        needsAttention: true,
        currentNode: 'Do work',
        commitmentRevision: 1,
        planRevision: 1,
        completedNodes: 0,
        totalNodes: 1,
      }),
    ]);
    const detail = (await request(handler, `/api/runs/${encodeURIComponent(run.id)}`)).json() as { run: { nodes: unknown[] } };
    expect(detail.run.nodes).toEqual([
      expect.objectContaining({ id: 'work-1', definitionId: 'work', label: 'Do work', status: 'blocked', attempt: 1, durationMs: 1000 }),
    ]);
    const events = (await request(handler, `/api/runs/${encodeURIComponent(run.id)}/events`)).json() as { events: unknown[] };
    expect(events.events).toHaveLength(6);
    expect((await request(handler, `/runs/${run.id}`)).text()).toContain('Dashboard shell');
    expect((await request(handler, '/assets/app.js')).headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect((await request(handler, '/asset.bin')).headers['content-type']).toBe('application/octet-stream');
    expect((await request(handler, '/api/health', 'HEAD')).body).toHaveLength(0);
    expect((await request(handler, '/api/runs?scope=active')).json()).toMatchObject({ scope: 'active' });
    expect((await request(handler, '/api/runs?scope=archived')).json()).toEqual({ scope: 'archived', runs: [] });
    expect((await request(handler, '/api/runs?scope=invalid')).json()).toMatchObject({ scope: 'all' });
    expect((await request(handler, '/api/runs/missing')).status).toBe(404);
    expect((await request(handler, '/api/runs/missing/events')).status).toBe(404);
    expect((await request(handler, '/api/missing')).status).toBe(404);
    expect((await request(handler, '/missing.js')).status).toBe(404);
    expect((await request(handler, '/%2e%2e%2foutside')).status).toBe(404);
    expect((await request(handler, '/%')).status).toBe(500);
    expect((await request(handler, '/api/runs', 'POST')).status).toBe(405);
    expect((await request(handler, '/runs', 'POST')).status).toBe(405);
  });

  test('renders a Run that has a Commitment but no Plan yet', async () => {
    const { assetRoot, run, store } = await fixture();
    const waiting = await store.createRun({
      workspacePath: run.workspacePath!,
      request: {},
      config,
      commitment: {
        objective: 'Await a task-scoped plan',
        scope: ['dashboard'],
        authority: ['read-workspace'],
        destination: 'user',
        acceptance: [{ description: 'Plan is accepted' }],
        unresolvedDecisions: ['Choose an executor'],
      },
    });
    const handler = createDashboardRequestHandler({ assetRoot, store });
    const detail = (await request(handler, `/api/runs/${waiting.id}`)).json() as { run: Record<string, unknown> };
    expect(detail.run).toMatchObject({
      title: 'Await a task-scoped plan',
      needsAttention: true,
      unresolvedDecisionCount: 1,
      totalNodes: 0,
      nodes: [],
    });
    expect(detail.run).not.toHaveProperty('planRevision');

    const projection = await store.getProjection(waiting.workspace.id, waiting.id);
    const claimId = Object.keys(projection.claims)[0]!;
    await store.proposePlan(waiting.workspace.id, waiting.id, 1, [{
      id: 'proposed-work', definitionId: 'work', dependsOn: [], targetClaimIds: [claimId],
    }], context('waiting-plan'));
    const proposed = (await request(handler, `/api/runs/${waiting.id}`)).json() as { run: Record<string, unknown> };
    expect(proposed.run).toMatchObject({ planRevision: 1, planStatus: 'proposed', totalNodes: 1 });
  });

  test('elects one port owner and skips startup when the service is already running', async () => {
    const { assetRoot, store } = await fixture();
    let portAvailable = true;
    const owners = new WeakSet<object>();
    const serverFactory = () => {
      const server = { close: (callback?: (error?: Error) => void) => { if (owners.has(server)) portAvailable = true; callback?.(); } };
      return server as unknown as Server;
    };
    const listenServer = async (server: Server) => {
      if (!portAvailable) return false;
      portAvailable = false;
      owners.add(server);
      return true;
    };
    const probeService = async () => true;
    const options = { assetRoot, store, port: 7777, serverFactory, listenServer, probeService };
    const first = await maintainDashboardServer(options);
    const second = await maintainDashboardServer(options);
    closeCallbacks.push(() => second.close(), () => first.close());
    expect(first.isOwner()).toBe(true);
    expect(second.isOwner()).toBe(false);

    await first.close();
    expect(second.isOwner()).toBe(false);
    expect(second.url).toBe('http://127.0.0.1:7777');
  });

  test('reports a conflict when another service occupies the Dashboard port', async () => {
    const { assetRoot, store } = await fixture();
    const errors: unknown[] = [];
    const serverFactory = () => ({ close: (callback?: (error?: Error) => void) => callback?.() }) as unknown as Server;
    const lease = await maintainDashboardServer({
      assetRoot,
      store,
      port: 7777,
      serverFactory,
      listenServer: async () => false,
      probeService: async () => false,
      onError: (error) => errors.push(error),
    });
    closeCallbacks.push(() => lease.close());

    expect(lease.isOwner()).toBe(false);
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'DASHBOARD_PORT_CONFLICT',
        message: 'Port 127.0.0.1:7777 is occupied by a service other than Deweyou Harness Dashboard',
      }),
    ]);
  });

  test('detects a healthy existing Dashboard through its health response', async () => {
    const { assetRoot, store } = await fixture();
    expect(createDashboardServer({ assetRoot, store })).toBeDefined();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ service: 'deweyou-harness-dashboard', status: 'ok' }),
    })));
    const serverFactory = () => ({ close: () => undefined }) as unknown as Server;
    const lease = await maintainDashboardServer({ assetRoot, store, port: 7788, serverFactory, listenServer: async () => false });
    closeCallbacks.push(() => lease.close());
    expect(lease.isOwner()).toBe(false);
    expect(lease.url).toBe('http://127.0.0.1:7788');
  });

  test('reports listener failures and close failures through their explicit boundaries', async () => {
    const { assetRoot, store } = await fixture();
    const errors: unknown[] = [];
    const failed = await maintainDashboardServer({
      assetRoot,
      store,
      serverFactory: () => ({ close: () => undefined }) as unknown as Server,
      listenServer: async () => { throw new Error('listen failed'); },
      onError: (error) => errors.push(error),
    });
    expect(failed.isOwner()).toBe(false);
    expect(errors).toEqual([expect.objectContaining({ message: 'listen failed' })]);
    await failed.close();

    const closeFailure = new Error('close failed');
    const owned = await maintainDashboardServer({
      assetRoot,
      store,
      serverFactory: () => ({ close: (callback?: (error?: Error) => void) => callback?.(closeFailure) }) as unknown as Server,
      listenServer: async () => true,
    });
    await expect(owned.close()).rejects.toThrow('close failed');
  });

  test('rejects an unhealthy HTTP service on the requested port', async () => {
    const { assetRoot, store } = await fixture();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const errors: unknown[] = [];
    const lease = await maintainDashboardServer({
      assetRoot,
      store,
      serverFactory: () => ({ close: () => undefined }) as unknown as Server,
      listenServer: async () => false,
      onError: (error) => errors.push(error),
    });
    closeCallbacks.push(() => lease.close());
    expect(errors).toEqual([expect.objectContaining({ code: 'DASHBOARD_PORT_CONFLICT' })]);
  });
});
