import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { dispatchNodeSkills, dispatchResource, dispatchWorkflowContext, receiptLabel, resourceLock } from '../src/core/resources.js';
import type { ResolvedHarnessConfig } from '../src/core/types.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('progressive dispatch', () => {
  test('loads rules fully, knowledge metadata first, and node skills on activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-resources-'));
    directories.push(root);
    await mkdir(join(root, 'writer'));
    await writeFile(join(root, 'rule.md'), '# Rule\nAlways preserve evidence.');
    await writeFile(join(root, 'knowledge.md'), '---\nname: catalog\ndescription: Launch facts\n---\nSECRET BODY');
    await writeFile(join(root, 'writer', 'SKILL.md'), '---\nname: writer\n---\n# Writer\nFull instructions');
    const config: ResolvedHarnessConfig = {
      version: 1,
      sourceFiles: [],
      resources: {
        rule: { kind: 'rule', source: { type: 'workspace', path: join(root, 'rule.md') } },
        knowledge: { kind: 'knowledge', source: { type: 'workspace', path: join(root, 'knowledge.md') } },
        writer: { kind: 'skill', source: { type: 'workspace', path: join(root, 'writer') } },
      },
      nodes: { draft: { executor: { type: 'agent', skills: ['writer'] } } },
      workflows: {
        article: { name: 'Article', description: 'Write.', selectable: true, rules: ['rule'], knowledge: ['knowledge'], stages: {} },
      },
    };

    const workflow = await dispatchWorkflowContext(config, 'article', root);
    expect(workflow[0]).toMatchObject({ resourceId: 'rule', mode: 'full', status: 'loaded' });
    expect(workflow[0]?.content).toContain('Always preserve evidence');
    expect(workflow[1]).toMatchObject({ resourceId: 'knowledge', mode: 'metadata', status: 'loaded' });
    expect(workflow[1]?.content).not.toContain('SECRET BODY');
    expect((await dispatchNodeSkills(config, 'draft', root))[0]?.content).toContain('Full instructions');
  });

  test('returns the fixed npx skills hint when a registry skill is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-registry-'));
    directories.push(root);
    const config: ResolvedHarnessConfig = {
      version: 1,
      sourceFiles: [],
      resources: { missing: { kind: 'skill', source: { type: 'registry', repo: 'acme/skills', skill: 'not-installed' } } },
      nodes: {},
      workflows: {},
    };
    expect(await dispatchResource(config, 'missing', 'full', root)).toMatchObject({
      status: 'missing',
      installHint: 'npx skills add acme/skills --skill not-installed --yes',
      preparation: { command: 'npx', args: ['skills', 'add', 'acme/skills', '--skill', 'not-installed', '--yes'] },
    });
  });

  test('reports missing workspace resources and serializes activation locks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-missing-'));
    directories.push(root);
    const config: ResolvedHarnessConfig = {
      version: 1,
      sourceFiles: [],
      resources: { absent: { kind: 'knowledge', source: { type: 'workspace', path: join(root, 'absent.md') } } },
      nodes: { command: { executor: { type: 'command', command: 'true' } } },
      workflows: {},
    };
    const receipt = await dispatchResource(config, 'absent', 'metadata', root);
    expect(receipt).toMatchObject({ status: 'missing', locator: join(root, 'absent.md') });
    expect(resourceLock([receipt])).toEqual({
      absent: { kind: 'knowledge', mode: 'metadata', status: 'missing', locator: join(root, 'absent.md'), digest: null },
    });
    expect(receiptLabel(receipt)).toBe('knowledge:absent:absent.md');
    await expect(dispatchNodeSkills(config, 'command', root)).resolves.toEqual([]);
    await expect(dispatchResource(config, 'unknown', 'full', root)).rejects.toThrow("Unknown resource 'unknown'");
  });

  test('returns a structured shallow-clone preparation for uncached Git resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-git-'));
    directories.push(root);
    const config: ResolvedHarnessConfig = {
      version: 1,
      sourceFiles: [],
      resources: {
        guide: {
          kind: 'knowledge',
          source: { type: 'git', repo: 'https://github.com/acme/knowledge.git', path: 'guides/launch.md', ref: 'main' },
        },
      },
      nodes: {},
      workflows: {},
    };
    const receipt = await dispatchResource(config, 'guide', 'metadata', root);
    expect(receipt.status).toBe('missing');
    expect(receipt.preparation).toMatchObject({
      command: 'git',
      args: ['clone', '--depth', '1', '--branch', 'main', '--', 'https://github.com/acme/knowledge.git', expect.any(String)],
    });
  });
});
