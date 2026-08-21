import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CordisCapabilityRuntime } from '../src/core/capabilities.js';
import { ConfigResourceProvider, nodeCapabilityIds } from '../src/core/resources.js';
import type { ResolvedHarnessConfig } from '../src/core/types.js';

describe('ConfigResourceProvider', () => {
  it('lists metadata before progressively loading full skill content', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harness-resource-'));
    const skillDirectory = join(workspace, 'review');
    await mkdir(skillDirectory);
    await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: review\ndescription: review changes\n---\n\n# Full instructions');
    const config: ResolvedHarnessConfig = {
      version: 2,
      sourceFiles: [],
      resources: { review: { kind: 'skill', source: { type: 'workspace', path: skillDirectory } } },
      nodes: { review: { executor: { kind: 'agent', skills: ['review'] } } },
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
    expect(nodeCapabilityIds(config, 'review')).toEqual(['review']);
    await runtime.dispose();
  });

  it('loads local git rule and knowledge directory fallbacks and reports missing registry capabilities', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harness-resource-sources-'));
    const repository = join(workspace, 'resources-repo');
    await mkdir(join(repository, 'rule'), { recursive: true });
    await mkdir(join(repository, 'knowledge'), { recursive: true });
    await writeFile(join(repository, 'rule', 'RULE.md'), '# Rule');
    await writeFile(join(repository, 'knowledge', 'README.md'), '# Knowledge\n\nDetails');
    const config: ResolvedHarnessConfig = {
      version: 2,
      sourceFiles: [],
      resources: {
        rule: { kind: 'rule', source: { type: 'git', repo: `file://${repository}`, path: 'rule' } },
        knowledge: { kind: 'knowledge', source: { type: 'git', repo: repository, path: 'knowledge' } },
        missing: { kind: 'skill', source: { type: 'registry', repo: 'missing/repo', skill: 'not-installed' } },
      },
      nodes: {},
    };
    const runtime = new CordisCapabilityRuntime();
    await runtime.register(new ConfigResourceProvider(config, workspace));
    expect((await runtime.activate({ capabilityId: 'rule', mode: 'full', scope: {}, idempotencyKey: 'rule' })).content).toBe('# Rule');
    expect((await runtime.activate({ capabilityId: 'knowledge', mode: 'metadata', scope: {}, idempotencyKey: 'knowledge' })).content).toContain('# Knowledge');
    await expect(runtime.activate({ capabilityId: 'missing', mode: 'full', scope: {}, idempotencyKey: 'missing' }))
      .rejects.toThrow("Capability 'missing' is unavailable");
    expect(() => nodeCapabilityIds(config, 'unknown')).toThrow("Unknown node 'unknown'");
    await runtime.dispose();
  });
});
