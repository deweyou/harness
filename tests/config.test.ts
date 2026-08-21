import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { availableNodes, loadHarnessConfig } from '../src/core/config/load.js';

describe('Harness v2 config', () => {
  it('loads resources and reusable node definitions without workflows or dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-v2-config-'));
    await mkdir(join(directory, 'skills', 'review'), { recursive: true });
    await writeFile(join(directory, 'skills', 'review', 'SKILL.md'), '# Review');
    await writeFile(join(directory, 'harness.yaml'), `
version: 2
resources:
  review-skill:
    kind: skill
    source: { type: workspace, path: skills/review }
nodes:
  review:
    name: Review
    description: Review a bounded change
    executor: { kind: agent, skills: [review-skill] }
    outputs: [review-result]
    claimTypes: [quality]
    authority: [read-workspace]
`);

    const config = await loadHarnessConfig(join(directory, 'harness.yaml'));
    expect(config.version).toBe(2);
    expect(config).not.toHaveProperty('workflows');
    expect(config.nodes.review).not.toHaveProperty('needs');
    expect(availableNodes(config)).toEqual([{ id: 'review', name: 'Review', description: 'Review a bounded change' }]);
  });

  it('namespaces imported resources and node references', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-v2-import-'));
    await writeFile(join(directory, 'shared.yaml'), `
version: 2
resources:
  inspect:
    kind: skill
    source: { type: registry, repo: example/skills, skill: inspect }
nodes:
  inspect:
    executor: { kind: agent, skills: [inspect] }
    resources: [inspect]
`);
    await writeFile(join(directory, 'harness.yaml'), `
version: 2
imports:
  - path: shared.yaml
    as: shared
`);
    const config = await loadHarnessConfig(join(directory, 'harness.yaml'));
    expect(config.nodes['shared.inspect']?.executor).toEqual({ kind: 'agent', skills: ['shared.inspect'] });
    expect(config.nodes['shared.inspect']?.resources).toEqual(['shared.inspect']);
  });

  it('rejects every v1 workflow field instead of translating it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-v1-rejected-'));
    await writeFile(join(directory, 'harness.yaml'), `
version: 1
workflows:
  default:
    name: Default
    description: old
`);
    await expect(loadHarnessConfig(join(directory, 'harness.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });
  });

  it('rejects dependencies embedded in reusable node definitions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-node-dependency-'));
    await writeFile(join(directory, 'harness.yaml'), `
version: 2
nodes:
  inspect:
    executor: { kind: agent }
    needs: [prepare]
`);
    await expect(loadHarnessConfig(join(directory, 'harness.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });
  });

  it('validates structured command and capability executors with execution policy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-v2-executors-'));
    await writeFile(join(directory, 'harness.yaml'), `
version: 2
nodes:
  check:
    executor:
      kind: command
      argv: [pnpm, test]
      cwd: packages/core
    executionPolicy:
      idempotent: true
      timeoutMs: 60000
      retry: { maxAttempts: 2, backoffMs: 100 }
  publish:
    executor:
      kind: capability
      capability: artifact-publisher
      config: { channel: preview }
`);

    const config = await loadHarnessConfig(join(directory, 'harness.yaml'));
    expect(config.nodes.check?.executor).toEqual({ kind: 'command', argv: ['pnpm', 'test'], cwd: 'packages/core' });
    expect(config.nodes.publish?.executor).toEqual({ kind: 'capability', capability: 'artifact-publisher', config: { channel: 'preview' } });
    expect(config.nodes.check?.executionPolicy?.retry?.maxAttempts).toBe(2);
  });
});
