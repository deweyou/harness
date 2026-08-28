export type ResourceKind = 'skill' | 'context';

export interface ResourceSource { repo?: string; entry: string }

export interface ResourceDefinition {
  source: ResourceSource;
}

export type PortSchema = Record<string, unknown> & { description: string };

interface NodeDefinitionBase {
  description: string;
  inputs?: Record<string, PortSchema>;
  outputs?: Record<string, PortSchema>;
  authority?: string[];
}

export interface AgentNodeDefinition extends NodeDefinitionBase {
  kind: 'agent';
  skill?: string[];
}

export interface CommandNodeDefinition extends NodeDefinitionBase {
  kind: 'command';
  command: string;
}

export type NodeDefinition = AgentNodeDefinition | CommandNodeDefinition;

export interface HarnessImport { path: string; as?: string }
export type WorkspaceStrategy = 'branch' | 'worktree';
export interface HarnessConfig {
  version: 3;
  strategy?: WorkspaceStrategy;
  imports?: Array<string | HarnessImport>;
  context?: Record<string, ResourceDefinition>;
  skills?: Record<string, ResourceDefinition>;
  nodes?: Record<string, NodeDefinition>;
}
export interface ResolvedHarnessConfig {
  version: 3;
  strategy: WorkspaceStrategy;
  sourceFiles: string[];
  context: Record<string, ResourceDefinition>;
  skills: Record<string, ResourceDefinition>;
  nodes: Record<string, NodeDefinition>;
}

export type ClaimStatus = 'open' | 'satisfied' | 'invalidated' | 'waived';

export interface WorkspaceRef {
  id: string;
  repository?: string;
  revision?: string;
}

export interface Run {
  schemaVersion: 2;
  id: string;
  workspace: WorkspaceRef;
  workspacePath?: string;
  workspaceMount?: string;
  createdAt: string;
  hostSessions: string[];
  workspacePreparationId?: string;
}

export interface RunIndexEntry {
  schemaVersion: 2;
  runId: string;
  workspaceId: string;
  workspacePath: string;
  title: string;
  status: RunProjection['status'];
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
  activeCommitmentRevision?: number;
  activePlanRevision?: number;
  acceptanceSatisfied: number;
  acceptanceTotal: number;
}

export interface RunIndex {
  schemaVersion: 2;
  updatedAt: string;
  runs: RunIndexEntry[];
}

export interface Commitment {
  id: string;
  runId: string;
  revision: number;
  objective: string;
  scope: string[];
  authority: string[];
  destination: string;
  acceptanceClaimIds: string[];
  unresolvedDecisions: string[];
  createdAt: string;
  supersedesRevision?: number;
}

export interface Claim {
  id: string;
  runId: string;
  commitmentId: string;
  description: string;
  status: ClaimStatus;
  evidenceIds: string[];
  createdAt: string;
  decidedAt?: string;
}

export interface Evidence {
  id: string;
  runId: string;
  kind: string;
  summary: string;
  createdAt: string;
  digest: string;
  locator: string;
  commitmentRevision: number;
  executionId: string;
  planRevision: number;
  plannedNodeId: string;
  inputDigest: string;
}

export type ExecutionExportMediaType = 'application/json' | 'text/markdown';

export interface ExecutionExport {
  id: string;
  runId: string;
  executionId: string;
  commitmentRevision: number;
  name: string;
  mediaType: ExecutionExportMediaType;
  digest: string;
  locator: string;
  sourceLocator?: string;
  role?: string;
  sizeBytes: number;
}

export const PLAN_PHASES = ['planning', 'implementation', 'integration', 'verification', 'delivery'] as const;
export type PlanPhase = typeof PLAN_PHASES[number];

export interface PlannedNode {
  id: string;
  definitionId: string;
  phase?: PlanPhase;
  dependsOn: string[];
  input?: Record<string, unknown>;
  targetClaimIds?: string[];
  authority?: string[];
}

export interface ReadyNodeAssignment {
  plannedNode: PlannedNode;
  definition: NodeDefinition;
}

export interface ReadyNodeAssignments {
  runId: string;
  workspace: WorkspaceRef & { path: string };
  commitmentRevision: number;
  planRevision: number;
  assignments: ReadyNodeAssignment[];
}

export interface Plan {
  schemaVersion: 2;
  id: string;
  runId: string;
  revision: number;
  commitmentRevision: number;
  status: 'proposed' | 'active' | 'superseded';
  createdAt: string;
  nodes: PlannedNode[];
}

export type NodeExecutionStatus =
  | 'ready'
  | 'running'
  | 'blocked'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'interrupted';

export interface NodeExecution {
  id: string;
  runId: string;
  planRevision: number;
  plannedNodeId: string;
  attempt: number;
  status: NodeExecutionStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  evidenceIds: string[];
  retryOfExecutionId?: string;
  retryReason?: string;
  retryEvidenceIds?: string[];
  exports?: ExecutionExport[];
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

export type HarnessEventType =
  | 'run.created'
  | 'commitment.revised'
  | 'plan.proposed'
  | 'plan.activated'
  | 'plan.superseded'
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
  | 'claim.opened'
  | 'claim.satisfied'
  | 'claim.invalidated'
  | 'claim.waived'
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
  schemaVersion: 2;
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  previousHash: string | null;
  hash: string;
}

export type RunMetadata = Run;
export type ResourceProposalStatus = 'proposed' | 'accepted' | 'rejected';

export interface ResourceProposal {
  schemaVersion: 2;
  id: string;
  runId: string;
  resourceId: string;
  resourceKind: ResourceKind | 'rule' | 'knowledge' | 'unknown';
  baseDigest: string | null;
  status: ResourceProposalStatus;
  createdAt: string;
  evidenceEventIds: string[];
  problem: { categories: string[]; summary: string };
  suggestion: { summary: string };
  validation: { replayRunIds: string[]; acceptance: string };
  decision?: { decidedAt: string; reason?: string };
}

export interface RunRetrospective {
  schemaVersion: 2;
  id: string;
  runId: string;
  createdAt: string;
  observations: Array<{ eventId: string; resourceId: string; category: string; summary: string }>;
  proposalIds: string[];
}

export interface RunProjection {
  schemaVersion: 2;
  runId: string;
  status: 'running' | 'blocked' | 'completed';
  commitmentAcceptanceSatisfied: boolean;
  completedAt?: string;
  activeCommitmentRevision?: number;
  activePlanRevision?: number;
  commitments: Record<number, Commitment>;
  plans: Record<number, Plan>;
  claims: Record<string, Claim>;
  evidence: Record<string, Evidence>;
  nodeExecutions: NodeExecution[];
  nodeStatuses: Record<string, NodeExecutionStatus | 'pending'>;
  activatedResources: string[];
  retrospective?: { id: string; observationCount: number; proposalIds: string[] };
  resourceProposals: Record<string, { resourceId: string; status: ResourceProposalStatus; summary: string }>;
  lastSequence: number;
  updatedAt: string;
  timing: {
    wallTimeMs: number;
    executionTimeMs: number;
    retryTimeMs: number;
    criticalPathMs: number;
  };
}
