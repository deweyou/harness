import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ResolvedHarnessConfig, ResourceDefinition } from './types.js';

export type DispatchMode = 'full' | 'metadata';

export interface DispatchReceipt {
  resourceId: string;
  kind: ResourceDefinition['kind'];
  mode: DispatchMode;
  status: 'loaded' | 'missing';
  locator: string;
  digest?: string;
  content?: string;
  installHint?: string;
  preparation?: {
    command: string;
    args: string[];
  };
}

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
  if (await exists(preferred)) return preferred;
  return join(path, 'README.md');
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

async function locateResource(
  resource: ResourceDefinition,
  workspacePath: string,
): Promise<{ locator: string; hint?: string; preparation?: DispatchReceipt['preparation'] }> {
  if (resource.source.type === 'workspace') return { locator: resource.source.path };
  if (resource.source.type === 'registry') {
    const found = await findRegistrySkill(resource.source.skill, workspacePath);
    return found
      ? { locator: found }
      : {
          locator: `registry:${resource.source.repo}#${resource.source.skill}`,
          hint: `npx skills add ${resource.source.repo} --skill ${resource.source.skill} --yes`,
          preparation: { command: 'npx', args: ['skills', 'add', resource.source.repo, '--skill', resource.source.skill, '--yes'] },
        };
  }
  const repoPath = resource.source.repo.startsWith('file://') ? new URL(resource.source.repo).pathname : resource.source.repo;
  if (isAbsolute(repoPath) || repoPath.startsWith('.')) {
    return { locator: resolve(workspacePath, repoPath, resource.source.path) };
  }
  const identity = createHash('sha256').update(`${resource.source.repo}\0${resource.source.ref ?? 'HEAD'}`).digest('hex').slice(0, 16);
  const cacheRoot = join(homedir(), '.deweyou', 'harness', 'resources', 'git', identity);
  const cached = join(cacheRoot, resource.source.path);
  return {
    locator: cached,
    hint: `Clone ${resource.source.repo}${resource.source.ref ? ` at ${resource.source.ref}` : ''} into ${cacheRoot}`,
    preparation: {
      command: 'git',
      args: ['clone', '--depth', '1', ...(resource.source.ref ? ['--branch', resource.source.ref] : []), '--', resource.source.repo, cacheRoot],
    },
  };
}

export async function dispatchResource(
  config: ResolvedHarnessConfig,
  resourceId: string,
  mode: DispatchMode,
  workspacePath: string,
): Promise<DispatchReceipt> {
  const resource = config.resources[resourceId];
  if (!resource) throw new Error(`Unknown resource '${resourceId}'`);
  const located = await locateResource(resource, workspacePath);
  if (!(await exists(located.locator))) {
    return {
      resourceId,
      kind: resource.kind,
      mode,
      status: 'missing',
      locator: located.locator,
      ...(located.hint ? { installHint: located.hint } : {}),
      ...(located.preparation ? { preparation: located.preparation } : {}),
    };
  }
  const file = await resourceFile(located.locator, resource.kind);
  if (!(await exists(file))) {
    return { resourceId, kind: resource.kind, mode, status: 'missing', locator: file };
  }
  const fullContent = await readFile(file, 'utf8');
  const content = mode === 'metadata' ? metadataOnly(fullContent) : fullContent;
  return {
    resourceId,
    kind: resource.kind,
    mode,
    status: 'loaded',
    locator: file,
    digest: createHash('sha256').update(fullContent).digest('hex'),
    content,
  };
}

export async function dispatchWorkflowContext(
  config: ResolvedHarnessConfig,
  workflowId: string,
  workspacePath: string,
): Promise<DispatchReceipt[]> {
  const workflow = config.workflows[workflowId];
  if (!workflow) throw new Error(`Unknown workflow '${workflowId}'`);
  const rules = await Promise.all((workflow.rules ?? []).map((id) => dispatchResource(config, id, 'full', workspacePath)));
  const knowledge = await Promise.all((workflow.knowledge ?? []).map((id) => dispatchResource(config, id, 'metadata', workspacePath)));
  return [...rules, ...knowledge];
}

export async function dispatchNodeSkills(
  config: ResolvedHarnessConfig,
  nodeId: string,
  workspacePath: string,
): Promise<DispatchReceipt[]> {
  const node = config.nodes[nodeId];
  if (!node) throw new Error(`Unknown node '${nodeId}'`);
  if (node.executor.type !== 'agent') return [];
  return Promise.all((node.executor.skills ?? []).map((id) => dispatchResource(config, id, 'full', workspacePath)));
}

export function resourceLock(receipts: DispatchReceipt[]): Record<string, unknown> {
  return Object.fromEntries(
    receipts.map((receipt) => [
      receipt.resourceId,
      {
        kind: receipt.kind,
        mode: receipt.mode,
        status: receipt.status,
        locator: receipt.locator,
        digest: receipt.digest ?? null,
      },
    ]),
  );
}

export function receiptLabel(receipt: DispatchReceipt): string {
  return `${receipt.kind}:${receipt.resourceId}:${basename(receipt.locator)}`;
}
