export type ResourceKind = 'skill' | 'rule' | 'knowledge';

export interface WorkspaceSource { type: 'workspace'; path: string }
export interface RegistrySource { type: 'registry'; repo: string; skill: string }
export interface GitSource { type: 'git'; repo: string; path: string; ref?: string }
export type ResourceSource = WorkspaceSource | RegistrySource | GitSource;

export interface ResourceDefinition {
  kind: ResourceKind;
  description?: string;
  source: ResourceSource;
}

export interface AgentExecutor { kind: 'agent'; skills?: string[]; config?: Record<string, unknown> }
export interface CommandExecutor { kind: 'command'; argv: string[]; cwd?: string }
export interface CapabilityExecutor { kind: 'capability'; capability: string; config?: Record<string, unknown> }
export type Executor = AgentExecutor | CommandExecutor | CapabilityExecutor;

export interface ExecutionPolicy {
  idempotent: boolean;
  timeoutMs?: number;
  retry?: { maxAttempts: number; backoffMs?: number };
}

export interface NodeDefinition {
  name?: string;
  description?: string;
  executor: Executor;
  resources?: string[];
  inputs?: string[];
  outputs?: string[];
  claimTypes?: string[];
  artifactTypes?: string[];
  authority?: string[];
  executionPolicy?: ExecutionPolicy;
}

export interface HarnessImport { path: string; as?: string }
export interface HarnessConfig {
  version: 2;
  imports?: Array<string | HarnessImport>;
  resources?: Record<string, ResourceDefinition>;
  nodes?: Record<string, NodeDefinition>;
}
export interface ResolvedHarnessConfig {
  version: 2;
  sourceFiles: string[];
  resources: Record<string, ResourceDefinition>;
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
  inputDigests: Record<string, string>;
}

export interface PlannedNode {
  id: string;
  definitionId: string;
  dependsOn: string[];
  input?: Record<string, unknown>;
  targetClaimIds?: string[];
  expectedOutputs?: string[];
  authority?: string[];
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
  evidenceIds: string[];
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
  resourceKind: ResourceKind | 'unknown';
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
