import { invariant } from './errors.js';
import { PLAN_PHASES, type NodeExecution, type Plan, type PlannedNode } from './types.js';

export function validatePlanGraph(plan: Plan): void {
  const nodesById = new Map<string, PlannedNode>();
  for (const node of plan.nodes) {
    invariant(node.id.length > 0, 'INVALID_PLANNED_NODE', 'Planned node id cannot be empty');
    invariant(node.definitionId.length > 0, 'INVALID_PLANNED_NODE', `Planned node '${node.id}' must reference a definition`);
    invariant(node.phase === undefined || PLAN_PHASES.includes(node.phase), 'INVALID_PLAN_PHASE', `Planned node '${node.id}' has invalid phase '${node.phase}'`);
    invariant(!nodesById.has(node.id), 'DUPLICATE_PLANNED_NODE', `Plan ${plan.revision} has duplicate node '${node.id}'`);
    nodesById.set(node.id, node);
  }

  for (const node of plan.nodes) {
    const dependencies = new Set<string>();
    for (const dependencyId of node.dependsOn) {
      invariant(dependencyId !== node.id, 'SELF_DEPENDENCY', `Planned node '${node.id}' cannot depend on itself`);
      invariant(nodesById.has(dependencyId), 'MISSING_DEPENDENCY', `Planned node '${node.id}' depends on missing node '${dependencyId}'`);
      invariant(!dependencies.has(dependencyId), 'DUPLICATE_DEPENDENCY', `Planned node '${node.id}' repeats dependency '${dependencyId}'`);
      dependencies.add(dependencyId);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    invariant(!visiting.has(nodeId), 'DAG_CYCLE', `Plan ${plan.revision} contains a dependency cycle at '${nodeId}'`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependencyId of nodesById.get(nodeId)?.dependsOn ?? []) visit(dependencyId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodesById.keys()) visit(nodeId);
}

export function readyPlannedNodes(plan: Plan, executions: readonly NodeExecution[]): PlannedNode[] {
  validatePlanGraph(plan);
  const currentExecutions = executions.filter((execution) => execution.runId === plan.runId && execution.planRevision === plan.revision);
  const succeeded = new Set(currentExecutions.filter((execution) => execution.status === 'succeeded').map((execution) => execution.plannedNodeId));
  const attempted = new Set(currentExecutions.map((execution) => execution.plannedNodeId));
  return plan.nodes.filter(
    (node) => !attempted.has(node.id) && node.dependsOn.every((dependencyId) => succeeded.has(dependencyId)),
  );
}
