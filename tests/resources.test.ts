import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CordisCapabilityRuntime } from '../src/core/capabilities.js';
import { ConfigResourceProvider, nodeCapabilityIds } from '../src/core/resources.js';
import type { ResolvedHarnessConfig } from '../src/core/types.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

describe('ConfigResourceProvider', () => {
  it('lists metadata before progressively loading full skill content', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harness-resource-'));
    const skillDirectory = join(workspace, 'review');
    await mkdir(skillDirectory);
    await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: review\ndescription: review changes\n---\n\n# Full instructions');
    const config: ResolvedHarnessConfig = {
      version: 3,
      strategy: 'branch',
      sourceFiles: [],
      context: { repository: { source: { entry: join(workspace, 'AGENTS.md') } } },
      skills: { review: { source: { entry: skillDirectory } } },
      nodes: { review: { kind: 'agent', description: 'Review a bounded change.', skill: ['review'] } },
    };
    const runtime = new CordisCapabilityRuntime();
    await runtime.register(new ConfigResourceProvider(config, workspace), { workspaceId: 'workspace' });

    expect(await runtime.list({ workspaceId: 'workspace' }, 'skill')).toEqual([
      { id: 'review', kind: 'skill', description: 'review' },
    ]);
    const metadata = await runtime.activate({ capabilityId: 'review', mode: 'metadata', scope: { workspaceId: 'workspace' }, idempotencyKey: 'metadata' });
    const full = await runtime.activate({ capabilityId: 'review', mode: 'full', scope: { workspaceId: 'workspace' }, idempotencyKey: 'full' });
    expect(metadata.content).toContain('description: review changes');
    expect(metadata.content).not.toContain('# Full instructions');
    expect(full.content).toContain('# Full instructions');
    expect(nodeCapabilityIds(config, 'review')).toEqual(['repository', 'review']);
    await runtime.dispose();
  });

  it('pins first activation content and supporting Skill files in the Run cache across runtime restarts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harness-run-resource-'));
    const skillDirectory = join(workspace, 'review');
    const runCacheRoot = join(workspace, 'run', 'cache', 'resources');
    await mkdir(join(skillDirectory, 'scripts'), { recursive: true });
    await writeFile(join(skillDirectory, 'SKILL.md'), '# Review v1');
    await writeFile(join(skillDirectory, 'scripts', 'review.mjs'), 'export const version = 1;');
    const config: ResolvedHarnessConfig = {
      version: 3,
      strategy: 'branch',
      sourceFiles: [],
      context: {},
      skills: { review: { source: { entry: skillDirectory } } },
      nodes: {},
    };

    const firstRuntime = new CordisCapabilityRuntime();
    await firstRuntime.register(new ConfigResourceProvider(config, workspace, 'run-review-v1', { runCacheRoot }), { workspaceId: 'workspace', runId: 'run' });
    const first = await firstRuntime.activate({ capabilityId: 'review', mode: 'full', scope: { workspaceId: 'workspace', runId: 'run' }, idempotencyKey: 'first' });
    expect(first.content).toBe('# Review v1');
    expect(first.locator).toContain(join('cache', 'resources'));
    expect(await readFile(join(first.locator, '..', 'scripts', 'review.mjs'), 'utf8')).toContain('version = 1');
    await firstRuntime.dispose();

    await writeFile(join(skillDirectory, 'SKILL.md'), '# Review v2');
    await writeFile(join(skillDirectory, 'scripts', 'review.mjs'), 'export const version = 2;');
    const restartedRuntime = new CordisCapabilityRuntime();
    await restartedRuntime.register(new ConfigResourceProvider(config, workspace, 'run-review-v2', { runCacheRoot }), { workspaceId: 'workspace', runId: 'run' });
    const restarted = await restartedRuntime.activate({ capabilityId: 'review', mode: 'full', scope: { workspaceId: 'workspace', runId: 'run' }, idempotencyKey: 'after-restart' });
    expect(restarted.content).toBe('# Review v1');
    expect(restarted.digest).toBe(first.digest);
    expect(await readFile(join(restarted.locator, '..', 'scripts', 'review.mjs'), 'utf8')).toContain('version = 1');
    await restartedRuntime.dispose();
  });

  it('loads explicit remote Context files and reports missing resources', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harness-resource-sources-'));
    const repository = join(workspace, 'resources-repo');
    const stateRoot = join(workspace, 'state');
    await mkdir(join(repository, 'context'), { recursive: true });
    await writeFile(join(repository, 'context', 'architecture.md'), '# Context');
    await writeFile(join(repository, 'README.md'), '# Repository context\n\nDetails');
    await git(repository, 'init', '-b', 'main');
    await git(repository, 'add', '.');
    await git(repository, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'context');
    const config: ResolvedHarnessConfig = {
      version: 3,
      strategy: 'branch',
      sourceFiles: [],
      context: {
        context: { source: { repo: `file://${repository}`, entry: 'context/architecture.md' } },
        readme: { source: { repo: repository, entry: 'README.md' } },
        directory: { source: { repo: repository, entry: 'context' } },
      },
      skills: { missing: { source: { entry: join(workspace, 'not-installed') } } },
      nodes: {},
    };
    const runtime = new CordisCapabilityRuntime();
    await runtime.register(new ConfigResourceProvider(config, workspace, 'remote-context', { stateRoot }));
    const firstContext = await runtime.activate({ capabilityId: 'context', mode: 'full', scope: {}, idempotencyKey: 'context' });
    expect(firstContext.content).toBe('# Context');
    expect(firstContext.revision).toMatch(/^[0-9a-f]{40}$/);
    expect((await runtime.activate({ capabilityId: 'readme', mode: 'metadata', scope: {}, idempotencyKey: 'readme' })).content).toContain('# Repository context');
    await expect(runtime.activate({ capabilityId: 'directory', mode: 'full', scope: {}, idempotencyKey: 'directory' }))
      .rejects.toMatchObject({ code: 'INVALID_CONTEXT_RESOURCE' });
    await expect(runtime.activate({ capabilityId: 'missing', mode: 'full', scope: {}, idempotencyKey: 'missing' }))
      .rejects.toThrow("Capability 'missing' is unavailable");
    expect(() => nodeCapabilityIds(config, 'unknown')).toThrow("Unknown node 'unknown'");
    await runtime.dispose();

    await writeFile(join(repository, 'context', 'architecture.md'), '# Updated context');
    await git(repository, 'add', '.');
    await git(repository, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'update context');
    const refreshedRuntime = new CordisCapabilityRuntime();
    await refreshedRuntime.register(new ConfigResourceProvider(config, workspace, 'refreshed-context', { stateRoot }));
    const refreshed = await refreshedRuntime.activate({ capabilityId: 'context', mode: 'full', scope: {}, idempotencyKey: 'refreshed-context' });
    expect(refreshed.content).toBe('# Updated context');
    expect(refreshed.revision).not.toBe(firstContext.revision);
    await refreshedRuntime.dispose();
  });

  it('materializes a remote Skill through npx skills into Harness state', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harness-resource-skill-'));
    const stateRoot = join(workspace, 'state');
    const commands: Array<{ command: string; args: string[] }> = [];
    const config: ResolvedHarnessConfig = {
      version: 3,
      strategy: 'branch',
      sourceFiles: [],
      context: {},
      skills: { review: { source: { repo: 'example/agent-skills', entry: 'review' } } },
      nodes: {},
    };
    const runtime = new CordisCapabilityRuntime();
    await runtime.register(new ConfigResourceProvider(config, workspace, 'remote-skills', {
      stateRoot,
      runCommand: async (command, args, cwd) => {
        commands.push({ command, args });
        const directory = join(cwd, '.agents', 'skills', 'review');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'SKILL.md'), '---\nname: review\ndescription: Review changes\n---\n\n# Review');
      },
    }));

    const loaded = await runtime.activate({ capabilityId: 'review', mode: 'full', scope: {}, idempotencyKey: 'remote-review' });
    expect(commands).toEqual([{
      command: 'npx',
      args: ['--yes', 'skills', 'add', 'example/agent-skills', '--skill', 'review', '--agent', 'universal', '--copy', '--yes'],
    }]);
    expect(loaded.content).toContain('# Review');
    expect(loaded.locator).toContain(join('resources', 'skills'));
    await runtime.dispose();
  });
});
