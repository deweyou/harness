import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, appendFile, mkdir, open, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { invariant } from '../errors.js';
import { readyPlannedNodes } from '../graph.js';
import { assertPortValues } from '../port-schema.js';
import { buildRetrospective } from '../retrospective.js';
import { buildRetrospectiveReport } from '../retrospective-report.js';
import { structuredInputDigest } from '../runtime.js';
import type {
  Claim,
  ClaimStatus,
  Commitment,
  EventInput,
  Evidence,
  ExecutionExport,
  ExecutionExportMediaType,
  HarnessEvent,
  NodeExecutionStatus,
  Plan,
  PlannedNode,
  ReadyNodeAssignment,
  ReadyNodeAssignments,
  ResolvedHarnessConfig,
  ResourceProposal,
  ResourceProposalStatus,
  Run,
  RunIndex,
  RunIndexEntry,
  RunProjection,
  RunRetrospective,
  WorkspaceRef,
} from '../types.js';
import { projectRun } from './projection.js';

export interface RunRepository {
  initialize(run: Run, request: Record<string, unknown>, config: ResolvedHarnessConfig): Promise<void>;
  commitEvent(workspaceId: string, runId: string, input: EventInput): Promise<HarnessEvent>;
  readEvents(workspaceId: string, runId: string): Promise<HarnessEvent[]>;
  writeProjection(workspaceId: string, runId: string, projection: RunProjection): Promise<void>;
  writeEvidence(workspaceId: string, runId: string, digest: string, content: string): Promise<string>;
  readJson<T>(workspaceId: string, runId: string, relativePath: string): Promise<T>;
  writeJson(workspaceId: string, runId: string, relativePath: string, value: unknown): Promise<void>;
  writeText(workspaceId: string, runId: string, relativePath: string, value: string): Promise<void>;
  readText(workspaceId: string, runId: string, relativePath: string): Promise<string>;
  listRuns(scope?: 'all' | 'active' | 'archived'): Promise<RunIndexEntry[]>;
  rebuildRunIndex(): Promise<RunIndex>;
  runDirectory(workspaceId: string, runId: string): string;
}

export interface RunStoreOptions {
  stateRoot?: string;
  now?: () => Date;
  repository?: RunRepository;
}

export interface CommitmentDraft {
  objective: string;
  scope: string[];
  authority: string[];
  destination: string;
  acceptance: Array<{ description: string }>;
  unresolvedDecisions?: string[];
}

export interface CreateRunInput {
  workspacePath: string;
  workspace?: WorkspaceRef;
  request: Record<string, unknown>;
  config: ResolvedHarnessConfig;
  commitment: CommitmentDraft;
  hostSessionId?: string;
  workspacePreparationId?: string;
}

export interface CommandContext {
  traceId: string;
  spanId: string;
  idempotencyKey: string;
  parentSpanId?: string;
}

export interface EvidenceInput {
  executionId: string;
  content: string;
  kind: string;
  summary: string;
}

export interface ExecutionExportInput {
  name: string;
  mediaType: ExecutionExportMediaType;
  role?: string;
  content?: string;
  sourcePath?: string;
}

const delay = (milliseconds: number): Promise<void> => new Promise((accept) => setTimeout(accept, milliseconds));
const MAX_STRUCTURED_PAYLOAD_BYTES = 64 * 1_024;
const MAX_EXPORT_BYTES = 1_024 * 1_024;

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function atomicText(path: string, value: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}

function assertStructuredPayloadSize(label: string, value: Record<string, unknown>): void {
  let content: string;
  try {
    content = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
  invariant(
    Buffer.byteLength(content) <= MAX_STRUCTURED_PAYLOAD_BYTES,
    'STRUCTURED_PAYLOAD_TOO_LARGE',
    `${label} exceeds ${MAX_STRUCTURED_PAYLOAD_BYTES} bytes; store large content as Evidence`,
  );
}

export const RUN_CONFIG_SNAPSHOT_PATH = 'cache/config.snapshot.yaml';

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

function verifyEventChain(events: HarnessEvent[]): void {
  let previousHash: string | null = null;
  for (const [index, event] of events.entries()) {
    invariant(event.schemaVersion === 2, 'UNSUPPORTED_EVENT_VERSION', `Event ${index + 1} has unsupported schema version ${event.schemaVersion}`);
    invariant(event.sequence === index + 1, 'INVALID_EVENT_SEQUENCE', `Expected event sequence ${index + 1}`);
    invariant(event.previousHash === previousHash, 'INVALID_EVENT_CHAIN', `Broken event chain at sequence ${event.sequence}`);
    const { hash, ...withoutHash } = event;
    invariant(hash === eventHash(withoutHash), 'INVALID_EVENT_HASH', `Invalid event hash at sequence ${event.sequence}`);
    previousHash = hash;
  }
}

function workspaceIdentity(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 20);
}

function isRunIndex(value: unknown): value is RunIndex {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RunIndex>;
  return candidate.schemaVersion === 2 && typeof candidate.updatedAt === 'string' && Array.isArray(candidate.runs);
}

function runTitle(request: Record<string, unknown>, projection: RunProjection): string {
  const commitment = projection.activeCommitmentRevision === undefined
    ? undefined
    : projection.commitments[projection.activeCommitmentRevision];
  if (commitment?.objective.trim()) return commitment.objective.trim().replace(/\s+/g, ' ').slice(0, 96);
  for (const key of ['title', 'task', 'prompt']) {
    const value = request[key];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ').slice(0, 96);
  }
  return 'Untitled Run';
}

function sortRunIndexEntries(left: RunIndexEntry, right: RunIndexEntry): number {
  const leftArchived = left.status === 'completed';
  const rightArchived = right.status === 'completed';
  if (leftArchived !== rightArchived) return leftArchived ? 1 : -1;
  if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

export class LocalRunRepository implements RunRepository {
  private readonly stateRoot: string;

  constructor(stateRoot = process.env.DEWEYOU_HARNESS_STATE_ROOT ?? join(homedir(), '.deweyou', 'harness')) {
    this.stateRoot = stateRoot;
  }

  async initialize(run: Run, request: Record<string, unknown>, config: ResolvedHarnessConfig): Promise<void> {
    const directory = this.runDirectory(run.workspace.id, run.id);
    await Promise.all([
      mkdir(join(directory, 'evidence'), { recursive: true, mode: 0o700 }),
      mkdir(join(directory, 'proposals'), { recursive: true, mode: 0o700 }),
      mkdir(join(directory, 'reports'), { recursive: true, mode: 0o700 }),
      mkdir(join(directory, 'exports'), { recursive: true, mode: 0o700 }),
      mkdir(join(directory, 'cache'), { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      atomicJson(join(directory, 'run.json'), run),
      atomicJson(join(directory, 'request.json'), request),
      writeFile(join(directory, RUN_CONFIG_SNAPSHOT_PATH), dumpYaml(config, { noRefs: true }), { mode: 0o600 }),
      writeFile(join(directory, 'events.jsonl'), '', { mode: 0o600, flag: 'wx' }),
    ]);
  }

  async commitEvent(workspaceId: string, runId: string, input: EventInput): Promise<HarnessEvent> {
    const directory = this.runDirectory(workspaceId, runId);
    await access(join(directory, 'run.json'));
    const event = await withFileLock(join(directory, '.events.lock'), async () => {
      const events = await this.readEvents(workspaceId, runId);
      verifyEventChain(events);
      if (input.idempotencyKey) {
        const existing = events.find((event) => event.idempotencyKey === input.idempotencyKey);
        if (existing) {
          invariant(
            existing.type === input.type && JSON.stringify(existing.payload) === JSON.stringify(input.payload),
            'IDEMPOTENCY_CONFLICT',
            `Idempotency key '${input.idempotencyKey}' has different command input`,
          );
          return existing;
        }
      }
      const previous = events.at(-1);
      const withoutHash: Omit<HarnessEvent, 'hash'> = {
        ...input,
        schemaVersion: 2,
        id: randomUUID(),
        runId,
        sequence: (previous?.sequence ?? 0) + 1,
        timestamp: input.timestamp ?? new Date().toISOString(),
        previousHash: previous?.hash ?? null,
      };
      const event: HarnessEvent = { ...withoutHash, hash: eventHash(withoutHash) };
      const projection = projectRun([...events, event]);
      await appendFile(join(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      await this.writeProjection(workspaceId, runId, projection);
      return event;
    });
    await this.refreshRunIndexEntry(workspaceId, runId);
    return event;
  }

  async readEvents(workspaceId: string, runId: string): Promise<HarnessEvent[]> {
    const content = await readFile(join(this.runDirectory(workspaceId, runId), 'events.jsonl'), 'utf8');
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line) as HarnessEvent);
  }

  async writeProjection(workspaceId: string, runId: string, projection: RunProjection): Promise<void> {
    await atomicJson(join(this.runDirectory(workspaceId, runId), 'state.json'), projection);
  }

  async writeEvidence(workspaceId: string, runId: string, digest: string, content: string): Promise<string> {
    const path = join(this.runDirectory(workspaceId, runId), 'evidence', digest);
    try {
      await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
    }
    return path;
  }

  async readJson<T>(workspaceId: string, runId: string, relativePath: string): Promise<T> {
    return JSON.parse(await readFile(join(this.runDirectory(workspaceId, runId), relativePath), 'utf8')) as T;
  }

  async writeJson(workspaceId: string, runId: string, relativePath: string, value: unknown): Promise<void> {
    await atomicJson(join(this.runDirectory(workspaceId, runId), relativePath), value);
  }

  async writeText(workspaceId: string, runId: string, relativePath: string, value: string): Promise<void> {
    await atomicText(join(this.runDirectory(workspaceId, runId), relativePath), value);
  }

  async readText(workspaceId: string, runId: string, relativePath: string): Promise<string> {
    return readFile(join(this.runDirectory(workspaceId, runId), relativePath), 'utf8');
  }

  async listRuns(scope: 'all' | 'active' | 'archived' = 'all'): Promise<RunIndexEntry[]> {
    const index = await this.readRunIndex();
    if (scope === 'active') return index.runs.filter((entry) => entry.status !== 'completed');
    if (scope === 'archived') return index.runs.filter((entry) => entry.status === 'completed');
    return index.runs;
  }

  async rebuildRunIndex(): Promise<RunIndex> {
    await mkdir(this.indexDirectory(), { recursive: true, mode: 0o700 });
    return withFileLock(this.indexLockPath(), async () => {
      const index = await this.scanRunIndex();
      await atomicJson(this.indexPath(), index);
      return index;
    });
  }

  runDirectory(workspaceId: string, runId: string): string {
    return join(this.stateRoot, 'workspaces', workspaceId, 'runs', runId);
  }

  private indexDirectory(): string {
    return join(this.stateRoot, 'index');
  }

  private indexPath(): string {
    return join(this.indexDirectory(), 'runs.json');
  }

  private indexLockPath(): string {
    return join(this.indexDirectory(), '.runs.lock');
  }

  private async readRunIndex(): Promise<RunIndex> {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath(), 'utf8')) as unknown;
      if (isRunIndex(parsed)) return parsed;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    return this.rebuildRunIndex();
  }

  private async refreshRunIndexEntry(workspaceId: string, runId: string): Promise<void> {
    await mkdir(this.indexDirectory(), { recursive: true, mode: 0o700 });
    await withFileLock(this.indexLockPath(), async () => {
      let index: RunIndex;
      try {
        const parsed = JSON.parse(await readFile(this.indexPath(), 'utf8')) as unknown;
        index = isRunIndex(parsed) ? parsed : await this.scanRunIndex();
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        index = await this.scanRunIndex();
      }
      const entry = await this.buildRunIndexEntry(workspaceId, runId);
      index.runs = index.runs.filter((candidate) => candidate.runId !== runId || candidate.workspaceId !== workspaceId);
      index.runs.push(entry);
      index.runs.sort(sortRunIndexEntries);
      index.updatedAt = index.runs.reduce(
        (latest, candidate) => candidate.updatedAt > latest ? candidate.updatedAt : latest,
        '1970-01-01T00:00:00.000Z',
      );
      await atomicJson(this.indexPath(), index);
    });
  }

  private async scanRunIndex(): Promise<RunIndex> {
    const entries: RunIndexEntry[] = [];
    const workspacesDirectory = join(this.stateRoot, 'workspaces');
    let workspaces;
    try {
      workspaces = await readdir(workspacesDirectory, { withFileTypes: true });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') return { schemaVersion: 2, updatedAt: this.nowIso(), runs: [] };
      throw error;
    }
    for (const workspace of workspaces.filter((entry) => entry.isDirectory())) {
      const runsDirectory = join(workspacesDirectory, workspace.name, 'runs');
      let runs;
      try {
        runs = await readdir(runsDirectory, { withFileTypes: true });
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code === 'ENOENT') continue;
        throw error;
      }
      for (const run of runs.filter((entry) => entry.isDirectory())) {
        try {
          entries.push(await this.buildRunIndexEntry(workspace.name, run.name));
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? error.code : undefined;
          if (code !== 'ENOENT') throw error;
        }
      }
    }
    entries.sort(sortRunIndexEntries);
    return {
      schemaVersion: 2,
      updatedAt: entries.reduce((latest, entry) => entry.updatedAt > latest ? entry.updatedAt : latest, '1970-01-01T00:00:00.000Z'),
      runs: entries,
    };
  }

  private async buildRunIndexEntry(workspaceId: string, runId: string): Promise<RunIndexEntry> {
    const directory = this.runDirectory(workspaceId, runId);
    const [run, request, events] = await Promise.all([
      readFile(join(directory, 'run.json'), 'utf8').then((content) => JSON.parse(content) as Run),
      readFile(join(directory, 'request.json'), 'utf8').then((content) => JSON.parse(content) as Record<string, unknown>),
      this.readEvents(workspaceId, runId),
    ]);
    verifyEventChain(events);
    const projection = projectRun(events);
    const commitment = projection.activeCommitmentRevision === undefined
      ? undefined
      : projection.commitments[projection.activeCommitmentRevision];
    const acceptanceClaims = commitment?.acceptanceClaimIds.map((claimId) => projection.claims[claimId]).filter(Boolean) ?? [];
    const workspacePath = run.workspacePath ?? run.workspaceMount ?? run.workspace.id;
    return {
      schemaVersion: 2,
      runId,
      workspaceId,
      workspacePath,
      title: runTitle(request, projection),
      status: projection.status,
      needsAttention: projection.status === 'blocked' || Boolean(commitment?.unresolvedDecisions.length),
      createdAt: run.createdAt,
      updatedAt: projection.updatedAt,
      acceptanceSatisfied: acceptanceClaims.filter((claim) => claim?.status === 'satisfied' || claim?.status === 'waived').length,
      acceptanceTotal: acceptanceClaims.length,
      ...(projection.activeCommitmentRevision !== undefined ? { activeCommitmentRevision: projection.activeCommitmentRevision } : {}),
      ...(projection.activePlanRevision !== undefined ? { activePlanRevision: projection.activePlanRevision } : {}),
    };
  }

  private nowIso(): string {
    return new Date().toISOString();
  }
}

export class RunStore {
  private readonly now: () => Date;
  private readonly repository: RunRepository;

  constructor(options: RunStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.repository = options.repository ?? new LocalRunRepository(options.stateRoot);
  }

  async createRun(input: CreateRunInput): Promise<Run> {
    const workspacePath = await realpath(resolve(input.workspacePath));
    const workspace = input.workspace ?? { id: workspaceIdentity(workspacePath) };
    const run: Run = {
      schemaVersion: 2,
      id: randomUUID(),
      workspace,
      workspacePath,
      workspaceMount: workspacePath,
      createdAt: this.now().toISOString(),
      hostSessions: input.hostSessionId ? [input.hostSessionId] : [],
      ...(input.workspacePreparationId ? { workspacePreparationId: input.workspacePreparationId } : {}),
    };
    await this.repository.initialize(run, input.request, input.config);
    const traceId = randomUUID();
    await this.commitEvent(workspace.id, run.id, {
      type: 'run.created',
      traceId,
      spanId: randomUUID(),
      timestamp: run.createdAt,
      idempotencyKey: `run:${run.id}`,
      payload: { run },
    });
    await this.reviseCommitment(workspace.id, run.id, input.commitment, {
      traceId,
      spanId: randomUUID(),
      idempotencyKey: `commitment:${run.id}:1`,
    });
    return run;
  }

  async reviseCommitment(workspaceId: string, runId: string, draft: CommitmentDraft, context: CommandContext): Promise<Commitment> {
    const commandInputDigest = structuredInputDigest(draft);
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      this.assertSemanticReplay(replay, 'commitment.revised', commandInputDigest, context.idempotencyKey);
      return replay.payload.commitment as Commitment;
    }
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    const previousRevision = projection.activeCommitmentRevision;
    const revision = (previousRevision ?? 0) + 1;
    const commitmentId = randomUUID();
    const claims: Claim[] = draft.acceptance.map((acceptance) => ({
      id: randomUUID(),
      runId,
      commitmentId,
      description: acceptance.description,
      status: 'open',
      evidenceIds: [],
      createdAt: this.now().toISOString(),
    }));
    const commitment: Commitment = {
      id: commitmentId,
      runId,
      revision,
      objective: draft.objective,
      scope: draft.scope,
      authority: draft.authority,
      destination: draft.destination,
      acceptanceClaimIds: claims.map((claim) => claim.id),
      unresolvedDecisions: draft.unresolvedDecisions ?? [],
      createdAt: this.now().toISOString(),
      ...(previousRevision ? { supersedesRevision: previousRevision } : {}),
    };
    await this.commitEvent(workspaceId, runId, this.eventInput('commitment.revised', context, {
      commitment,
      claims,
      invalidatedClaimIds: Object.values(projection.claims).filter((claim) => claim.status === 'open').map((claim) => claim.id),
      ...(projection.activePlanRevision !== undefined ? { supersededPlanRevision: projection.activePlanRevision } : {}),
      commandInputDigest,
    }));
    return commitment;
  }

  async proposePlan(workspaceId: string, runId: string, commitmentRevision: number, nodes: PlannedNode[], context: CommandContext): Promise<Plan> {
    const commandInputDigest = structuredInputDigest({ commitmentRevision, nodes });
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      this.assertSemanticReplay(replay, 'plan.proposed', commandInputDigest, context.idempotencyKey);
      return replay.payload.plan as Plan;
    }
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    invariant(projection.activeCommitmentRevision === commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Plan must target the active Commitment revision');
    const commitment = projection.commitments[commitmentRevision]!;
    const acceptanceClaimIds = new Set(commitment.acceptanceClaimIds);
    const previouslyTargetedClaimIds = new Set(
      Object.values(projection.plans)
        .filter((plan) => plan.commitmentRevision === commitmentRevision)
        .flatMap((plan) => plan.nodes.flatMap((node) => node.targetClaimIds ?? [])),
    );
    const newlyTargetedClaimIds = new Set<string>();
    for (const node of nodes) {
      assertStructuredPayloadSize(`Planned node '${node.id}' input`, node.input ?? {});
      const targetClaimIds = node.targetClaimIds ?? [];
      invariant(new Set(targetClaimIds).size === targetClaimIds.length, 'DUPLICATE_TARGET_CLAIM', `Planned node '${node.id}' targets the same Claim more than once`);
      for (const claimId of targetClaimIds) {
        invariant(acceptanceClaimIds.has(claimId), 'UNREQUIRED_CLAIM', `Planned node '${node.id}' targets non-acceptance Claim '${claimId}'`);
        newlyTargetedClaimIds.add(claimId);
      }
    }
    const uncoveredClaimIds = commitment.acceptanceClaimIds.filter((claimId) => (
      projection.claims[claimId]?.status === 'open'
      && !previouslyTargetedClaimIds.has(claimId)
      && !newlyTargetedClaimIds.has(claimId)
    ));
    invariant(uncoveredClaimIds.length === 0, 'UNCOVERED_ACCEPTANCE_CLAIM', `Plan does not cover open acceptance Claim(s): ${uncoveredClaimIds.join(', ')}`);
    const revision = Math.max(0, ...Object.keys(projection.plans).map(Number)) + 1;
    const plan: Plan = {
      schemaVersion: 2,
      id: randomUUID(),
      runId,
      revision,
      commitmentRevision,
      status: 'proposed',
      createdAt: this.now().toISOString(),
      nodes,
    };
    await this.commitEvent(workspaceId, runId, this.eventInput('plan.proposed', context, { plan, commandInputDigest }));
    return plan;
  }

  async activatePlan(workspaceId: string, runId: string, planRevision: number, context: CommandContext): Promise<RunProjection> {
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      invariant(replay.type === 'plan.activated' && replay.payload.planRevision === planRevision, 'IDEMPOTENCY_CONFLICT', `Idempotency key '${context.idempotencyKey}' has different command input`);
      return this.getProjection(workspaceId, runId);
    }
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    await this.commitEvent(workspaceId, runId, this.eventInput('plan.activated', context, { planRevision }));
    return this.getProjection(workspaceId, runId);
  }

  async readyNodes(workspaceId: string, runId: string): Promise<PlannedNode[]> {
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    invariant(projection.activePlanRevision !== undefined, 'NO_ACTIVE_PLAN', 'Run has no active Plan');
    return readyPlannedNodes(projection.plans[projection.activePlanRevision]!, projection.nodeExecutions);
  }

  async readyNodeAssignments(workspaceId: string, runId: string): Promise<ReadyNodeAssignments> {
    const [projection, config, run] = await Promise.all([
      this.getProjection(workspaceId, runId),
      this.readConfigSnapshot(workspaceId, runId),
      this.repository.readJson<Run>(workspaceId, runId, 'run.json'),
    ]);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    invariant(projection.activeCommitmentRevision !== undefined, 'NO_ACTIVE_COMMITMENT', 'Run has no active Commitment');
    invariant(projection.activePlanRevision !== undefined, 'NO_ACTIVE_PLAN', 'Run has no active Plan');
    const plan = projection.plans[projection.activePlanRevision]!;
    const workspacePath = run.workspacePath ?? run.workspaceMount;
    invariant(workspacePath, 'WORKSPACE_PATH_MISSING', `Run '${runId}' has no workspace path`);
    const assignments: ReadyNodeAssignment[] = readyPlannedNodes(plan, projection.nodeExecutions).map((plannedNode) => {
      const definition = config.nodes[plannedNode.definitionId];
      invariant(definition, 'MISSING_NODE', `Run configuration snapshot has no Node Definition '${plannedNode.definitionId}'`);
      return { plannedNode, definition };
    });
    return {
      runId,
      workspace: { ...run.workspace, path: workspacePath },
      commitmentRevision: projection.activeCommitmentRevision,
      planRevision: projection.activePlanRevision,
      assignments,
    };
  }

  async startExecution(
    workspaceId: string,
    runId: string,
    plannedNodeId: string,
    commitmentRevision: number,
    planRevision: number,
    context: CommandContext,
  ): Promise<{ executionId: string; attempt: number }> {
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      invariant(
        replay.type === 'node.started'
        && replay.payload.plannedNodeId === plannedNodeId
        && replay.payload.commitmentRevision === commitmentRevision
        && replay.payload.planRevision === planRevision,
        'IDEMPOTENCY_CONFLICT',
        `Idempotency key '${context.idempotencyKey}' belongs to a different execution assignment`,
      );
      return { executionId: replay.payload.executionId as string, attempt: replay.payload.attempt as number };
    }
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    invariant(projection.activeCommitmentRevision === commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Execution must target the active Commitment revision');
    invariant(projection.activePlanRevision === planRevision, 'STALE_PLAN_REVISION', 'Execution must target the active Plan revision');
    const plan = projection.plans[planRevision];
    invariant(plan, 'PLAN_NOT_FOUND', `Plan revision ${planRevision} does not exist`);
    invariant(readyPlannedNodes(plan, projection.nodeExecutions).some((node) => node.id === plannedNodeId), 'NODE_NOT_READY', `Planned node '${plannedNodeId}' is not ready`);
    const attempts = projection.nodeExecutions.filter(
      (execution) => execution.planRevision === planRevision && execution.plannedNodeId === plannedNodeId,
    );
    const executionId = randomUUID();
    const attempt = attempts.length + 1;
    const plannedNode = plan.nodes.find((node) => node.id === plannedNodeId);
    invariant(plannedNode, 'PLANNED_NODE_NOT_FOUND', `Planned node '${plannedNodeId}' does not exist in the active Plan`);
    const config = await this.readConfigSnapshot(workspaceId, runId);
    const definition = config.nodes[plannedNode.definitionId];
    invariant(definition, 'MISSING_NODE', `Node Definition '${plannedNode.definitionId}' is absent from the Run configuration snapshot`);
    const input = plannedNode.input ?? {};
    assertPortValues(definition.inputs, input, `Planned node '${plannedNodeId}' input`);
    await this.commitEvent(workspaceId, runId, this.eventInput('node.started', context, {
      executionId,
      commitmentRevision,
      planRevision,
      plannedNodeId,
      attempt,
      input,
    }));
    return { executionId, attempt };
  }

  async retryExecution(
    workspaceId: string,
    runId: string,
    previousExecutionId: string,
    commitmentRevision: number,
    planRevision: number,
    reason: string,
    evidenceIds: string[],
    context: CommandContext,
  ): Promise<{ executionId: string; attempt: number }> {
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      invariant(
        replay.type === 'node.started'
        && replay.payload.retryOfExecutionId === previousExecutionId
        && replay.payload.commitmentRevision === commitmentRevision
        && replay.payload.planRevision === planRevision
        && replay.payload.retryReason === reason
        && JSON.stringify(replay.payload.retryEvidenceIds) === JSON.stringify(evidenceIds),
        'IDEMPOTENCY_CONFLICT',
        `Idempotency key '${context.idempotencyKey}' belongs to a different retry request`,
      );
      return { executionId: replay.payload.executionId as string, attempt: replay.payload.attempt as number };
    }
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    invariant(projection.activeCommitmentRevision === commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Retry must target the active Commitment revision');
    invariant(projection.activePlanRevision === planRevision, 'STALE_PLAN_REVISION', 'Retry must target the active Plan revision');
    invariant(reason.trim().length > 0, 'RETRY_REASON_REQUIRED', 'Retry requires a non-empty reason');
    invariant(evidenceIds.length > 0, 'RETRY_EVIDENCE_REQUIRED', 'Retry requires Evidence from the preceding attempt');
    const previous = projection.nodeExecutions.find((execution) => execution.id === previousExecutionId);
    invariant(previous, 'EXECUTION_NOT_FOUND', `Node execution '${previousExecutionId}' does not exist`);
    invariant(previous.planRevision === planRevision, 'PLAN_SCOPE_MISMATCH', `Node execution '${previousExecutionId}' belongs to another Plan revision`);
    invariant(['failed', 'blocked', 'cancelled', 'interrupted'].includes(previous.status), 'EXECUTION_NOT_RETRYABLE', `Node execution '${previousExecutionId}' cannot be retried from status '${previous.status}'`);
    const attempts = projection.nodeExecutions.filter(
      (execution) => execution.planRevision === planRevision && execution.plannedNodeId === previous.plannedNodeId,
    );
    invariant(Math.max(...attempts.map((execution) => execution.attempt)) === previous.attempt, 'RETRY_NOT_LATEST_ATTEMPT', 'Only the latest Node attempt can be retried');
    for (const evidenceId of evidenceIds) {
      const item = projection.evidence[evidenceId];
      invariant(item, 'MISSING_EVIDENCE', `Retry refers to missing Evidence '${evidenceId}'`);
      invariant(item.executionId === previousExecutionId, 'RETRY_EVIDENCE_SCOPE_MISMATCH', `Retry Evidence '${evidenceId}' must belong to the preceding execution`);
    }
    const plan = projection.plans[planRevision]!;
    const plannedNode = plan.nodes.find((node) => node.id === previous.plannedNodeId);
    invariant(plannedNode, 'PLANNED_NODE_NOT_FOUND', `Planned node '${previous.plannedNodeId}' does not exist in the active Plan`);
    const succeeded = new Set(projection.nodeExecutions
      .filter((execution) => execution.planRevision === planRevision && execution.status === 'succeeded')
      .map((execution) => execution.plannedNodeId));
    invariant(plannedNode.dependsOn.every((dependencyId) => succeeded.has(dependencyId)), 'NODE_NOT_READY', `Planned node '${plannedNode.id}' dependencies are not satisfied`);
    const config = await this.readConfigSnapshot(workspaceId, runId);
    const definition = config.nodes[plannedNode.definitionId];
    invariant(definition, 'MISSING_NODE', `Node Definition '${plannedNode.definitionId}' is absent from the Run configuration snapshot`);
    const input = plannedNode.input ?? {};
    assertPortValues(definition.inputs, input, `Planned node '${plannedNode.id}' input`);
    const executionId = randomUUID();
    const attempt = previous.attempt + 1;
    await this.commitEvent(workspaceId, runId, this.eventInput('node.started', context, {
      executionId,
      commitmentRevision,
      planRevision,
      plannedNodeId: plannedNode.id,
      attempt,
      input,
      retryOfExecutionId: previousExecutionId,
      retryReason: reason,
      retryEvidenceIds: evidenceIds,
    }));
    return { executionId, attempt };
  }

  async finishExecution(
    workspaceId: string,
    runId: string,
    executionId: string,
    status: Exclude<NodeExecutionStatus, 'ready' | 'running'>,
    evidenceIds: string[],
    context: CommandContext,
    output?: Record<string, unknown>,
    exportInputs: ExecutionExportInput[] = [],
  ): Promise<RunProjection> {
    if (output) assertStructuredPayloadSize(`Node execution '${executionId}' output`, output);
    if (status === 'succeeded') {
      const projection = await this.getProjection(workspaceId, runId);
      const execution = projection.nodeExecutions.find((candidate) => candidate.id === executionId);
      invariant(execution, 'EXECUTION_NOT_FOUND', `Node execution '${executionId}' does not exist`);
      const plan = projection.plans[execution.planRevision];
      const plannedNode = plan?.nodes.find((candidate) => candidate.id === execution.plannedNodeId);
      invariant(plannedNode, 'PLANNED_NODE_NOT_FOUND', `Planned node '${execution.plannedNodeId}' does not exist in Plan revision ${execution.planRevision}`);
      const config = await this.readConfigSnapshot(workspaceId, runId);
      const definition = config.nodes[plannedNode.definitionId];
      invariant(definition, 'MISSING_NODE', `Node Definition '${plannedNode.definitionId}' is absent from the Run configuration snapshot`);
      assertPortValues(definition.outputs, output ?? {}, `Node execution '${executionId}' output`);
    }
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    const exports = await this.prepareExecutionExports(workspaceId, runId, executionId, exportInputs, Boolean(replay));
    await this.commitEvent(workspaceId, runId, this.eventInput(
      `node.${status}` as EventInput['type'],
      context,
      { executionId, evidenceIds, ...(exports.length ? { exports } : {}), ...(output !== undefined ? { output } : {}) },
    ));
    return this.getProjection(workspaceId, runId);
  }

  async readConfigSnapshot(workspaceId: string, runId: string): Promise<ResolvedHarnessConfig> {
    const document = loadYaml(await this.repository.readText(workspaceId, runId, RUN_CONFIG_SNAPSHOT_PATH));
    invariant(typeof document === 'object' && document !== null, 'INVALID_CONFIG_SNAPSHOT', `Run '${runId}' has an invalid configuration snapshot`);
    return document as ResolvedHarnessConfig;
  }

  async getExecutionExport(
    workspaceId: string,
    runId: string,
    exportId: string,
  ): Promise<{ export: ExecutionExport; content: string }> {
    const projection = await this.getProjection(workspaceId, runId);
    const item = projection.nodeExecutions.flatMap((execution) => execution.exports ?? []).find((candidate) => candidate.id === exportId);
    invariant(item, 'EXPORT_NOT_FOUND', `Export '${exportId}' does not exist in Run '${runId}'`);
    const content = await this.repository.readText(workspaceId, runId, item.locator);
    invariant(createHash('sha256').update(content).digest('hex') === item.digest, 'EXPORT_DIGEST_MISMATCH', `Export '${exportId}' content does not match its digest`);
    return { export: item, content };
  }

  private async prepareExecutionExports(
    workspaceId: string,
    runId: string,
    executionId: string,
    inputs: ExecutionExportInput[],
    allowTerminalReplay = false,
  ): Promise<ExecutionExport[]> {
    if (inputs.length === 0) return [];
    const projection = await this.getProjection(workspaceId, runId);
    const execution = projection.nodeExecutions.find((candidate) => candidate.id === executionId);
    invariant(execution && (execution.status === 'running' || allowTerminalReplay), 'EXECUTION_NOT_RUNNING', `Node execution '${executionId}' is not running`);
    const plan = projection.plans[execution.planRevision];
    invariant(plan, 'PLAN_NOT_FOUND', `Plan revision ${execution.planRevision} does not exist`);
    const run = await this.repository.readJson<Run>(workspaceId, runId, 'run.json');
    const workspacePath = run.workspacePath ?? run.workspaceMount;
    invariant(workspacePath, 'WORKSPACE_PATH_MISSING', `Run '${runId}' has no workspace path`);
    const canonicalWorkspace = await realpath(workspacePath);
    const prepared: ExecutionExport[] = [];
    for (const [index, input] of inputs.entries()) {
      invariant(input.name.trim().length > 0, 'INVALID_EXPORT_NAME', 'Export name must be non-empty');
      invariant(['application/json', 'text/markdown'].includes(input.mediaType), 'UNSUPPORTED_EXPORT_MEDIA_TYPE', `Export '${input.name}' has unsupported media type '${input.mediaType}'`);
      invariant((input.content !== undefined) !== (input.sourcePath !== undefined), 'INVALID_EXPORT_SOURCE', `Export '${input.name}' must provide exactly one of content or sourcePath`);
      let content: string;
      let sourceLocator: string | undefined;
      if (input.sourcePath) {
        const requested = resolve(canonicalWorkspace, input.sourcePath);
        const canonicalSource = await realpath(requested);
        const pathFromWorkspace = relative(canonicalWorkspace, canonicalSource);
        invariant(pathFromWorkspace !== '..' && !pathFromWorkspace.startsWith(`..${sep}`) && !isAbsolute(pathFromWorkspace), 'EXPORT_SOURCE_OUTSIDE_WORKSPACE', `Export '${input.name}' source must stay inside the Run workspace`);
        content = await readFile(canonicalSource, 'utf8');
        sourceLocator = pathFromWorkspace;
      } else {
        content = input.content!;
      }
      const sizeBytes = Buffer.byteLength(content);
      invariant(sizeBytes <= MAX_EXPORT_BYTES, 'EXPORT_TOO_LARGE', `Export '${input.name}' exceeds ${MAX_EXPORT_BYTES} bytes`);
      if (input.mediaType === 'application/json') {
        try { JSON.parse(content); } catch { throw new Error(`Export '${input.name}' must contain valid JSON`); }
      }
      const digest = createHash('sha256').update(content).digest('hex');
      const id = createHash('sha256').update(JSON.stringify({ executionId, index, name: input.name, mediaType: input.mediaType, digest })).digest('hex');
      const extension = input.mediaType === 'text/markdown' ? 'md' : 'json';
      const locator = `exports/${id}.${extension}`;
      await this.repository.writeText(workspaceId, runId, locator, content);
      prepared.push({
        id,
        runId,
        executionId,
        commitmentRevision: plan.commitmentRevision,
        name: input.name,
        mediaType: input.mediaType,
        digest,
        locator,
        ...(sourceLocator ? { sourceLocator } : {}),
        ...(input.role ? { role: input.role } : {}),
        sizeBytes,
      });
    }
    return prepared;
  }

  async recordEvidence(workspaceId: string, runId: string, input: EvidenceInput, context: CommandContext): Promise<Evidence> {
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    const execution = projection.nodeExecutions.find((candidate) => candidate.id === input.executionId);
    invariant(execution, 'EXECUTION_NOT_FOUND', `Node execution '${input.executionId}' does not exist`);
    const plan = projection.plans[execution.planRevision];
    invariant(plan, 'PLAN_NOT_FOUND', `Plan revision ${execution.planRevision} does not exist`);
    invariant(projection.activeCommitmentRevision === plan.commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Evidence must target an execution from the active Commitment revision');
    const digest = createHash('sha256').update(input.content).digest('hex');
    const locator = await this.repository.writeEvidence(workspaceId, runId, digest, input.content);
    const envelope = {
      runId,
      kind: input.kind,
      summary: input.summary,
      digest,
      commitmentRevision: plan.commitmentRevision,
      executionId: execution.id,
      planRevision: execution.planRevision,
      plannedNodeId: execution.plannedNodeId,
      inputDigest: structuredInputDigest(execution.input ?? {}),
    };
    const evidenceId = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    const existing = projection.evidence[evidenceId];
    if (existing) return existing;
    const evidence: Evidence = {
      id: evidenceId,
      ...envelope,
      locator,
      createdAt: this.now().toISOString(),
    };
    await this.commitEvent(workspaceId, runId, this.eventInput('evidence.recorded', context, { evidence }));
    return evidence;
  }

  async updateClaim(
    workspaceId: string,
    runId: string,
    claimId: string,
    status: Exclude<ClaimStatus, 'open'>,
    evidenceIds: string[],
    context: CommandContext,
  ): Promise<Claim> {
    if (status === 'waived') {
      const projection = await this.getProjection(workspaceId, runId);
      const commitment = projection.activeCommitmentRevision ? projection.commitments[projection.activeCommitmentRevision] : undefined;
      invariant(commitment?.authority.includes('waive-claims'), 'CLAIM_WAIVER_UNAUTHORIZED', 'Current Commitment does not authorize Claim waivers');
    }
    await this.commitEvent(workspaceId, runId, this.eventInput(`claim.${status}` as EventInput['type'], context, { claimId, evidenceIds }));
    return (await this.getProjection(workspaceId, runId)).claims[claimId]!;
  }

  async completeRun(
    workspaceId: string,
    runId: string,
    commitmentRevision: number,
    planRevision: number,
    destination: string,
    context: CommandContext,
  ): Promise<RunProjection> {
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      invariant(
        replay.type === 'run.completed'
        && replay.payload.commitmentRevision === commitmentRevision
        && replay.payload.planRevision === planRevision
        && replay.payload.destination === destination,
        'IDEMPOTENCY_CONFLICT',
        `Idempotency key '${context.idempotencyKey}' has different command input`,
      );
      await this.ensureRetrospective(workspaceId, runId, context.traceId, context.spanId);
      return this.getProjection(workspaceId, runId);
    }
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.status !== 'completed', 'RUN_ALREADY_COMPLETED', `Run '${runId}' is already completed`);
    invariant(projection.activeCommitmentRevision === commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Completion must target the active Commitment revision');
    invariant(projection.activePlanRevision === planRevision, 'STALE_PLAN_REVISION', 'Completion must target the active Plan revision');
    invariant(projection.commitmentAcceptanceSatisfied, 'ACCEPTANCE_INCOMPLETE', 'Current Commitment acceptance Claims are incomplete');
    invariant(!projection.nodeExecutions.some((execution) => execution.status === 'running'), 'RUN_HAS_ACTIVE_EXECUTIONS', 'Run completion requires every running execution to reach a terminal status');
    const commitment = projection.commitments[commitmentRevision]!;
    invariant(commitment.destination === destination, 'DESTINATION_MISMATCH', `Completion destination must be '${commitment.destination}'`);
    invariant(commitment.authority.includes(`deliver:${destination}`), 'DELIVERY_UNAUTHORIZED', `Current Commitment does not authorize delivery to '${destination}'`);
    await this.commitEvent(workspaceId, runId, this.eventInput('run.completed', context, { commitmentRevision, planRevision, destination }));
    await this.ensureRetrospective(workspaceId, runId, context.traceId, context.spanId);
    return this.getProjection(workspaceId, runId);
  }

  async recordResourceActivation(workspaceId: string, runId: string, resourceId: string, digest: string, context: CommandContext, revision?: string): Promise<void> {
    await this.commitEvent(workspaceId, runId, this.eventInput('resource.activated', context, {
      resourceId,
      digest,
      ...(revision ? { revision } : {}),
    }));
  }

  async recordResourceFeedback(
    workspaceId: string,
    runId: string,
    resourceId: string,
    category: string,
    summary: string,
    evidenceIds: string[],
    context: CommandContext,
  ): Promise<void> {
    const projection = await this.getProjection(workspaceId, runId);
    for (const evidenceId of evidenceIds) {
      invariant(projection.evidence[evidenceId], 'MISSING_EVIDENCE', `Resource feedback refers to missing Evidence '${evidenceId}'`);
    }
    await this.commitEvent(workspaceId, runId, this.eventInput('resource.feedback.recorded', context, {
      resourceId,
      category,
      summary,
      evidenceIds,
    }));
  }

  async recoverInterrupted(workspaceId: string, runId: string, traceId: string): Promise<RunProjection> {
    const projection = await this.getProjection(workspaceId, runId);
    for (const execution of projection.nodeExecutions.filter((candidate) => candidate.status === 'running')) {
      await this.commitEvent(workspaceId, runId, {
        type: 'node.interrupted',
        traceId,
        spanId: randomUUID(),
        idempotencyKey: `interrupt:${execution.id}`,
        payload: { executionId: execution.id, evidenceIds: [] },
      });
    }
    return this.getProjection(workspaceId, runId);
  }

  async getProjection(workspaceId: string, runId: string): Promise<RunProjection> {
    return projectRun(await this.readEvents(workspaceId, runId));
  }

  async rebuildProjection(workspaceId: string, runId: string): Promise<RunProjection> {
    const projection = await this.getProjection(workspaceId, runId);
    await this.repository.writeProjection(workspaceId, runId, projection);
    return projection;
  }

  async listRuns(scope: 'all' | 'active' | 'archived' = 'all'): Promise<RunIndexEntry[]> {
    return this.repository.listRuns(scope);
  }

  async rebuildRunIndex(): Promise<RunIndex> {
    return this.repository.rebuildRunIndex();
  }

  async readEvents(workspaceId: string, runId: string): Promise<HarnessEvent[]> {
    const events = await this.repository.readEvents(workspaceId, runId);
    verifyEventChain(events);
    return events;
  }

  async ensureRetrospective(workspaceId: string, runId: string, traceId: string, parentSpanId: string): Promise<RunRetrospective> {
    const events = await this.readEvents(workspaceId, runId);
    const existing = events.find((event) => event.type === 'retrospective.generated');
    if (existing) return this.repository.readJson(workspaceId, runId, 'retrospective.json');
    invariant(events.some((event) => event.type === 'run.completed'), 'RUN_NOT_COMPLETED', 'Retrospective requires a completed Run');
    const resourceLock = Object.fromEntries(events
      .filter((event) => event.type === 'resource.activated' && typeof event.payload.resourceId === 'string')
      .map((event) => [event.payload.resourceId as string, { digest: typeof event.payload.digest === 'string' ? event.payload.digest : null }]));
    const generatedAt = this.now().toISOString();
    const generated = buildRetrospective(runId, events, resourceLock, generatedAt);
    for (const proposal of generated.proposals) {
      await this.repository.writeJson(workspaceId, runId, `proposals/${proposal.id}.json`, proposal);
      await this.commitEvent(workspaceId, runId, {
        type: 'resource.change.proposed',
        traceId,
        spanId: randomUUID(),
        parentSpanId,
        idempotencyKey: `proposal:${proposal.id}`,
        payload: { proposalId: proposal.id, resourceId: proposal.resourceId, summary: proposal.problem.summary },
      });
    }
    await this.repository.writeJson(workspaceId, runId, 'retrospective.json', generated.retrospective);
    await this.repository.writeText(
      workspaceId,
      runId,
      'reports/retrospective.md',
      buildRetrospectiveReport(await this.getProjection(workspaceId, runId), generated.retrospective, generated.proposals),
    );
    await this.commitEvent(workspaceId, runId, {
      type: 'retrospective.generated',
      traceId,
      spanId: randomUUID(),
      parentSpanId,
      idempotencyKey: `retrospective:${generated.retrospective.id}`,
      payload: {
        retrospectiveId: generated.retrospective.id,
        observationCount: generated.retrospective.observations.length,
        proposalIds: generated.retrospective.proposalIds,
      },
    });
    return generated.retrospective;
  }

  async getRetrospective(workspaceId: string, runId: string): Promise<{ retrospective: RunRetrospective; proposals: ResourceProposal[] }> {
    const retrospective = await this.repository.readJson<RunRetrospective>(workspaceId, runId, 'retrospective.json');
    const projection = await this.getProjection(workspaceId, runId);
    const proposals = await Promise.all(retrospective.proposalIds.map(async (proposalId) => {
      const proposal = await this.repository.readJson<ResourceProposal>(workspaceId, runId, `proposals/${proposalId}.json`);
      const projected = projection.resourceProposals[proposalId];
      return projected ? { ...proposal, status: projected.status } : proposal;
    }));
    return { retrospective, proposals };
  }

  async getRetrospectiveReport(workspaceId: string, runId: string): Promise<string> {
    const { retrospective, proposals } = await this.getRetrospective(workspaceId, runId);
    return buildRetrospectiveReport(await this.getProjection(workspaceId, runId), retrospective, proposals);
  }

  async decideProposal(
    workspaceId: string,
    runId: string,
    proposalId: string,
    decision: Exclude<ResourceProposalStatus, 'proposed'>,
    context: CommandContext,
    reason?: string,
  ): Promise<ResourceProposal> {
    const proposal = await this.repository.readJson<ResourceProposal>(workspaceId, runId, `proposals/${proposalId}.json`);
    const commandInputDigest = structuredInputDigest({ proposalId, decision, reason: reason ?? null });
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) {
      this.assertSemanticReplay(replay, decision === 'accepted' ? 'resource.change.accepted' : 'resource.change.rejected', commandInputDigest, context.idempotencyKey);
      return { ...proposal, status: decision, decision: { decidedAt: replay.timestamp, ...(reason ? { reason } : {}) } };
    }
    const current = (await this.getProjection(workspaceId, runId)).resourceProposals[proposalId];
    invariant(current, 'UNKNOWN_PROPOSAL', `Unknown proposal '${proposalId}'`);
    invariant(current.status === 'proposed' || current.status === decision, 'PROPOSAL_ALREADY_DECIDED', `Proposal '${proposalId}' is already ${current.status}`);
    if (current.status === 'proposed') {
      await this.commitEvent(workspaceId, runId, this.eventInput(
        decision === 'accepted' ? 'resource.change.accepted' : 'resource.change.rejected',
        context,
        { proposalId, commandInputDigest, ...(reason ? { reason } : {}) },
      ));
    }
    const decided = { ...proposal, status: decision, decision: { decidedAt: this.now().toISOString(), ...(reason ? { reason } : {}) } };
    const { retrospective, proposals } = await this.getRetrospective(workspaceId, runId);
    await this.repository.writeText(
      workspaceId,
      runId,
      'reports/retrospective.md',
      buildRetrospectiveReport(await this.getProjection(workspaceId, runId), retrospective, proposals),
    );
    return decided;
  }

  runDirectory(workspaceId: string, runId: string): string {
    return this.repository.runDirectory(workspaceId, runId);
  }

  private eventInput(type: EventInput['type'], context: CommandContext, payload: Record<string, unknown>, idempotencyKey = context.idempotencyKey): EventInput {
    return {
      type,
      traceId: context.traceId,
      spanId: context.spanId,
      idempotencyKey,
      payload,
      ...(context.parentSpanId ? { parentSpanId: context.parentSpanId } : {}),
    };
  }

  private assertSemanticReplay(replay: HarnessEvent, type: EventInput['type'], commandInputDigest: string, idempotencyKey: string): void {
    invariant(
      replay.type === type && replay.payload.commandInputDigest === commandInputDigest,
      'IDEMPOTENCY_CONFLICT',
      `Idempotency key '${idempotencyKey}' has different command input`,
    );
  }

  private async findEventByKey(workspaceId: string, runId: string, idempotencyKey: string): Promise<HarnessEvent | undefined> {
    return (await this.readEvents(workspaceId, runId)).find((event) => event.idempotencyKey === idempotencyKey);
  }

  private async commitEvent(workspaceId: string, runId: string, input: EventInput): Promise<HarnessEvent> {
    return this.repository.commitEvent(workspaceId, runId, { ...input, timestamp: input.timestamp ?? this.now().toISOString() });
  }

  static async workspaceId(workspacePath: string): Promise<string> {
    return workspaceIdentity(await realpath(resolve(workspacePath)));
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
