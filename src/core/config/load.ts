import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { invariant } from '../errors.js';
import type { HarnessImport, NodeDefinition, ResourceDefinition, ResolvedHarnessConfig, WorkspaceStrategy } from '../types.js';
import { validateConfigDocument } from './validate.js';

interface LoadedFragment {
  strategy?: WorkspaceStrategy;
  sourceFiles: string[];
  context: Record<string, ResourceDefinition>;
  skills: Record<string, ResourceDefinition>;
  nodes: Record<string, NodeDefinition>;
}

function emptyFragment(): LoadedFragment {
  return { sourceFiles: [], context: {}, skills: {}, nodes: {} };
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
  return {
    ...fragment,
    context: Object.fromEntries(Object.entries(fragment.context).map(([id, value]) => [qualify(namespace, id), value])),
    skills: Object.fromEntries(Object.entries(fragment.skills).map(([id, value]) => [qualify(namespace, id), value])),
    nodes: Object.fromEntries(
      Object.entries(fragment.nodes).map(([id, node]) => [
        qualify(namespace, id),
        {
          ...node,
          ...(node.kind === 'agent' && node.skill ? { skill: node.skill.map((skill) => qualify(namespace, skill)) } : {}),
        },
      ]),
    ),
  };
}

function resolveWorkspaceSources(resources: Record<string, ResourceDefinition>, configDirectory: string): Record<string, ResourceDefinition> {
  return Object.fromEntries(
    Object.entries(resources).map(([id, resource]) => [
      id,
      resource.source.repo === undefined
        ? { ...resource, source: { entry: resolve(configDirectory, resource.source.entry) } }
        : resource,
    ]),
  );
}

async function loadFragment(configPath: string, stack: string[]): Promise<LoadedFragment> {
  const canonicalPath = await realpath(configPath);
  invariant(!stack.includes(canonicalPath), 'IMPORT_CYCLE', `Config import cycle: ${[...stack, canonicalPath].join(' -> ')}`);
  const document = loadYaml(await readFile(canonicalPath, 'utf8'));
  validateConfigDocument(document, canonicalPath);
  invariant(stack.length === 0 || document.strategy === undefined, 'INVALID_IMPORT', `Imported config '${canonicalPath}' must not set strategy`);
  const fragment = emptyFragment();

  for (const rawImport of document.imports ?? []) {
    const entry: HarnessImport = typeof rawImport === 'string' ? { path: rawImport } : rawImport;
    const importedPath = resolve(dirname(canonicalPath), entry.path);
    const loaded = await loadFragment(importedPath, [...stack, canonicalPath]);
    const imported = entry.as ? namespaceFragment(loaded, entry.as) : loaded;
    fragment.sourceFiles.push(...imported.sourceFiles);
    insertUnique(fragment.context, imported.context, 'Context');
    insertUnique(fragment.skills, imported.skills, 'Skill');
    insertUnique(fragment.nodes, imported.nodes, 'Node');
  }

  fragment.sourceFiles.push(canonicalPath);
  if (document.strategy !== undefined) fragment.strategy = document.strategy;
  insertUnique(fragment.context, resolveWorkspaceSources(document.context ?? {}, dirname(canonicalPath)), 'Context');
  insertUnique(fragment.skills, resolveWorkspaceSources(document.skills ?? {}, dirname(canonicalPath)), 'Skill');
  insertUnique(fragment.nodes, document.nodes ?? {}, 'Node');
  return fragment;
}

function validateReferences(config: ResolvedHarnessConfig): void {
  for (const contextId of Object.keys(config.context)) {
    invariant(!(contextId in config.skills), 'RESOURCE_ID_COLLISION', `Context and Skill share id '${contextId}'`);
  }
  for (const [nodeId, node] of Object.entries(config.nodes)) {
    for (const skillId of node.kind === 'agent' ? node.skill ?? [] : []) {
      invariant(config.skills[skillId], 'MISSING_SKILL', `Node '${nodeId}' refers to missing Skill '${skillId}'`);
    }
  }
}

export async function loadHarnessConfig(configPath: string): Promise<ResolvedHarnessConfig> {
  const fragment = await loadFragment(resolve(configPath), []);
  const config: ResolvedHarnessConfig = {
    version: 3,
    strategy: fragment.strategy ?? 'branch',
    sourceFiles: [...new Set(fragment.sourceFiles)],
    context: fragment.context,
    skills: fragment.skills,
    nodes: fragment.nodes,
  };
  validateReferences(config);
  return config;
}

export function availableNodes(config: ResolvedHarnessConfig): Array<Record<string, unknown>> {
  return Object.entries(config.nodes).map(([id, node]) => ({
    id,
    kind: node.kind,
    description: node.description,
    ...(node.inputs ? { inputs: node.inputs } : {}),
    ...(node.outputs ? { outputs: node.outputs } : {}),
    ...(node.authority ? { authority: node.authority } : {}),
    ...(node.kind === 'agent' ? { skill: node.skill ?? [] } : { command: node.command }),
  }));
}
