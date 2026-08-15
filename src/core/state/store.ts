import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, appendFile, mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dump as dumpYaml } from 'js-yaml';
import { invariant } from '../errors.js';
import type { EventInput, HarnessEvent, ResolvedHarnessConfig, RunMetadata, RunProjection } from '../types.js';
import type { DispatchReceipt } from '../resources.js';
import { projectRun } from './projection.js';

export interface RunStoreOptions {
  stateRoot?: string;
  now?: () => Date;
}

export interface CreateRunInput {
  workspacePath: string;
  workflowId: string;
  request: Record<string, unknown>;
  config: ResolvedHarnessConfig;
  hostSessionId?: string;
}

const delay = (milliseconds: number): Promise<void> => new Promise((accept) => setTimeout(accept, milliseconds));

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function withFileLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2_000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await delay(25);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await import('node:fs/promises').then(({ unlink }) => unlink(lockPath).catch(() => undefined));
  }
}

function eventHash(event: Omit<HarnessEvent, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

export class RunStore {
  private readonly stateRoot: string;
  private readonly now: () => Date;

  constructor(options: RunStoreOptions = {}) {
    this.stateRoot = options.stateRoot ?? join(homedir(), '.deweyou', 'harness');
    this.now = options.now ?? (() => new Date());
  }

  async createRun(input: CreateRunInput): Promise<RunMetadata> {
    const workspacePath = await realpath(resolve(input.workspacePath));
    invariant(input.config.workflows[input.workflowId], 'MISSING_WORKFLOW', `Unknown workflow '${input.workflowId}'`);
    const workspaceId = createHash('sha256').update(workspacePath).digest('hex').slice(0, 20);
    const runId = `${this.now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const runDirectory = this.runDirectory(workspaceId, runId);
    await mkdir(join(runDirectory, 'evidence'), { recursive: true, mode: 0o700 });
    const createdAt = this.now().toISOString();
    const metadata: RunMetadata = {
      schemaVersion: 1,
      id: runId,
      workspaceId,
      workspacePath,
      workflowId: input.workflowId,
      createdAt,
      hostSessions: input.hostSessionId ? [input.hostSessionId] : [],
    };
    await Promise.all([
      atomicJson(join(runDirectory, 'run.json'), metadata),
      atomicJson(join(runDirectory, 'request.json'), input.request),
      writeFile(join(runDirectory, 'config.snapshot.yaml'), dumpYaml(input.config, { noRefs: true }), { mode: 0o600 }),
      atomicJson(join(runDirectory, 'resources.lock.json'), {}),
      atomicJson(join(runDirectory, 'plan.json'), { workflowId: input.workflowId, stages: input.config.workflows[input.workflowId]?.stages ?? {} }),
      writeFile(join(runDirectory, 'events.jsonl'), '', { mode: 0o600, flag: 'wx' }),
      atomicJson(join(runDirectory, 'artifacts.json'), []),
    ]);
    await this.appendEvent(workspaceId, runId, {
      type: 'run.created',
      traceId: randomUUID(),
      spanId: randomUUID(),
      timestamp: createdAt,
      payload: {
        workflowId: input.workflowId,
        workspaceId,
        plannedNodes: Object.entries(input.config.workflows[input.workflowId]?.stages ?? {}).flatMap(([stage, instances]) =>
          (instances ?? []).map((instance) => ({ stage, nodeId: instance.id ?? instance.use })),
        ),
      },
    });
    return metadata;
  }

  async appendEvent(workspaceId: string, runId: string, input: EventInput): Promise<HarnessEvent> {
    const directory = this.runDirectory(workspaceId, runId);
    await access(join(directory, 'run.json'));
    return withFileLock(join(directory, '.events.lock'), async () => {
      const events = await this.readEvents(workspaceId, runId);
      if (input.idempotencyKey) {
        const existing = events.find((event) => event.idempotencyKey === input.idempotencyKey);
        if (existing) {
          invariant(
            existing.type === input.type && JSON.stringify(existing.payload) === JSON.stringify(input.payload),
            'IDEMPOTENCY_CONFLICT',
            `Idempotency key '${input.idempotencyKey}' was already used for different event content`,
          );
          return existing;
        }
      }
      const previous = events.at(-1);
      const withoutHash: Omit<HarnessEvent, 'hash'> = {
        ...input,
        schemaVersion: 1,
        id: randomUUID(),
        runId,
        sequence: (previous?.sequence ?? 0) + 1,
        timestamp: input.timestamp ?? this.now().toISOString(),
        previousHash: previous?.hash ?? null,
      };
      const event: HarnessEvent = { ...withoutHash, hash: eventHash(withoutHash) };
      const projection = projectRun([...events, event]);
      await appendFile(join(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      await atomicJson(join(directory, 'state.json'), projection);
      return event;
    });
  }

  async readEvents(workspaceId: string, runId: string): Promise<HarnessEvent[]> {
    const content = await readFile(join(this.runDirectory(workspaceId, runId), 'events.jsonl'), 'utf8');
    const events = content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HarnessEvent);
    let previousHash: string | null = null;
    for (const [index, event] of events.entries()) {
      invariant(event.sequence === index + 1, 'INVALID_EVENT_SEQUENCE', `Expected event sequence ${index + 1}`);
      invariant(event.previousHash === previousHash, 'INVALID_EVENT_CHAIN', `Broken event chain at sequence ${event.sequence}`);
      const { hash, ...withoutHash } = event;
      invariant(hash === eventHash(withoutHash), 'INVALID_EVENT_HASH', `Invalid event hash at sequence ${event.sequence}`);
      previousHash = hash;
    }
    return events;
  }

  async getProjection(workspaceId: string, runId: string): Promise<RunProjection> {
    return projectRun(await this.readEvents(workspaceId, runId));
  }

  async rebuildProjection(workspaceId: string, runId: string): Promise<RunProjection> {
    const projection = await this.getProjection(workspaceId, runId);
    await atomicJson(join(this.runDirectory(workspaceId, runId), 'state.json'), projection);
    return projection;
  }

  async attachHostSession(workspaceId: string, runId: string, hostSessionId: string): Promise<RunMetadata> {
    const directory = this.runDirectory(workspaceId, runId);
    return withFileLock(join(directory, '.run.lock'), async () => {
      const path = join(directory, 'run.json');
      const metadata = JSON.parse(await readFile(path, 'utf8')) as RunMetadata;
      if (!metadata.hostSessions.includes(hostSessionId)) {
        metadata.hostSessions.push(hostSessionId);
        await atomicJson(path, metadata);
      }
      return metadata;
    });
  }

  async updateResourceLock(workspaceId: string, runId: string, receipts: DispatchReceipt[]): Promise<Record<string, unknown>> {
    const directory = this.runDirectory(workspaceId, runId);
    return withFileLock(join(directory, '.resources.lock'), async () => {
      const path = join(directory, 'resources.lock.json');
      const current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      for (const receipt of receipts) {
        current[receipt.resourceId] = {
          kind: receipt.kind,
          mode: receipt.mode,
          status: receipt.status,
          locator: receipt.locator,
          digest: receipt.digest ?? null,
        };
      }
      await atomicJson(path, current);
      return current;
    });
  }

  async recoverInterrupted(workspaceId: string, runId: string, traceId: string): Promise<RunProjection> {
    const projection = await this.getProjection(workspaceId, runId);
    for (const execution of projection.nodeExecutions.filter((candidate) => candidate.status === 'running')) {
      await this.appendEvent(workspaceId, runId, {
        type: 'node.interrupted',
        traceId,
        spanId: randomUUID(),
        payload: {
          nodeExecutionId: execution.nodeExecutionId,
          nodeId: execution.nodeId,
          stage: execution.stage,
          stageVisit: execution.stageVisit,
          attempt: execution.attempt,
          reason: 'host session ended without a terminal event',
        },
      });
    }
    return this.getProjection(workspaceId, runId);
  }

  async writeEvidence(workspaceId: string, runId: string, content: string): Promise<{ evidenceId: string; path: string }> {
    const evidenceId = createHash('sha256').update(content).digest('hex');
    const path = join(this.runDirectory(workspaceId, runId), 'evidence', evidenceId);
    try {
      await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
    }
    return { evidenceId, path };
  }

  runDirectory(workspaceId: string, runId: string): string {
    return join(this.stateRoot, 'workspaces', workspaceId, 'runs', runId);
  }

  static async workspaceId(workspacePath: string): Promise<string> {
    return createHash('sha256').update(await realpath(resolve(workspacePath))).digest('hex').slice(0, 20);
  }
}

export async function findConfig(workspacePath: string): Promise<string> {
  let directory = await realpath(resolve(workspacePath));
  while (true) {
    const candidate = join(directory, 'harness.yaml');
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(directory);
      invariant(parent !== directory, 'CONFIG_NOT_FOUND', `No harness.yaml found from '${workspacePath}' upward`);
      directory = parent;
    }
  }
}
