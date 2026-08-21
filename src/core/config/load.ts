import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { invariant } from '../errors.js';
import type { HarnessImport, NodeDefinition, ResourceDefinition, ResolvedHarnessConfig } from '../types.js';
import { validateConfigDocument } from './validate.js';

interface LoadedFragment {
  sourceFiles: string[];
  resources: Record<string, ResourceDefinition>;
  nodes: Record<string, NodeDefinition>;
}

function emptyFragment(): LoadedFragment {
  return { sourceFiles: [], resources: {}, nodes: {} };
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
    resources: Object.fromEntries(Object.entries(fragment.resources).map(([id, value]) => [qualify(namespace, id), value])),
    nodes: Object.fromEntries(
      Object.entries(fragment.nodes).map(([id, node]) => [
        qualify(namespace, id),
        {
          ...node,
          ...(node.resources ? { resources: node.resources.map((resource) => qualify(namespace, resource)) } : {}),
          executor: node.executor.kind === 'agent' && node.executor.skills
            ? { ...node.executor, skills: node.executor.skills.map((skill) => qualify(namespace, skill)) }
            : node.executor,
        },
      ]),
    ),
  };
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

  for (const rawImport of document.imports ?? []) {
    const entry: HarnessImport = typeof rawImport === 'string' ? { path: rawImport } : rawImport;
    const importedPath = isAbsolute(entry.path) ? entry.path : resolve(dirname(canonicalPath), entry.path);
    const loaded = await loadFragment(importedPath, [...stack, canonicalPath]);
    const imported = entry.as ? namespaceFragment(loaded, entry.as) : loaded;
    fragment.sourceFiles.push(...imported.sourceFiles);
    insertUnique(fragment.resources, imported.resources, 'Resource');
    insertUnique(fragment.nodes, imported.nodes, 'Node');
  }

  fragment.sourceFiles.push(canonicalPath);
  insertUnique(fragment.resources, resolveWorkspaceSources(document.resources ?? {}, dirname(canonicalPath)), 'Resource');
  insertUnique(fragment.nodes, document.nodes ?? {}, 'Node');
  return fragment;
}

function validateReferences(config: ResolvedHarnessConfig): void {
  for (const [nodeId, node] of Object.entries(config.nodes)) {
    const resources = new Set([...(node.resources ?? []), ...(node.executor.kind === 'agent' ? node.executor.skills ?? [] : [])]);
    for (const resourceId of resources) {
      const resource = config.resources[resourceId];
      invariant(resource, 'MISSING_RESOURCE', `Node '${nodeId}' refers to missing resource '${resourceId}'`);
      if (node.executor.kind === 'agent' && node.executor.skills?.includes(resourceId)) {
        invariant(resource.kind === 'skill', 'RESOURCE_KIND_MISMATCH', `Node '${nodeId}' resource '${resourceId}' is not a skill`);
      }
    }
  }
}

export async function loadHarnessConfig(configPath: string): Promise<ResolvedHarnessConfig> {
  const fragment = await loadFragment(resolve(configPath), []);
  const config: ResolvedHarnessConfig = {
    version: 2,
    sourceFiles: [...new Set(fragment.sourceFiles)],
    resources: fragment.resources,
    nodes: fragment.nodes,
  };
  validateReferences(config);
  return config;
}

export function availableNodes(config: ResolvedHarnessConfig): Array<{ id: string; name: string; description: string }> {
  return Object.entries(config.nodes).map(([id, node]) => ({
    id,
    name: node.name ?? id,
    description: node.description ?? '',
  }));
}
