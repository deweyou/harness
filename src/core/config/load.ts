import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { invariant } from '../errors.js';
import { materializeStage } from '../graph.js';
import {
  STAGES,
  type HarnessImport,
  type NodeDefinition,
  type ResourceDefinition,
  type ResolvedHarnessConfig,
  type ResolvedWorkflow,
  type WorkflowDefinition,
} from '../types.js';
import { validateConfigDocument } from './validate.js';

interface LoadedFragment {
  sourceFiles: string[];
  resources: Record<string, ResourceDefinition>;
  nodes: Record<string, NodeDefinition>;
  workflows: Record<string, WorkflowDefinition>;
}

function emptyFragment(): LoadedFragment {
  return { sourceFiles: [], resources: {}, nodes: {}, workflows: {} };
}

function insertUnique<T>(target: Record<string, T>, additions: Record<string, T>, kind: string): void {
  for (const [id, value] of Object.entries(additions)) {
    invariant(!(id in target), 'IMPORT_COLLISION', `${kind} '${id}' is defined more than once; use an import namespace`);
    target[id] = value;
  }
}

function qualify(namespace: string, id: string): string {
  return `${namespace}.${id}`;
}

function namespaceFragment(fragment: LoadedFragment, namespace: string): LoadedFragment {
  const resources = Object.fromEntries(Object.entries(fragment.resources).map(([id, value]) => [qualify(namespace, id), value]));
  const nodes = Object.fromEntries(
    Object.entries(fragment.nodes).map(([id, node]) => [
      qualify(namespace, id),
      node.executor.type === 'agent'
        ? {
            ...node,
            executor: {
              ...node.executor,
              ...(node.executor.skills ? { skills: node.executor.skills.map((skill) => qualify(namespace, skill)) } : {}),
            },
          }
        : node,
    ]),
  );
  const workflows = Object.fromEntries(
    Object.entries(fragment.workflows).map(([id, workflow]) => [
      qualify(namespace, id),
      {
        ...workflow,
        ...(workflow.extends ? { extends: qualify(namespace, workflow.extends) } : {}),
        ...(workflow.rules ? { rules: workflow.rules.map((resource) => qualify(namespace, resource)) } : {}),
        ...(workflow.knowledge ? { knowledge: workflow.knowledge.map((resource) => qualify(namespace, resource)) } : {}),
        ...(workflow.stages
          ? {
              stages: Object.fromEntries(
              Object.entries(workflow.stages).map(([stage, instances]) => [
                stage,
                instances?.map((instance) => ({ ...instance, id: instance.id ?? instance.use, use: qualify(namespace, instance.use) })),
              ]),
              ) as NonNullable<WorkflowDefinition['stages']>,
            }
          : {}),
      },
    ]),
  );
  return { ...fragment, resources, nodes, workflows };
}

function resolveWorkspaceSources(resources: Record<string, ResourceDefinition>, configDirectory: string): Record<string, ResourceDefinition> {
  return Object.fromEntries(
    Object.entries(resources).map(([id, resource]) => [
      id,
      resource.source.type === 'workspace'
        ? { ...resource, source: { ...resource.source, path: resolve(configDirectory, resource.source.path) } }
        : resource,
    ]),
  );
}

async function loadFragment(configPath: string, stack: string[]): Promise<LoadedFragment> {
  const canonicalPath = await realpath(configPath);
  invariant(!stack.includes(canonicalPath), 'IMPORT_CYCLE', `Config import cycle: ${[...stack, canonicalPath].join(' -> ')}`);
  const document = loadYaml(await readFile(canonicalPath, 'utf8'));
  validateConfigDocument(document, canonicalPath);
  const fragment = emptyFragment();
  const nextStack = [...stack, canonicalPath];

  for (const rawImport of document.imports ?? []) {
    const entry: HarnessImport = typeof rawImport === 'string' ? { path: rawImport } : rawImport;
    const importedPath = isAbsolute(entry.path) ? entry.path : resolve(dirname(canonicalPath), entry.path);
    const loaded = await loadFragment(importedPath, nextStack);
    const imported = entry.as ? namespaceFragment(loaded, entry.as) : loaded;
    fragment.sourceFiles.push(...imported.sourceFiles);
    insertUnique(fragment.resources, imported.resources, 'Resource');
    insertUnique(fragment.nodes, imported.nodes, 'Node');
    insertUnique(fragment.workflows, imported.workflows, 'Workflow');
  }

  fragment.sourceFiles.push(canonicalPath);
  insertUnique(fragment.resources, resolveWorkspaceSources(document.resources ?? {}, dirname(canonicalPath)), 'Resource');
  insertUnique(fragment.nodes, document.nodes ?? {}, 'Node');
  insertUnique(fragment.workflows, document.workflows ?? {}, 'Workflow');
  return fragment;
}

function resolveWorkflows(fragment: LoadedFragment): Record<string, ResolvedWorkflow> {
  const resolved = new Map<string, ResolvedWorkflow>();
  const visiting = new Set<string>();

  const resolveOne = (id: string): ResolvedWorkflow => {
    const cached = resolved.get(id);
    if (cached) return cached;
    invariant(!visiting.has(id), 'WORKFLOW_INHERITANCE_CYCLE', `Workflow inheritance cycle at '${id}'`);
    const workflow = fragment.workflows[id];
    invariant(workflow, 'MISSING_WORKFLOW', `Workflow '${id}' does not exist`);
    visiting.add(id);
    const parent = workflow.extends ? resolveOne(workflow.extends) : undefined;
    const stages = { ...(parent?.stages ?? {}), ...(workflow.stages ?? {}) };
    const result: ResolvedWorkflow = {
      name: workflow.name,
      description: workflow.description,
      selectable: workflow.selectable ?? parent?.selectable ?? true,
      rules: workflow.rules === undefined ? [...(parent?.rules ?? [])] : [...workflow.rules],
      knowledge: workflow.knowledge === undefined ? [...(parent?.knowledge ?? [])] : [...workflow.knowledge],
      stages,
    };
    visiting.delete(id);
    resolved.set(id, result);
    return result;
  };

  for (const id of Object.keys(fragment.workflows)) resolveOne(id);
  return Object.fromEntries(resolved);
}

function validateReferences(config: ResolvedHarnessConfig): void {
  for (const [nodeId, node] of Object.entries(config.nodes)) {
    if (node.executor.type === 'agent') {
      for (const resourceId of node.executor.skills ?? []) {
        const resource = config.resources[resourceId];
        invariant(resource, 'MISSING_RESOURCE', `Node '${nodeId}' refers to missing skill '${resourceId}'`);
        invariant(resource.kind === 'skill', 'RESOURCE_KIND_MISMATCH', `Node '${nodeId}' resource '${resourceId}' is not a skill`);
      }
    }
  }

  for (const [workflowId, workflow] of Object.entries(config.workflows)) {
    for (const resourceId of workflow.rules ?? []) {
      invariant(config.resources[resourceId]?.kind === 'rule', 'RESOURCE_KIND_MISMATCH', `Workflow '${workflowId}' rule '${resourceId}' is missing or not a rule`);
    }
    for (const resourceId of workflow.knowledge ?? []) {
      invariant(config.resources[resourceId]?.kind === 'knowledge', 'RESOURCE_KIND_MISMATCH', `Workflow '${workflowId}' knowledge '${resourceId}' is missing or not knowledge`);
    }
    for (const stage of STAGES) {
      const instances = workflow.stages[stage] ?? [];
      for (const instance of instances) {
        invariant(config.nodes[instance.use], 'MISSING_NODE', `Workflow '${workflowId}' stage '${stage}' refers to missing node '${instance.use}'`);
      }
      workflow.stages[stage] = materializeStage(stage, instances);
    }
  }
}

export async function loadHarnessConfig(configPath: string): Promise<ResolvedHarnessConfig> {
  const fragment = await loadFragment(resolve(configPath), []);
  const config: ResolvedHarnessConfig = {
    version: 1,
    sourceFiles: [...new Set(fragment.sourceFiles)],
    resources: fragment.resources,
    nodes: fragment.nodes,
    workflows: resolveWorkflows(fragment),
  };
  validateReferences(config);
  return config;
}

export function selectableWorkflows(config: ResolvedHarnessConfig): Array<{ id: string; name: string; description: string }> {
  return Object.entries(config.workflows)
    .filter(([, workflow]) => workflow.selectable)
    .map(([id, workflow]) => ({ id, name: workflow.name, description: workflow.description }));
}
