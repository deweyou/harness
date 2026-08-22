import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessEvent, NodeInstance, NodeStatus, RunIndexEntry, RunProjection, Stage } from '../core/types.js';
import { STAGES } from '../core/types.js';
import { RunStore } from '../core/state/store.js';

const TERMINAL_NODE_STATUSES = new Set<NodeStatus>(['succeeded', 'failed', 'cancelled', 'skipped', 'interrupted']);
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

interface RunPlan {
  workflowId: string;
  stages: Partial<Record<Stage, NodeInstance[]>>;
}

export interface DashboardRunNode {
  id: string;
  label: string;
  stage: Stage;
  status: NodeStatus;
  attempt: number | null;
  durationMs: number | null;
  evidenceCount: number;
  needs: string[];
  executionIds: string[];
}

export interface DashboardRunSummary {
  id: string;
  title: string;
  workspace: string;
  workspacePath: string;
  workspaceId: string;
  workflowId: string;
  status: RunProjection['status'];
  needsAttention: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  currentStage?: Stage;
  currentNode?: string;
  completedNodes: number;
  totalNodes: number;
  durationMs: number;
}

export interface DashboardRunDetail extends DashboardRunSummary {
  nodes: DashboardRunNode[];
}

export interface DashboardServerOptions {
  store?: RunStore;
  assetRoot?: string;
}

export interface DashboardLeaseOptions extends DashboardServerOptions {
  host?: string;
  port?: number;
  onError?: (error: unknown) => void;
  serverFactory?: (options: DashboardServerOptions) => Server;
  listenServer?: (server: Server, host: string, port: number) => Promise<boolean>;
  probeService?: (host: string, port: number) => Promise<boolean>;
}

export interface DashboardServerLease {
  readonly url: string;
  isOwner(): boolean;
  close(): Promise<void>;
}

function pluginDashboardAssetRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'dashboard');
}

function workspaceLabel(workspacePath: string): string {
  const parent = basename(dirname(workspacePath));
  const name = basename(workspacePath);
  return parent && parent !== sep ? `${parent}/${name}` : name;
}

function humanize(identifier: string): string {
  const text = identifier.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : identifier;
}

async function readPlan(store: RunStore, entry: RunIndexEntry): Promise<RunPlan> {
  return JSON.parse(await readFile(join(store.runDirectory(entry.workspaceId, entry.runId), 'plan.json'), 'utf8')) as RunPlan;
}

function materializeNodes(plan: RunPlan, projection: RunProjection, events: HarnessEvent[]): DashboardRunNode[] {
  return STAGES.flatMap((stage) => (plan.stages[stage] ?? []).map((instance) => {
    const id = instance.id ?? instance.use;
    const executions = projection.nodeExecutions.filter((execution) => execution.stage === stage && execution.nodeId === id);
    const latest = executions.at(-1);
    const evidenceCount = events.filter((event) => event.type === 'evidence.recorded' && (
      event.payload.nodeId === id || (latest && event.payload.nodeExecutionId === latest.nodeExecutionId)
    )).length;
    return {
      id,
      label: humanize(id),
      stage,
      status: projection.nodeStatuses[`${stage}:${id}`] ?? 'pending',
      attempt: latest?.attempt ?? null,
      durationMs: latest?.durationMs ?? null,
      evidenceCount,
      needs: instance.needs ?? [],
      executionIds: executions.map((execution) => execution.nodeExecutionId),
    };
  }));
}

async function runDetail(store: RunStore, entry: RunIndexEntry): Promise<{ detail: DashboardRunDetail; events: HarnessEvent[] }> {
  const [projection, plan, events] = await Promise.all([
    store.getProjection(entry.workspaceId, entry.runId),
    readPlan(store, entry),
    store.readEvents(entry.workspaceId, entry.runId),
  ]);
  const nodes = materializeNodes(plan, projection, events);
  const currentNode = nodes.find((node) => node.status === 'blocked')
    ?? nodes.find((node) => node.status === 'running')
    ?? nodes.find((node) => node.status === 'ready')
    ?? nodes.find((node) => node.status === 'pending');
  return {
    detail: {
      id: entry.runId,
      title: entry.title,
      workspace: workspaceLabel(entry.workspacePath),
      workspacePath: entry.workspacePath,
      workspaceId: entry.workspaceId,
      workflowId: entry.workflowId,
      status: projection.status,
      needsAttention: projection.status === 'blocked',
      archived: projection.status === 'completed',
      createdAt: entry.createdAt,
      updatedAt: projection.updatedAt,
      completedNodes: nodes.filter((node) => TERMINAL_NODE_STATUSES.has(node.status)).length,
      totalNodes: nodes.length,
      durationMs: projection.timing.wallTimeMs,
      nodes,
      ...(projection.currentStage ? { currentStage: projection.currentStage } : {}),
      ...(currentNode ? { currentNode: currentNode.label } : {}),
    },
    events,
  };
}

async function findRun(store: RunStore, runId: string): Promise<RunIndexEntry | undefined> {
  return (await store.listRuns()).find((entry) => entry.runId === runId);
}

type DashboardRequest = Pick<IncomingMessage, 'method' | 'url'>;
interface DashboardResponse {
  writeHead(statusCode: number, headers?: Record<string, string | number>): unknown;
  end(chunk?: string | Uint8Array): unknown;
}

function json(response: DashboardResponse, status: number, value: unknown, head = false): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(head ? undefined : body);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

async function serveAsset(response: DashboardResponse, assetRoot: string, pathname: string, head: boolean): Promise<void> {
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  let assetPath = resolve(assetRoot, requestedPath);
  const escapesRoot = relative(assetRoot, assetPath).startsWith('..');
  if (escapesRoot) {
    json(response, 404, { error: 'Not found' }, head);
    return;
  }
  try {
    if (!(await stat(assetPath)).isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
  } catch (error) {
    if (errorCode(error) !== 'ENOENT' || extname(requestedPath)) {
      json(response, errorCode(error) === 'ENOENT' ? 404 : 500, { error: 'Asset unavailable' }, head);
      return;
    }
    assetPath = join(assetRoot, 'index.html');
  }
  const content = await readFile(assetPath);
  response.writeHead(200, {
    'cache-control': extname(assetPath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-length': content.length,
    'content-type': MIME_TYPES[extname(assetPath)] ?? 'application/octet-stream',
  });
  response.end(head ? undefined : content);
}

export function createDashboardRequestHandler(options: DashboardServerOptions = {}) {
  const store = options.store ?? new RunStore();
  const assetRoot = options.assetRoot ?? pluginDashboardAssetRoot();
  return async (request: DashboardRequest, response: DashboardResponse): Promise<void> => {
    const method = request.method ?? 'GET';
    const head = method === 'HEAD';
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/') && method !== 'GET' && !head) {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (url.pathname === '/api/health') {
        json(response, 200, { service: 'deweyou-harness-dashboard', status: 'ok' }, head);
        return;
      }
      if (url.pathname === '/api/runs') {
        const requestedScope = url.searchParams.get('scope');
        const scope = requestedScope === 'active' || requestedScope === 'archived' ? requestedScope : 'all';
        const entries = await store.listRuns(scope);
        const details = await Promise.all(entries.map((entry) => runDetail(store, entry).then(({ detail }) => detail)));
        json(response, 200, { scope, runs: details }, head);
        return;
      }
      const eventsMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
      if (eventsMatch) {
        const runId = decodeURIComponent(eventsMatch[1]!);
        const entry = await findRun(store, runId);
        if (!entry) return json(response, 404, { error: 'Run not found' }, head);
        json(response, 200, { runId, events: await store.readEvents(entry.workspaceId, entry.runId) }, head);
        return;
      }
      const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
      if (runMatch) {
        const runId = decodeURIComponent(runMatch[1]!);
        const entry = await findRun(store, runId);
        if (!entry) return json(response, 404, { error: 'Run not found' }, head);
        json(response, 200, { run: (await runDetail(store, entry)).detail }, head);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        json(response, 404, { error: 'Not found' }, head);
        return;
      }
      if (method !== 'GET' && !head) {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      await serveAsset(response, assetRoot, url.pathname, head);
    } catch (error) {
      json(response, errorCode(error) === 'ENOENT' ? 404 : 500, {
        error: error instanceof Error ? error.message : 'Unexpected dashboard error',
      }, head);
    }
  };
}

export function createDashboardServer(options: DashboardServerOptions = {}): Server {
  return createServer(createDashboardRequestHandler(options));
}

async function listen(server: Server, host: string, port: number): Promise<boolean> {
  return new Promise((accept, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE') accept(false);
      else reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      accept(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function probeDashboardService(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json() as { service?: unknown; status?: unknown };
    return body.service === 'deweyou-harness-dashboard' && body.status === 'ok';
  } catch {
    return false;
  }
}

export async function maintainDashboardServer(options: DashboardLeaseOptions = {}): Promise<DashboardServerLease> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7777;
  const serverFactory = options.serverFactory ?? createDashboardServer;
  const listenServer = options.listenServer ?? listen;
  const probeService = options.probeService ?? probeDashboardService;
  let ownedServer: Server | undefined;
  let stopped = false;
  let claiming: Promise<void> | undefined;

  const claim = async () => {
    if (stopped || ownedServer || claiming) return claiming;
    claiming = (async () => {
      const candidate = serverFactory(options);
      try {
        if (await listenServer(candidate, host, port)) {
          ownedServer = candidate;
        } else {
          candidate.close();
          if (!(await probeService(host, port))) {
            options.onError?.(Object.assign(
              new Error(`Port ${host}:${port} is occupied by a service other than Deweyou Harness Dashboard`),
              { code: 'DASHBOARD_PORT_CONFLICT' },
            ));
          }
        }
      } catch (error) {
        candidate.close();
        options.onError?.(error);
      }
    })().finally(() => { claiming = undefined; });
    return claiming;
  };

  await claim();
  return {
    url: `http://${host}:${port}`,
    isOwner: () => ownedServer !== undefined,
    async close() {
      stopped = true;
      await claiming;
      if (!ownedServer) return;
      const server = ownedServer;
      ownedServer = undefined;
      await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    },
  };
}
