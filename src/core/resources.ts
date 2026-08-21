import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type {
  CapabilityLoadMode,
  CapabilityProvider,
  CapabilityScope,
  CapabilitySummary,
  LoadedCapability,
} from './capabilities.js';
import type { ResolvedHarnessConfig, ResourceDefinition } from './types.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resourceFile(path: string, kind: ResourceDefinition['kind']): Promise<string> {
  const info = await stat(path);
  if (info.isFile()) return path;
  if (kind === 'skill') return join(path, 'SKILL.md');
  const preferred = join(path, kind === 'rule' ? 'RULE.md' : 'KNOWLEDGE.md');
  return (await exists(preferred)) ? preferred : join(path, 'README.md');
}

function metadataOnly(content: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end >= 0) return content.slice(0, end + 4);
  }
  return content.split('\n').slice(0, 12).join('\n');
}

async function findRegistrySkill(skill: string, workspacePath: string): Promise<string | undefined> {
  const candidates = [
    join(workspacePath, '.agents', 'skills', skill, 'SKILL.md'),
    join(workspacePath, '.codex', 'skills', skill, 'SKILL.md'),
    join(homedir(), '.agents', 'skills', skill, 'SKILL.md'),
    join(homedir(), '.codex', 'skills', skill, 'SKILL.md'),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return undefined;
}

async function locateResource(resource: ResourceDefinition, workspacePath: string): Promise<string | undefined> {
  if (resource.source.type === 'workspace') return resource.source.path;
  if (resource.source.type === 'registry') return findRegistrySkill(resource.source.skill, workspacePath);
  const repositoryPath = resource.source.repo.startsWith('file://') ? new URL(resource.source.repo).pathname : resource.source.repo;
  if (isAbsolute(repositoryPath) || repositoryPath.startsWith('.')) return resolve(workspacePath, repositoryPath, resource.source.path);
  const identity = createHash('sha256').update(`${resource.source.repo}\0${resource.source.ref ?? 'HEAD'}`).digest('hex').slice(0, 16);
  return join(homedir(), '.deweyou', 'harness', 'resources', 'git', identity, resource.source.path);
}

export class ConfigResourceProvider implements CapabilityProvider {
  readonly id: string;

  constructor(
    private readonly config: ResolvedHarnessConfig,
    private readonly workspacePath: string,
    providerId = 'workspace-config',
  ) {
    this.id = providerId;
  }

  async list(_scope: CapabilityScope, signal: AbortSignal): Promise<CapabilitySummary[]> {
    signal.throwIfAborted();
    return Object.entries(this.config.resources).map(([id, resource]) => ({
      id,
      kind: resource.kind,
      description: resource.description ?? id,
    }));
  }

  async load(id: string, mode: CapabilityLoadMode, _scope: CapabilityScope, signal: AbortSignal): Promise<LoadedCapability | undefined> {
    signal.throwIfAborted();
    const resource = this.config.resources[id];
    if (!resource) return undefined;
    const located = await locateResource(resource, this.workspacePath);
    if (!located || !(await exists(located))) return undefined;
    const file = await resourceFile(located, resource.kind);
    if (!(await exists(file))) return undefined;
    const fullContent = await readFile(file, 'utf8');
    signal.throwIfAborted();
    return {
      id,
      kind: resource.kind,
      description: resource.description ?? id,
      locator: file,
      digest: createHash('sha256').update(fullContent).digest('hex'),
      content: mode === 'metadata' ? metadataOnly(fullContent) : fullContent,
    };
  }
}

export function nodeCapabilityIds(config: ResolvedHarnessConfig, nodeId: string): string[] {
  const node = config.nodes[nodeId];
  if (!node) throw new Error(`Unknown node '${nodeId}'`);
  return [...new Set([...(node.resources ?? []), ...(node.executor.kind === 'agent' ? node.executor.skills ?? [] : [])])];
}
