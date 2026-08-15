import type { HarnessEvent, NodeExecutionState, NodeStatus, RunProjection, Stage, StageVisitState } from '../types.js';

const NODE_TERMINAL = new Map<string, NodeExecutionState['status']>([
  ['node.succeeded', 'succeeded'],
  ['node.failed', 'failed'],
  ['node.blocked', 'blocked'],
  ['node.cancelled', 'cancelled'],
  ['node.skipped', 'skipped'],
  ['node.interrupted', 'interrupted'],
]);

function stringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') throw new Error(`Event payload.${key} must be a string`);
  return value;
}

function numberValue(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`Event payload.${key} must be a positive integer`);
  return value;
}

export function projectRun(events: HarnessEvent[]): RunProjection {
  if (events.length === 0) throw new Error('Cannot project an empty run');
  const first = events[0]!;
  const executions = new Map<string, NodeExecutionState>();
  const stageExecutionMap = new Map<string, StageVisitState>();
  const nodeStatuses: Record<string, NodeStatus> = {};
  const stageVisits: Partial<Record<Stage, number>> = {};
  const activatedResources = new Set<string>();
  const evidenceIds = new Set<string>();
  const resourceProposals: RunProjection['resourceProposals'] = {};
  let retrospective: RunProjection['retrospective'];
  let status: RunProjection['status'] = 'running';
  let currentStage: Stage | undefined;

  for (const event of events) {
    if (event.type === 'run.created') {
      const plannedNodes = event.payload.plannedNodes;
      if (Array.isArray(plannedNodes)) {
        for (const planned of plannedNodes) {
          if (typeof planned === 'object' && planned !== null && 'stage' in planned && 'nodeId' in planned) {
            const stage = String(planned.stage);
            const nodeId = String(planned.nodeId);
            nodeStatuses[`${stage}:${nodeId}`] = 'pending';
          }
        }
      }
    } else if (event.type === 'stage.started') {
      currentStage = stringValue(event.payload, 'stage') as Stage;
      const stageVisit = numberValue(event.payload, 'stageVisit');
      stageVisits[currentStage] = Math.max(stageVisits[currentStage] ?? 0, stageVisit);
      const key = `${currentStage}:${stageVisit}`;
      if (stageExecutionMap.has(key)) throw new Error(`Duplicate stage visit '${key}'`);
      stageExecutionMap.set(key, { stage: currentStage, stageVisit, status: 'running', startedAt: event.timestamp });
    } else if (event.type === 'stage.completed') {
      const stage = stringValue(event.payload, 'stage') as Stage;
      const stageVisit = numberValue(event.payload, 'stageVisit');
      const stageExecution = stageExecutionMap.get(`${stage}:${stageVisit}`);
      if (!stageExecution || stageExecution.status === 'completed') throw new Error(`Unknown or completed stage visit '${stage}:${stageVisit}'`);
      stageExecution.status = 'completed';
      stageExecution.endedAt = event.timestamp;
      stageExecution.durationMs = Math.max(0, Date.parse(event.timestamp) - Date.parse(stageExecution.startedAt));
    } else if (event.type === 'node.ready') {
      const stage = stringValue(event.payload, 'stage');
      const nodeId = stringValue(event.payload, 'nodeId');
      nodeStatuses[`${stage}:${nodeId}`] = 'ready';
    } else if (event.type === 'node.started') {
      const nodeExecutionId = stringValue(event.payload, 'nodeExecutionId');
      if (executions.has(nodeExecutionId)) throw new Error(`Duplicate node execution '${nodeExecutionId}'`);
      executions.set(nodeExecutionId, {
        nodeExecutionId,
        nodeId: stringValue(event.payload, 'nodeId'),
        stage: stringValue(event.payload, 'stage') as Stage,
        stageVisit: numberValue(event.payload, 'stageVisit'),
        attempt: numberValue(event.payload, 'attempt'),
        status: 'running',
        startedAt: event.timestamp,
      });
      nodeStatuses[`${stringValue(event.payload, 'stage')}:${stringValue(event.payload, 'nodeId')}`] = 'running';
    } else if (NODE_TERMINAL.has(event.type)) {
      const nodeExecutionId = stringValue(event.payload, 'nodeExecutionId');
      const execution = executions.get(nodeExecutionId);
      if (!execution) throw new Error(`Terminal event refers to unknown node execution '${nodeExecutionId}'`);
      if (execution.status !== 'running') throw new Error(`Node execution '${nodeExecutionId}' is already terminal`);
      const endedAt = Date.parse(event.timestamp);
      const startedAt = Date.parse(execution.startedAt!);
      execution.status = NODE_TERMINAL.get(event.type)!;
      execution.endedAt = event.timestamp;
      execution.durationMs = Math.max(0, endedAt - startedAt);
      nodeStatuses[`${execution.stage}:${execution.nodeId}`] = execution.status;
      if (execution.status === 'blocked') status = 'blocked';
    } else if (event.type === 'resource.activated') {
      activatedResources.add(stringValue(event.payload, 'resourceId'));
    } else if (event.type === 'evidence.recorded') {
      evidenceIds.add(stringValue(event.payload, 'evidenceId'));
    } else if (event.type === 'run.completed') {
      status = 'completed';
      currentStage = undefined;
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
      if (proposal.status !== 'proposed' && proposal.status !== decision) {
        throw new Error(`Resource proposal '${proposalId}' already has decision '${proposal.status}'`);
      }
      proposal.status = decision;
    } else if (event.type === 'retrospective.generated') {
      const proposalIds = event.payload.proposalIds;
      const observationCount = event.payload.observationCount;
      if (!Array.isArray(proposalIds) || !proposalIds.every((value) => typeof value === 'string')) {
        throw new Error('Event payload.proposalIds must be a string array');
      }
      if (typeof observationCount !== 'number' || !Number.isInteger(observationCount) || observationCount < 0) {
        throw new Error('Event payload.observationCount must be a non-negative integer');
      }
      retrospective = {
        id: stringValue(event.payload, 'retrospectiveId'),
        observationCount,
        proposalIds,
      };
    }
  }

  const nodeExecutions = [...executions.values()];
  const executionTimeMs = nodeExecutions.reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
  const retryTimeMs = nodeExecutions.filter((execution) => execution.attempt > 1).reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
  const reworkTimeMs = nodeExecutions.filter((execution) => execution.stageVisit > 1).reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
  const intervals = nodeExecutions
    .filter((execution) => execution.startedAt && execution.endedAt)
    .map((execution) => [Date.parse(execution.startedAt!), Date.parse(execution.endedAt!)] as const)
    .sort((left, right) => left[0] - right[0]);
  let criticalPathMs = 0;
  let intervalStart: number | undefined;
  let intervalEnd: number | undefined;
  for (const [start, end] of intervals) {
    if (intervalStart === undefined || intervalEnd === undefined) {
      intervalStart = start;
      intervalEnd = end;
    } else if (start <= intervalEnd) {
      intervalEnd = Math.max(intervalEnd, end);
    } else {
      criticalPathMs += intervalEnd - intervalStart;
      intervalStart = start;
      intervalEnd = end;
    }
  }
  if (intervalStart !== undefined && intervalEnd !== undefined) criticalPathMs += intervalEnd - intervalStart;
  const last = events.at(-1)!;
  const projection: RunProjection = {
    schemaVersion: 1,
    runId: first.runId,
    status,
    stageVisits,
    stageVisitExecutions: [...stageExecutionMap.values()],
    nodeExecutions,
    nodeStatuses,
    activatedResources: [...activatedResources],
    evidenceIds: [...evidenceIds],
    resourceProposals,
    lastSequence: last.sequence,
    updatedAt: last.timestamp,
    timing: {
      wallTimeMs: Math.max(0, Date.parse(last.timestamp) - Date.parse(first.timestamp)),
      executionTimeMs,
      retryTimeMs,
      reworkTimeMs,
      criticalPathMs,
    },
    ...(currentStage ? { currentStage } : {}),
    ...(retrospective ? { retrospective } : {}),
  };
  return projection;
}
