import { invariant } from './errors.js';
import type { NodeInstance, Stage } from './types.js';

export interface MaterializedNodeInstance extends NodeInstance {
  id: string;
  needs: string[];
}

export function materializeStage(stage: Stage, instances: NodeInstance[]): MaterializedNodeInstance[] {
  const materialized = instances.map((instance) => ({
    ...instance,
    id: instance.id ?? instance.use,
    needs: [...(instance.needs ?? [])],
  }));
  const ids = new Set<string>();
  for (const instance of materialized) {
    invariant(!ids.has(instance.id), 'DUPLICATE_NODE_INSTANCE', `Stage '${stage}' has duplicate node instance '${instance.id}'`);
    ids.add(instance.id);
  }
  for (const instance of materialized) {
    for (const dependency of instance.needs) {
      invariant(dependency !== instance.id, 'SELF_DEPENDENCY', `Node '${instance.id}' cannot depend on itself`);
      invariant(ids.has(dependency), 'MISSING_DEPENDENCY', `Node '${instance.id}' depends on missing same-stage node '${dependency}'`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(materialized.map((instance) => [instance.id, instance]));
  const visit = (id: string): void => {
    invariant(!visiting.has(id), 'DAG_CYCLE', `Stage '${stage}' contains a dependency cycle at '${id}'`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.needs ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return materialized;
}

export function readyNodes(instances: MaterializedNodeInstance[], completed: ReadonlySet<string>, started: ReadonlySet<string>): MaterializedNodeInstance[] {
  return instances.filter(
    (instance) => !completed.has(instance.id) && !started.has(instance.id) && instance.needs.every((dependency) => completed.has(dependency)),
  );
}
