import { invariant } from './errors.js';
import { materializeStage, readyNodes, type MaterializedNodeInstance } from './graph.js';
import type { ResolvedHarnessConfig, RunProjection, Stage } from './types.js';

export const MAX_NODE_ATTEMPTS = 2;
export const MAX_STAGE_VISITS = 3;

export type StageDecision =
  | 'aligned'
  | 'needs_alignment'
  | 'implementation_complete'
  | 'verification_passed'
  | 'verification_rejected'
  | 'delivery_approved'
  | 'delivery_rejected';

export interface Transition {
  nextStage?: Stage;
  completed: boolean;
}

export function transition(stage: Stage, decision: StageDecision): Transition {
  if (decision === 'needs_alignment') return { nextStage: 'align', completed: false };
  if (stage === 'align' && decision === 'aligned') return { nextStage: 'execute', completed: false };
  if (stage === 'execute' && decision === 'implementation_complete') return { nextStage: 'verify', completed: false };
  if (stage === 'verify' && decision === 'verification_passed') return { nextStage: 'deliver', completed: false };
  if (stage === 'verify' && decision === 'verification_rejected') return { nextStage: 'execute', completed: false };
  if (stage === 'deliver' && decision === 'delivery_approved') return { completed: true };
  if (stage === 'deliver' && decision === 'delivery_rejected') return { nextStage: 'execute', completed: false };
  throw new Error(`Decision '${decision}' is invalid for stage '${stage}'`);
}

export function assertWithinLoopLimits(projection: RunProjection, stage: Stage, nodeId?: string): void {
  invariant((projection.stageVisits[stage] ?? 0) < MAX_STAGE_VISITS, 'STAGE_VISIT_LIMIT', `Stage '${stage}' reached the ${MAX_STAGE_VISITS}-visit limit`);
  if (nodeId) {
    const attempts = projection.nodeExecutions.filter((execution) => execution.stage === stage && execution.nodeId === nodeId).length;
    invariant(attempts < MAX_NODE_ATTEMPTS, 'NODE_ATTEMPT_LIMIT', `Node '${nodeId}' reached the ${MAX_NODE_ATTEMPTS}-attempt limit in stage '${stage}'`);
  }
}

export function readyWorkflowNodes(
  config: ResolvedHarnessConfig,
  workflowId: string,
  stage: Stage,
  completed: ReadonlySet<string>,
  started: ReadonlySet<string>,
): MaterializedNodeInstance[] {
  const workflow = config.workflows[workflowId];
  if (!workflow) throw new Error(`Unknown workflow '${workflowId}'`);
  return readyNodes(materializeStage(stage, workflow.stages[stage] ?? []), completed, started);
}

export interface RehydrationPlan {
  workflowRules: string[];
  knowledgeMetadata: string[];
  currentNodeSkills: string[];
  activatedResources: string[];
}

export function buildRehydrationPlan(
  config: ResolvedHarnessConfig,
  workflowId: string,
  currentNodeIds: string[],
  activatedResources: string[],
): RehydrationPlan {
  const workflow = config.workflows[workflowId];
  if (!workflow) throw new Error(`Unknown workflow '${workflowId}'`);
  const currentNodeSkills = currentNodeIds.flatMap((nodeId) => {
    const node = config.nodes[nodeId];
    if (!node) throw new Error(`Unknown node '${nodeId}'`);
    return node.executor.type === 'agent' ? node.executor.skills ?? [] : [];
  });
  return {
    workflowRules: [...(workflow.rules ?? [])],
    knowledgeMetadata: [...(workflow.knowledge ?? [])],
    currentNodeSkills: [...new Set(currentNodeSkills)],
    activatedResources: [...new Set(activatedResources)],
  };
}
