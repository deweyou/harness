import { assertClaimDecision, assertCommitmentRevision, assertNodeExecution, assertPlanRevision, isCommitmentAccepted } from '../runtime.js';
import type { Claim, Commitment, Evidence, HarnessEvent, NodeExecution, NodeExecutionStatus, Plan, Run, RunProjection } from '../types.js';

const NODE_TERMINAL = new Map<string, NodeExecutionStatus>([
  ['node.succeeded', 'succeeded'],
  ['node.failed', 'failed'],
  ['node.blocked', 'blocked'],
  ['node.cancelled', 'cancelled'],
  ['node.skipped', 'skipped'],
  ['node.interrupted', 'interrupted'],
]);

function stringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Event payload.${key} must be a non-empty string`);
  return value;
}

function numberValue(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`Event payload.${key} must be a positive integer`);
  return value;
}

function stringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new Error(`Event payload.${key} must be a string array`);
  return value;
}

function objectValue<T extends object>(payload: Record<string, unknown>, key: string): T {
  const value = payload[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Event payload.${key} must be an object`);
  return value as T;
}

function latestByRevision(values: Iterable<Commitment>): Commitment | undefined {
  return [...values].sort((left, right) => right.revision - left.revision)[0];
}

function latestByVersion(values: Iterable<Plan>): Plan | undefined {
  return [...values].sort((left, right) => right.revision - left.revision)[0];
}

function activeExecutionTime(executions: readonly NodeExecution[]): number {
  const intervals = executions
    .filter((execution) => execution.startedAt && execution.endedAt)
    .map((execution) => [Date.parse(execution.startedAt!), Date.parse(execution.endedAt!)] as const)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let intervalStart: number | undefined;
  let intervalEnd: number | undefined;
  for (const [start, end] of intervals) {
    if (intervalStart === undefined || intervalEnd === undefined) {
      intervalStart = start;
      intervalEnd = end;
    } else if (start <= intervalEnd) {
      intervalEnd = Math.max(intervalEnd, end);
    } else {
      total += intervalEnd - intervalStart;
      intervalStart = start;
      intervalEnd = end;
    }
  }
  return intervalStart === undefined || intervalEnd === undefined ? total : total + intervalEnd - intervalStart;
}

export function projectRun(events: HarnessEvent[]): RunProjection {
  if (events.length === 0) throw new Error('Cannot project an empty Run');
  const first = events[0]!;
  if (first.type !== 'run.created') throw new Error('The first Run event must be run.created');
  const run = objectValue<Run>(first.payload, 'run');
  if (run.id !== first.runId) throw new Error(`Run event scope '${first.runId}' does not match Run '${run.id}'`);

  const commitments = new Map<number, Commitment>();
  const plans = new Map<number, Plan>();
  const claims: Record<string, Claim> = {};
  const evidence: Record<string, Evidence> = {};
  const executions = new Map<string, NodeExecution>();
  const nodeStatuses: RunProjection['nodeStatuses'] = {};
  const activatedResources = new Set<string>();
  const resourceProposals: RunProjection['resourceProposals'] = {};
  let retrospective: RunProjection['retrospective'];
  let activeCommitmentRevision: number | undefined;
  let activePlanRevision: number | undefined;
  let completedAt: string | undefined;

  for (const event of events.slice(1)) {
    if (event.runId !== run.id) throw new Error(`Event '${event.id}' belongs to another Run`);
    if (
      completedAt &&
      !['retrospective.generated', 'resource.feedback.recorded', 'resource.change.proposed', 'resource.change.accepted', 'resource.change.rejected'].includes(event.type)
    ) {
      throw new Error(`Run '${run.id}' is already completed`);
    }
    if (event.type === 'commitment.revised') {
      const commitment = objectValue<Commitment>(event.payload, 'commitment');
      if (commitments.has(commitment.revision)) throw new Error(`Duplicate Commitment revision ${commitment.revision}`);
      assertCommitmentRevision(run, commitment, latestByRevision(commitments.values()));
      const supersededPlanRevision = event.payload.supersededPlanRevision;
      if (activePlanRevision !== undefined) {
        if (supersededPlanRevision !== activePlanRevision) throw new Error(`Commitment revision must supersede active Plan revision ${activePlanRevision}`);
        const activePlan = plans.get(activePlanRevision)!;
        plans.set(activePlanRevision, { ...activePlan, status: 'superseded' });
      } else if (supersededPlanRevision !== undefined) {
        throw new Error('Commitment revision cannot supersede a Plan when none is active');
      }
      const invalidatedClaimIds = event.payload.invalidatedClaimIds === undefined ? [] : stringArray(event.payload, 'invalidatedClaimIds');
      const openClaimIds = Object.values(claims).filter((claim) => claim.status === 'open').map((claim) => claim.id).sort();
      if (JSON.stringify([...invalidatedClaimIds].sort()) !== JSON.stringify(openClaimIds)) {
        throw new Error('Commitment revision must invalidate every open Claim atomically');
      }
      for (const claimId of invalidatedClaimIds) {
        claims[claimId] = { ...claims[claimId]!, status: 'invalidated', decidedAt: event.timestamp };
      }
      commitments.set(commitment.revision, commitment);
      activeCommitmentRevision = commitment.revision;
      activePlanRevision = undefined;
      const openedClaims = event.payload.claims;
      if (openedClaims !== undefined) {
        if (!Array.isArray(openedClaims)) throw new Error('Event payload.claims must be an array');
        for (const claim of openedClaims as Claim[]) {
          if (claim.status !== 'open') throw new Error(`New Claim '${claim.id}' must be open`);
          if (claims[claim.id]) throw new Error(`Duplicate Claim '${claim.id}'`);
          assertClaimDecision(commitment, claim, evidence);
          claims[claim.id] = claim;
        }
      }
    } else if (event.type === 'plan.proposed') {
      const plan = objectValue<Plan>(event.payload, 'plan');
      if (plans.has(plan.revision)) throw new Error(`Duplicate Plan revision ${plan.revision}`);
      const commitment = commitments.get(plan.commitmentRevision);
      if (!commitment) throw new Error(`Plan '${plan.id}' refers to unknown Commitment revision ${plan.commitmentRevision}`);
      assertPlanRevision(run, commitment, plan, latestByVersion(plans.values()));
      plans.set(plan.revision, plan);
      for (const node of plan.nodes) nodeStatuses[`${plan.revision}:${node.id}`] = 'pending';
    } else if (event.type === 'plan.activated') {
      const planRevision = numberValue(event.payload, 'planRevision');
      const plan = plans.get(planRevision);
      if (!plan) throw new Error(`Unknown Plan revision ${planRevision}`);
      if (plan.status !== 'proposed') throw new Error(`Plan revision ${planRevision} is already ${plan.status}`);
      if (plan.commitmentRevision !== activeCommitmentRevision) throw new Error(`Plan revision ${planRevision} does not target the active Commitment revision`);
      for (const [revision, existing] of plans) {
        if (existing.status === 'active') plans.set(revision, { ...existing, status: 'superseded' });
      }
      plans.set(planRevision, { ...plan, status: 'active' });
      activePlanRevision = planRevision;
    } else if (event.type === 'plan.superseded') {
      const planRevision = numberValue(event.payload, 'planRevision');
      const plan = plans.get(planRevision);
      if (!plan) throw new Error(`Unknown Plan revision ${planRevision}`);
      plans.set(planRevision, { ...plan, status: 'superseded' });
      if (activePlanRevision === planRevision) activePlanRevision = undefined;
    } else if (event.type === 'evidence.recorded') {
      const item = objectValue<Evidence>(event.payload, 'evidence');
      if (item.runId !== run.id) throw new Error(`Evidence '${item.id}' belongs to another Run`);
      if (evidence[item.id]) throw new Error(`Duplicate Evidence '${item.id}'`);
      evidence[item.id] = item;
    } else if (event.type === 'claim.opened') {
      const claim = objectValue<Claim>(event.payload, 'claim');
      if (claim.status !== 'open') throw new Error(`New Claim '${claim.id}' must be open`);
      if (claims[claim.id]) throw new Error(`Duplicate Claim '${claim.id}'`);
      const commitment = [...commitments.values()].find((candidate) => candidate.id === claim.commitmentId);
      if (!commitment) throw new Error(`Claim '${claim.id}' refers to unknown Commitment '${claim.commitmentId}'`);
      assertClaimDecision(commitment, claim, evidence);
      claims[claim.id] = claim;
    } else if (event.type === 'claim.satisfied' || event.type === 'claim.invalidated' || event.type === 'claim.waived') {
      const claimId = stringValue(event.payload, 'claimId');
      const current = claims[claimId];
      if (!current) throw new Error(`Unknown Claim '${claimId}'`);
      if (current.status !== 'open') throw new Error(`Claim '${claimId}' is already ${current.status}`);
      const status = event.type.slice('claim.'.length) as Claim['status'];
      const updated: Claim = {
        ...current,
        status,
        decidedAt: event.timestamp,
        ...(status === 'satisfied' || status === 'waived' ? { evidenceIds: stringArray(event.payload, 'evidenceIds') } : {}),
      };
      const commitment = [...commitments.values()].find((candidate) => candidate.id === updated.commitmentId)!;
      assertClaimDecision(commitment, updated, evidence);
      claims[claimId] = updated;
    } else if (event.type === 'node.ready') {
      const planRevision = numberValue(event.payload, 'planRevision');
      const plannedNodeId = stringValue(event.payload, 'plannedNodeId');
      const plan = plans.get(planRevision);
      if (!plan?.nodes.some((node) => node.id === plannedNodeId)) throw new Error(`Unknown planned node '${plannedNodeId}' in Plan ${planRevision}`);
      nodeStatuses[`${planRevision}:${plannedNodeId}`] = 'ready';
    } else if (event.type === 'node.started') {
      const execution: NodeExecution = {
        id: stringValue(event.payload, 'executionId'),
        runId: run.id,
        planRevision: numberValue(event.payload, 'planRevision'),
        plannedNodeId: stringValue(event.payload, 'plannedNodeId'),
        attempt: numberValue(event.payload, 'attempt'),
        status: 'running',
        evidenceIds: [],
        startedAt: event.timestamp,
      };
      if (executions.has(execution.id)) throw new Error(`Duplicate node execution '${execution.id}'`);
      const plan = plans.get(execution.planRevision);
      if (!plan) throw new Error(`Node execution '${execution.id}' refers to unknown Plan ${execution.planRevision}`);
      assertNodeExecution(plan, execution, [...executions.values()]);
      executions.set(execution.id, execution);
      nodeStatuses[`${execution.planRevision}:${execution.plannedNodeId}`] = 'running';
    } else if (NODE_TERMINAL.has(event.type)) {
      const executionId = stringValue(event.payload, 'executionId');
      const current = executions.get(executionId);
      if (!current) throw new Error(`Terminal event refers to unknown node execution '${executionId}'`);
      if (current.status !== 'running') throw new Error(`Node execution '${executionId}' is already terminal`);
      const terminalStatus = NODE_TERMINAL.get(event.type)!;
      const evidenceIds = event.payload.evidenceIds === undefined ? [] : stringArray(event.payload, 'evidenceIds');
      for (const evidenceId of evidenceIds) if (!evidence[evidenceId]) throw new Error(`Node execution '${executionId}' refers to missing Evidence '${evidenceId}'`);
      const endedAt = Date.parse(event.timestamp);
      const startedAt = Date.parse(current.startedAt!);
      const updated: NodeExecution = {
        ...current,
        status: terminalStatus,
        evidenceIds,
        endedAt: event.timestamp,
        durationMs: Math.max(0, endedAt - startedAt),
      };
      executions.set(executionId, updated);
      nodeStatuses[`${updated.planRevision}:${updated.plannedNodeId}`] = terminalStatus;
    } else if (event.type === 'resource.activated') {
      activatedResources.add(stringValue(event.payload, 'resourceId'));
    } else if (event.type === 'run.completed') {
      const activeCommitment = activeCommitmentRevision ? commitments.get(activeCommitmentRevision) : undefined;
      const commitmentRevision = numberValue(event.payload, 'commitmentRevision');
      const planRevision = numberValue(event.payload, 'planRevision');
      const destination = stringValue(event.payload, 'destination');
      if (commitmentRevision !== activeCommitmentRevision) throw new Error('Run completion targets a stale Commitment revision');
      if (planRevision !== activePlanRevision || plans.get(planRevision)?.status !== 'active') {
        throw new Error('Run completion requires the active Plan revision');
      }
      if (!activeCommitment || !isCommitmentAccepted(activeCommitment, claims, evidence)) {
        throw new Error('Run completion requires the active Commitment acceptance Claims to be satisfied');
      }
      if (destination !== activeCommitment.destination || !activeCommitment.authority.includes(`deliver:${destination}`)) {
        throw new Error(`Run completion is not authorized for destination '${destination}'`);
      }
      completedAt = event.timestamp;
    } else if (event.type === 'resource.change.proposed') {
      const proposalId = stringValue(event.payload, 'proposalId');
      resourceProposals[proposalId] = {
        resourceId: stringValue(event.payload, 'resourceId'),
        status: 'proposed',
        summary: stringValue(event.payload, 'summary'),
      };
    } else if (event.type === 'resource.change.accepted' || event.type === 'resource.change.rejected') {
      const proposalId = stringValue(event.payload, 'proposalId');
      const proposal = resourceProposals[proposalId];
      if (!proposal) throw new Error(`Decision refers to unknown resource proposal '${proposalId}'`);
      const decision = event.type === 'resource.change.accepted' ? 'accepted' : 'rejected';
      if (proposal.status !== 'proposed' && proposal.status !== decision) throw new Error(`Resource proposal '${proposalId}' already has decision '${proposal.status}'`);
      proposal.status = decision;
    } else if (event.type === 'retrospective.generated') {
      const proposalIds = stringArray(event.payload, 'proposalIds');
      const observationCount = event.payload.observationCount;
      if (typeof observationCount !== 'number' || !Number.isInteger(observationCount) || observationCount < 0) {
        throw new Error('Event payload.observationCount must be a non-negative integer');
      }
      retrospective = { id: stringValue(event.payload, 'retrospectiveId'), observationCount, proposalIds };
    }
  }

  const activeCommitment = activeCommitmentRevision ? commitments.get(activeCommitmentRevision) : undefined;
  const nodeExecutions = [...executions.values()];
  const isCompleted = activeCommitment ? isCommitmentAccepted(activeCommitment, claims, evidence) : false;
  const isBlocked = activePlanRevision !== undefined && nodeExecutions.some(
    (execution) => execution.planRevision === activePlanRevision && execution.status === 'blocked',
  );
  const last = events.at(-1)!;
  const projection: RunProjection = {
    schemaVersion: 2,
    runId: run.id,
    status: completedAt ? 'completed' : isBlocked ? 'blocked' : 'running',
    commitmentAcceptanceSatisfied: isCompleted,
    commitments: Object.fromEntries(commitments),
    plans: Object.fromEntries(plans),
    claims,
    evidence,
    nodeExecutions,
    nodeStatuses,
    activatedResources: [...activatedResources],
    resourceProposals,
    lastSequence: last.sequence,
    updatedAt: last.timestamp,
    timing: {
      wallTimeMs: Math.max(0, Date.parse(last.timestamp) - Date.parse(first.timestamp)),
      executionTimeMs: nodeExecutions.reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0),
      retryTimeMs: nodeExecutions.filter((execution) => execution.attempt > 1).reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0),
      criticalPathMs: activeExecutionTime(nodeExecutions),
    },
    ...(activeCommitmentRevision ? { activeCommitmentRevision } : {}),
    ...(activePlanRevision !== undefined ? { activePlanRevision } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(retrospective ? { retrospective } : {}),
  };
  return projection;
}
