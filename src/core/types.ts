export const STAGES = ['align', 'execute', 'verify', 'deliver'] as const;
export type Stage = (typeof STAGES)[number];

export type ResourceKind = 'skill' | 'rule' | 'knowledge';

export interface WorkspaceSource {
  type: 'workspace';
  path: string;
}

export interface RegistrySource {
  type: 'registry';
  repo: string;
  skill: string;
}

export interface GitSource {
  type: 'git';
  repo: string;
  path: string;
  ref?: string;
}

export type ResourceSource = WorkspaceSource | RegistrySource | GitSource;

export interface ResourceDefinition {
  kind: ResourceKind;
  description?: string;
  source: ResourceSource;
}

export interface AgentExecutor {
  type: 'agent';
  skills?: string[];
}

export interface CommandExecutor {
  type: 'command';
  command: string;
}

export type Executor = AgentExecutor | CommandExecutor;

export interface NodeDefinition {
  name?: string;
  description?: string;
  executor: Executor;
}

export interface NodeInstance {
  use: string;
  id?: string;
  needs?: string[];
  with?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  selectable?: boolean;
  extends?: string;
  rules?: string[];
  knowledge?: string[];
  stages?: Partial<Record<Stage, NodeInstance[]>>;
}

export interface HarnessImport {
  path: string;
  as?: string;
}

export interface HarnessConfig {
  version: 1;
  imports?: Array<string | HarnessImport>;
  resources?: Record<string, ResourceDefinition>;
  nodes?: Record<string, NodeDefinition>;
  workflows?: Record<string, WorkflowDefinition>;
}

export interface ResolvedWorkflow extends Omit<WorkflowDefinition, 'selectable' | 'extends'> {
  selectable: boolean;
  stages: Partial<Record<Stage, NodeInstance[]>>;
}

export interface ResolvedHarnessConfig {
  version: 1;
  sourceFiles: string[];
  resources: Record<string, ResourceDefinition>;
  nodes: Record<string, NodeDefinition>;
  workflows: Record<string, ResolvedWorkflow>;
}

export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'interrupted';

export type HarnessEventType =
  | 'run.created'
  | 'workflow.selected'
  | 'stage.started'
  | 'stage.completed'
  | 'node.ready'
  | 'node.started'
  | 'node.succeeded'
  | 'node.failed'
  | 'node.blocked'
  | 'node.cancelled'
  | 'node.skipped'
  | 'node.interrupted'
  | 'resource.activated'
  | 'resource.feedback.recorded'
  | 'evidence.recorded'
  | 'decision.recorded'
  | 'run.completed'
  | 'retrospective.generated'
  | 'resource.change.proposed'
  | 'resource.change.accepted'
  | 'resource.change.rejected';

export interface EventInput {
  type: HarnessEventType;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  payload: Record<string, unknown>;
  timestamp?: string;
  idempotencyKey?: string;
}

export interface HarnessEvent extends EventInput {
  schemaVersion: 1;
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  previousHash: string | null;
  hash: string;
}

export interface RunMetadata {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  workspacePath: string;
  workflowId: string;
  createdAt: string;
  hostSessions: string[];
}

export interface NodeExecutionState {
  nodeExecutionId: string;
  nodeId: string;
  stage: Stage;
  stageVisit: number;
  attempt: number;
  status: NodeStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

export interface StageVisitState {
  stage: Stage;
  stageVisit: number;
  status: 'running' | 'completed';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export type ResourceProposalStatus = 'proposed' | 'accepted' | 'rejected';

export interface ResourceProposal {
  schemaVersion: 1;
  id: string;
  runId: string;
  resourceId: string;
  resourceKind: ResourceKind | 'unknown';
  baseDigest: string | null;
  status: ResourceProposalStatus;
  createdAt: string;
  evidenceEventIds: string[];
  problem: {
    categories: string[];
    summary: string;
  };
  suggestion: {
    summary: string;
  };
  validation: {
    replayRunIds: string[];
    acceptance: string;
  };
  decision?: {
    decidedAt: string;
    reason?: string;
  };
}

export interface RunRetrospective {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  observations: Array<{
    eventId: string;
    resourceId: string;
    category: string;
    summary: string;
  }>;
  proposalIds: string[];
}

export interface RunProjection {
  schemaVersion: 1;
  runId: string;
  status: 'running' | 'blocked' | 'completed';
  currentStage?: Stage;
  stageVisits: Partial<Record<Stage, number>>;
  stageVisitExecutions: StageVisitState[];
  nodeExecutions: NodeExecutionState[];
  nodeStatuses: Record<string, NodeStatus>;
  activatedResources: string[];
  evidenceIds: string[];
  retrospective?: {
    id: string;
    observationCount: number;
    proposalIds: string[];
  };
  resourceProposals: Record<string, { resourceId: string; status: ResourceProposalStatus; summary: string }>;
  lastSequence: number;
  updatedAt: string;
  timing: {
    wallTimeMs: number;
    executionTimeMs: number;
    retryTimeMs: number;
    reworkTimeMs: number;
    criticalPathMs: number;
  };
}
