import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { EventInput, ResolvedHarnessConfig } from '../src/core/types.js';
import { RunStore } from '../src/core/state/store.js';
import { createDashboardRequestHandler, maintainDashboardServer } from '../src/dashboard/server.js';

const temporaryDirectories: string[] = [];
const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const config: ResolvedHarnessConfig = {
  version: 1,
  sourceFiles: [],
  resources: {},
  nodes: { work: { name: 'Do work', executor: { type: 'agent' } } },
  workflows: {
    flow: {
      name: 'Flow',
      description: 'Flow',
      selectable: true,
      rules: [],
      knowledge: [],
      stages: { execute: [{ use: 'work', id: 'work', needs: [] }] },
    },
  },
};

function event(type: EventInput['type'], timestamp: string, payload: Record<string, unknown>): EventInput {
  return { type, timestamp, traceId: 'trace', spanId: `span-${timestamp}`, payload };
}

async function fixture() {
  const stateRoot = await mkdtemp(join(tmpdir(), 'harness-dashboard-state-'));
  const workspace = await mkdtemp(join(tmpdir(), 'harness-dashboard-workspace-'));
  const assetRoot = await mkdtemp(join(tmpdir(), 'harness-dashboard-assets-'));
  temporaryDirectories.push(stateRoot, workspace, assetRoot);
  await mkdir(join(assetRoot, 'assets'));
  await writeFile(join(assetRoot, 'index.html'), '<!doctype html><main>Dashboard shell</main>');
  await writeFile(join(assetRoot, 'assets', 'app.js'), 'console.log("dashboard")');
  const store = new RunStore({ stateRoot, now: () => new Date('2026-08-22T00:00:00.000Z') });
  const run = await store.createRun({ workspacePath: workspace, workflowId: 'flow', request: { title: 'Global dashboard work' }, config });
  await store.appendEvent(run.workspaceId, run.id, event('node.started', '2026-08-22T00:00:01.000Z', {
    nodeExecutionId: 'work-1', nodeId: 'work', stage: 'execute', stageVisit: 1, attempt: 1,
  }));
  await store.appendEvent(run.workspaceId, run.id, event('node.blocked', '2026-08-22T00:00:02.000Z', { nodeExecutionId: 'work-1' }));
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
        currentNode: 'Work',
        completedNodes: 0,
        totalNodes: 1,
      }),
    ]);
    const detail = (await request(handler, `/api/runs/${encodeURIComponent(run.id)}`)).json() as { run: { nodes: unknown[] } };
    expect(detail.run.nodes).toEqual([
      expect.objectContaining({ id: 'work', label: 'Work', stage: 'execute', status: 'blocked', attempt: 1, durationMs: 1000 }),
    ]);
    const events = (await request(handler, `/api/runs/${encodeURIComponent(run.id)}/events`)).json() as { events: unknown[] };
    expect(events.events).toHaveLength(3);
    expect((await request(handler, `/runs/${run.id}`)).text()).toContain('Dashboard shell');
    expect((await request(handler, '/api/runs/missing')).status).toBe(404);
    expect((await request(handler, '/api/runs', 'POST')).status).toBe(405);
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
});
