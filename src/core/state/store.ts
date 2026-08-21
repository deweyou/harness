import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, appendFile, mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dump as dumpYaml } from 'js-yaml';
import { invariant } from '../errors.js';
import { readyPlannedNodes } from '../graph.js';
import { buildRetrospective } from '../retrospective.js';
import type {
  Claim,
  ClaimStatus,
  Commitment,
  EventInput,
  Evidence,
  HarnessEvent,
  NodeExecutionStatus,
  Plan,
  PlannedNode,
  ResolvedHarnessConfig,
  ResourceProposal,
  ResourceProposalStatus,
  Run,
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
}

export interface CommandContext {
  traceId: string;
  spanId: string;
  idempotencyKey: string;
  parentSpanId?: string;
}

export interface EvidenceInput {
  content: string;
  kind: string;
  summary: string;
  commitmentRevision: number;
  inputDigests?: Record<string, string>;
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

function verifyEventChain(events: HarnessEvent[]): void {
  let previousHash: string | null = null;
  for (const [index, event] of events.entries()) {
    invariant(event.schemaVersion === 2, 'UNSUPPORTED_EVENT_VERSION', `Event ${index + 1} is not v2`);
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

export class LocalRunRepository implements RunRepository {
  constructor(private readonly stateRoot = join(homedir(), '.deweyou', 'harness')) {}

  async initialize(run: Run, request: Record<string, unknown>, config: ResolvedHarnessConfig): Promise<void> {
    const directory = this.runDirectory(run.workspace.id, run.id);
    await Promise.all([
      mkdir(join(directory, 'evidence'), { recursive: true, mode: 0o700 }),
      mkdir(join(directory, 'proposals'), { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      atomicJson(join(directory, 'run.json'), run),
      atomicJson(join(directory, 'request.json'), request),
      writeFile(join(directory, 'config.snapshot.yaml'), dumpYaml(config, { noRefs: true }), { mode: 0o600 }),
      writeFile(join(directory, 'events.jsonl'), '', { mode: 0o600, flag: 'wx' }),
    ]);
  }

  async commitEvent(workspaceId: string, runId: string, input: EventInput): Promise<HarnessEvent> {
    const directory = this.runDirectory(workspaceId, runId);
    await access(join(directory, 'run.json'));
    return withFileLock(join(directory, '.events.lock'), async () => {
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

  runDirectory(workspaceId: string, runId: string): string {
    return join(this.stateRoot, 'workspaces', workspaceId, 'runs', runId);
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
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) return replay.payload.commitment as Commitment;
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
    }));
    return commitment;
  }

  async proposePlan(workspaceId: string, runId: string, commitmentRevision: number, nodes: PlannedNode[], context: CommandContext): Promise<Plan> {
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) return replay.payload.plan as Plan;
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.activeCommitmentRevision === commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Plan must target the active Commitment revision');
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
    await this.commitEvent(workspaceId, runId, this.eventInput('plan.proposed', context, { plan }));
    return plan;
  }

  async activatePlan(workspaceId: string, runId: string, planRevision: number, context: CommandContext): Promise<RunProjection> {
    await this.commitEvent(workspaceId, runId, this.eventInput('plan.activated', context, { planRevision }));
    return this.getProjection(workspaceId, runId);
  }

  async readyNodes(workspaceId: string, runId: string): Promise<PlannedNode[]> {
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.activePlanRevision !== undefined, 'NO_ACTIVE_PLAN', 'Run has no active Plan');
    return readyPlannedNodes(projection.plans[projection.activePlanRevision]!, projection.nodeExecutions);
  }

  async startExecution(workspaceId: string, runId: string, plannedNodeId: string, context: CommandContext): Promise<{ executionId: string; attempt: number }> {
    const replay = await this.findEventByKey(workspaceId, runId, context.idempotencyKey);
    if (replay) return { executionId: replay.payload.executionId as string, attempt: replay.payload.attempt as number };
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.activePlanRevision !== undefined, 'NO_ACTIVE_PLAN', 'Run has no active Plan');
    invariant((await this.readyNodes(workspaceId, runId)).some((node) => node.id === plannedNodeId), 'NODE_NOT_READY', `Planned node '${plannedNodeId}' is not ready`);
    const attempts = projection.nodeExecutions.filter(
      (execution) => execution.planRevision === projection.activePlanRevision && execution.plannedNodeId === plannedNodeId,
    );
    const executionId = randomUUID();
    const attempt = attempts.length + 1;
    await this.commitEvent(workspaceId, runId, this.eventInput('node.started', context, {
      executionId,
      planRevision: projection.activePlanRevision,
      plannedNodeId,
      attempt,
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
  ): Promise<RunProjection> {
    await this.commitEvent(workspaceId, runId, this.eventInput(`node.${status}` as EventInput['type'], context, { executionId, evidenceIds }));
    return this.getProjection(workspaceId, runId);
  }

  async recordEvidence(workspaceId: string, runId: string, input: EvidenceInput, context: CommandContext): Promise<Evidence> {
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.activeCommitmentRevision === input.commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Evidence must target the active Commitment revision');
    const digest = createHash('sha256').update(input.content).digest('hex');
    const locator = await this.repository.writeEvidence(workspaceId, runId, digest, input.content);
    const envelope = {
      runId,
      kind: input.kind,
      summary: input.summary,
      digest,
      commitmentRevision: input.commitmentRevision,
      inputDigests: input.inputDigests ?? {},
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
    const projection = await this.getProjection(workspaceId, runId);
    invariant(projection.activeCommitmentRevision === commitmentRevision, 'STALE_COMMITMENT_REVISION', 'Completion must target the active Commitment revision');
    invariant(projection.activePlanRevision === planRevision, 'STALE_PLAN_REVISION', 'Completion must target the active Plan revision');
    invariant(projection.commitmentAcceptanceSatisfied, 'ACCEPTANCE_INCOMPLETE', 'Current Commitment acceptance Claims are incomplete');
    const commitment = projection.commitments[commitmentRevision]!;
    invariant(commitment.destination === destination, 'DESTINATION_MISMATCH', `Completion destination must be '${commitment.destination}'`);
    invariant(commitment.authority.includes(`deliver:${destination}`), 'DELIVERY_UNAUTHORIZED', `Current Commitment does not authorize delivery to '${destination}'`);
    await this.commitEvent(workspaceId, runId, this.eventInput('run.completed', context, { commitmentRevision, planRevision, destination }));
    await this.ensureRetrospective(workspaceId, runId, context.traceId, context.spanId);
    return this.getProjection(workspaceId, runId);
  }

  async recordResourceActivation(workspaceId: string, runId: string, resourceId: string, digest: string, context: CommandContext): Promise<void> {
    await this.commitEvent(workspaceId, runId, this.eventInput('resource.activated', context, { resourceId, digest }));
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

  async decideProposal(
    workspaceId: string,
    runId: string,
    proposalId: string,
    decision: Exclude<ResourceProposalStatus, 'proposed'>,
    context: CommandContext,
    reason?: string,
  ): Promise<ResourceProposal> {
    const proposal = await this.repository.readJson<ResourceProposal>(workspaceId, runId, `proposals/${proposalId}.json`);
    const current = (await this.getProjection(workspaceId, runId)).resourceProposals[proposalId];
    invariant(current, 'UNKNOWN_PROPOSAL', `Unknown proposal '${proposalId}'`);
    invariant(current.status === 'proposed' || current.status === decision, 'PROPOSAL_ALREADY_DECIDED', `Proposal '${proposalId}' is already ${current.status}`);
    if (current.status === 'proposed') {
      await this.commitEvent(workspaceId, runId, this.eventInput(
        decision === 'accepted' ? 'resource.change.accepted' : 'resource.change.rejected',
        context,
        { proposalId, ...(reason ? { reason } : {}) },
      ));
    }
    return { ...proposal, status: decision, decision: { decidedAt: this.now().toISOString(), ...(reason ? { reason } : {}) } };
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
