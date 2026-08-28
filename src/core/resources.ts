import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type {
  CapabilityLoadMode,
  CapabilityProvider,
  CapabilityScope,
  CapabilitySummary,
  LoadedCapability,
} from './capabilities.js';
import { invariant } from './errors.js';
import type { ResolvedHarnessConfig, ResourceDefinition, ResourceKind } from './types.js';

const execFileAsync = promisify(execFile);

interface LocatedResource {
  path: string;
  revision?: string;
}

interface PinnedResource {
  id: string;
  kind: ResourceKind;
  digest: string;
  entry: string;
  revision?: string;
}

export interface ConfigResourceProviderOptions {
  stateRoot?: string;
  runCacheRoot?: string;
  runCommand?: (command: string, args: string[], cwd: string) => Promise<void>;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
    maxBuffer: 4 * 1_024 * 1_024,
    timeout: 300_000,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resourceFile(path: string, kind: ResourceKind): Promise<string> {
  const info = await stat(path);
  if (info.isFile()) return path;
  if (kind === 'skill') return join(path, 'SKILL.md');
  invariant(false, 'INVALID_CONTEXT_RESOURCE', `Context resource entry '${path}' must point to a file`);
}

function metadataOnly(content: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end >= 0) return content.slice(0, end + 4);
  }
  return content.split('\n').slice(0, 12).join('\n');
}

async function skillFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await skillFiles(path));
    else if (entry.isFile() && entry.name === 'SKILL.md') found.push(path);
  }
  return found;
}

async function persistDirectory(source: string, destination: string): Promise<string> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await rename(source, destination);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (!['EEXIST', 'ENOTEMPTY'].includes(String(code))) throw error;
  }
  return realpath(destination);
}

function gitRepository(repo: string): string {
  return /^[^/:]+\/[^/]+$/.test(repo) ? `https://github.com/${repo}.git` : repo;
}

function repositoryEntry(repositoryPath: string, entry: string): string {
  const target = resolve(repositoryPath, entry);
  const fromRepository = relative(repositoryPath, target);
  invariant(
    fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`) && !isAbsolute(fromRepository),
    'INVALID_RESOURCE',
    `Remote resource entry '${entry}' escapes its repository`,
  );
  return target;
}

export class ConfigResourceProvider implements CapabilityProvider {
  readonly id: string;
  private readonly stateRoot: string;
  private readonly runCacheRoot: string | undefined;
  private readonly command: (command: string, args: string[], cwd: string) => Promise<void>;
  private readonly resolutions = new Map<string, Promise<LocatedResource>>();

  constructor(
    private readonly config: ResolvedHarnessConfig,
    _workspacePath: string,
    providerId = 'workspace-config',
    options: ConfigResourceProviderOptions = {},
  ) {
    this.id = providerId;
    this.stateRoot = options.stateRoot ?? process.env.DEWEYOU_HARNESS_STATE_ROOT ?? join(homedir(), '.deweyou', 'harness');
    this.runCacheRoot = options.runCacheRoot;
    this.command = options.runCommand ?? runCommand;
  }

  async list(_scope: CapabilityScope, signal: AbortSignal): Promise<CapabilitySummary[]> {
    signal.throwIfAborted();
    return [
      ...Object.keys(this.config.context).map((id): CapabilitySummary => ({ id, kind: 'context', description: id })),
      ...Object.keys(this.config.skills).map((id): CapabilitySummary => ({ id, kind: 'skill', description: id })),
    ];
  }

  async load(id: string, mode: CapabilityLoadMode, _scope: CapabilityScope, signal: AbortSignal): Promise<LoadedCapability | undefined> {
    signal.throwIfAborted();
    const configured = this.config.context[id]
      ? { kind: 'context' as const, definition: this.config.context[id] }
      : this.config.skills[id]
        ? { kind: 'skill' as const, definition: this.config.skills[id] }
        : undefined;
    if (!configured) return undefined;
    const pinned = await this.readPinned(id, configured.kind);
    if (pinned) return this.loadedCapability(pinned.path, id, configured.kind, mode, signal, pinned.digest, pinned.revision);
    const located = await this.locate(id, configured.kind, configured.definition);
    if (!(await exists(located.path))) return undefined;
    const file = await resourceFile(located.path, configured.kind);
    if (!(await exists(file))) return undefined;
    const fullContent = await readFile(file, 'utf8');
    signal.throwIfAborted();
    const digest = createHash('sha256').update(fullContent).digest('hex');
    if (this.runCacheRoot) {
      const persisted = await this.persistPinned(id, configured.kind, located, file, digest);
      return this.loadedCapability(persisted.path, id, configured.kind, mode, signal, persisted.digest, persisted.revision);
    }
    return {
      id,
      kind: configured.kind,
      description: id,
      locator: file,
      digest,
      ...(located.revision ? { revision: located.revision } : {}),
      content: mode === 'metadata' ? metadataOnly(fullContent) : fullContent,
    };
  }

  private async loadedCapability(
    path: string,
    id: string,
    kind: ResourceKind,
    mode: CapabilityLoadMode,
    signal: AbortSignal,
    expectedDigest: string,
    revision?: string,
  ): Promise<LoadedCapability> {
    invariant(await exists(path), 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' is missing its cached entry`);
    const file = await resourceFile(path, kind);
    invariant(await exists(file), 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' is missing its cached content`);
    const fullContent = await readFile(file, 'utf8');
    signal.throwIfAborted();
    const digest = createHash('sha256').update(fullContent).digest('hex');
    invariant(digest === expectedDigest, 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' does not match digest '${expectedDigest}'`);
    return {
      id,
      kind,
      description: id,
      locator: file,
      digest,
      ...(revision ? { revision } : {}),
      content: mode === 'metadata' ? metadataOnly(fullContent) : fullContent,
    };
  }

  private pinDirectory(id: string, kind: ResourceKind): string {
    const identity = createHash('sha256').update(`${kind}\0${id}`).digest('hex').slice(0, 16);
    return join(this.runCacheRoot!, identity);
  }

  private async readPinned(id: string, kind: ResourceKind): Promise<(LocatedResource & { digest: string }) | undefined> {
    if (!this.runCacheRoot) return undefined;
    const directory = this.pinDirectory(id, kind);
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as PinnedResource;
      invariant(manifest.id === id && manifest.kind === kind, 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' has invalid identity metadata`);
      invariant(/^[a-f0-9]{64}$/.test(manifest.digest), 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' has an invalid digest`);
      invariant(manifest.entry === (kind === 'skill' ? 'resource' : 'resource/context'), 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' has an invalid cache entry`);
      return {
        path: join(directory, manifest.entry),
        digest: manifest.digest,
        ...(manifest.revision ? { revision: manifest.revision } : {}),
      };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async persistPinned(
    id: string,
    kind: ResourceKind,
    located: LocatedResource,
    file: string,
    digest: string,
  ): Promise<LocatedResource & { digest: string }> {
    await mkdir(this.runCacheRoot!, { recursive: true, mode: 0o700 });
    const destination = this.pinDirectory(id, kind);
    const temporary = await mkdtemp(join(this.runCacheRoot!, '.pin-'));
    const entry = kind === 'skill' ? 'resource' : 'resource/context';
    try {
      if (kind === 'skill') await cp(dirname(file), join(temporary, entry), { recursive: true });
      else {
        await mkdir(dirname(join(temporary, entry)), { recursive: true, mode: 0o700 });
        await cp(file, join(temporary, entry));
      }
      const manifest: PinnedResource = {
        id,
        kind,
        digest,
        entry,
        ...(located.revision ? { revision: located.revision } : {}),
      };
      await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      try {
        await rename(temporary, destination);
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (!['EEXIST', 'ENOTEMPTY'].includes(String(code))) throw error;
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    const pinned = await this.readPinned(id, kind);
    invariant(pinned, 'RESOURCE_CACHE_CORRUPTED', `Pinned resource '${id}' was not persisted`);
    return pinned;
  }

  private locate(id: string, kind: ResourceKind, resource: ResourceDefinition): Promise<LocatedResource> {
    const existing = this.resolutions.get(id);
    if (existing) return existing;
    const resolution = resource.source.repo === undefined
      ? Promise.resolve({ path: resource.source.entry })
      : kind === 'skill'
        ? this.materializeSkill(resource.source.repo, resource.source.entry)
        : this.materializeContext(resource.source.repo, resource.source.entry);
    this.resolutions.set(id, resolution);
    return resolution;
  }

  private async materializeSkill(repo: string, entry: string): Promise<LocatedResource> {
    const temporaryRoot = join(this.stateRoot, 'resources', 'tmp');
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(temporaryRoot, 'skill-'));
    try {
      await this.command('npx', ['--yes', 'skills', 'add', repo, '--skill', entry, '--agent', 'universal', '--copy', '--yes'], temporary);
      const candidates = await skillFiles(join(temporary, '.agents', 'skills'));
      const exact = candidates.find((file) => basename(dirname(file)) === entry);
      const selected = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
      invariant(selected, 'SKILL_MATERIALIZATION_FAILED', `npx skills did not materialize exactly one Skill '${entry}' from '${repo}'`);
      const content = await readFile(selected, 'utf8');
      const digest = createHash('sha256').update(content).digest('hex');
      const identity = createHash('sha256').update(`${repo}\0${entry}`).digest('hex').slice(0, 16);
      const destination = join(this.stateRoot, 'resources', 'skills', identity, digest);
      return { path: await persistDirectory(dirname(selected), destination) };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async materializeContext(repo: string, entry: string): Promise<LocatedResource> {
    const temporaryRoot = join(this.stateRoot, 'resources', 'tmp');
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(temporaryRoot, 'context-'));
    try {
      const checkout = join(temporary, 'repository');
      await this.command('git', ['clone', '--depth', '1', gitRepository(repo), checkout], temporary);
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' });
      const revision = stdout.trim();
      const identity = createHash('sha256').update(repo).digest('hex').slice(0, 16);
      const destination = join(this.stateRoot, 'resources', 'git', identity, revision);
      const repositoryPath = await persistDirectory(checkout, destination);
      const target = await realpath(repositoryEntry(repositoryPath, entry));
      repositoryEntry(repositoryPath, relative(repositoryPath, target));
      return { path: target, revision };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

export function nodeCapabilityIds(config: ResolvedHarnessConfig, nodeId: string): string[] {
  const node = config.nodes[nodeId];
  if (!node) throw new Error(`Unknown node '${nodeId}'`);
  return [...Object.keys(config.context), ...(node.kind === 'agent' ? node.skill ?? [] : [])];
}
