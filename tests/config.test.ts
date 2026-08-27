import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { availableNodes, loadHarnessConfig } from '../src/core/config/load.js';

describe('Harness config', () => {
  it('uses an isolated worktree for this repository', async () => {
    await expect(loadHarnessConfig('harness.yaml')).resolves.toMatchObject({
      strategy: 'worktree',
    });
  });

  it('loads repository Context, Skills, and reusable node definitions without workflows or dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-config-'));
    await mkdir(join(directory, 'skills', 'review'), { recursive: true });
    await writeFile(join(directory, 'skills', 'review', 'SKILL.md'), '# Review');
    await writeFile(join(directory, 'harness.yaml'), `
version: 3
strategy: worktree
skills:
  review-skill:
    source: { entry: skills/review }
nodes:
  review:
    kind: agent
    description: Review a bounded change
    skill: [review-skill]
    outputs:
      review-result:
        type: object
        description: Structured review result.
    authority: [read-workspace]
`);

    const config = await loadHarnessConfig(join(directory, 'harness.yaml'));
    expect(config.version).toBe(3);
    expect(config.strategy).toBe('worktree');
    expect(config).not.toHaveProperty('workflows');
    expect(config.nodes.review).not.toHaveProperty('needs');
    expect(availableNodes(config)).toEqual([{
      id: 'review',
      kind: 'agent',
      description: 'Review a bounded change',
      skill: ['review-skill'],
      outputs: {
        'review-result': { type: 'object', description: 'Structured review result.' },
      },
      authority: ['read-workspace'],
    }]);
  });

  it('defaults workspace preparation to a local branch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-strategy-default-'));
    await writeFile(join(directory, 'harness.yaml'), 'version: 3\n');

    await expect(loadHarnessConfig(join(directory, 'harness.yaml'))).resolves.toMatchObject({
      strategy: 'branch',
    });
  });

  it('rejects unknown workspace preparation strategies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-strategy-invalid-'));
    await writeFile(join(directory, 'harness.yaml'), 'version: 3\nstrategy: checkout\n');

    await expect(loadHarnessConfig(join(directory, 'harness.yaml'))).rejects.toMatchObject({
      code: 'INVALID_STRATEGY',
    });
  });

  it('namespaces imported Context, Skills, and Node Skill references', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-import-'));
    await writeFile(join(directory, 'shared.yaml'), `
version: 3
context:
  repository:
    source: { entry: AGENTS.md }
skills:
  inspect:
    source: { repo: example/skills, entry: inspect }
nodes:
  inspect:
    kind: agent
    description: Inspect repository state
    skill: [inspect]
`);
    await writeFile(join(directory, 'harness.yaml'), `
version: 3
imports:
  - path: shared.yaml
    as: shared
`);
    const config = await loadHarnessConfig(join(directory, 'harness.yaml'));
    expect(config.context).toHaveProperty('shared.repository');
    expect(config.skills).toHaveProperty('shared.inspect');
    expect(config.nodes['shared.inspect']).toMatchObject({ kind: 'agent', skill: ['shared.inspect'] });
  });

  it('keeps strategy owned by the root configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-import-strategy-'));
    await writeFile(join(directory, 'shared.yaml'), 'version: 3\nstrategy: worktree\n');
    await writeFile(join(directory, 'harness.yaml'), 'version: 3\nimports: [shared.yaml]\n');

    await expect(loadHarnessConfig(join(directory, 'harness.yaml'))).rejects.toMatchObject({
      code: 'INVALID_IMPORT',
    });
  });

  it('rejects absolute import paths across platforms', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-import-absolute-'));
    const absoluteImports: Array<[string, string]> = [
      ['posix.yaml', '/shared/harness.yaml'],
      ['windows.yaml', 'C:\\shared\\harness.yaml'],
      ['unc.yaml', '\\\\server\\share\\harness.yaml'],
    ];
    for (const [name, importPath] of absoluteImports) {
      const configPath = join(directory, name);
      await writeFile(configPath, `version: 3\nimports:\n  - path: ${JSON.stringify(importPath)}\n`);
      await expect(loadHarnessConfig(configPath)).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    }
  });

  it('requires config version 3 and rejects legacy resource fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-config-v3-'));
    await writeFile(join(directory, 'v2.yaml'), 'version: 2\n');
    await expect(loadHarnessConfig(join(directory, 'v2.yaml'))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONFIG_VERSION' });

    await writeFile(join(directory, 'legacy-resource.yaml'), `
version: 3
context:
  project-context:
    description: Legacy summary
    source: { entry: AGENTS.md }
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-resource.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });

    await writeFile(join(directory, 'legacy-resources.yaml'), `
version: 3
resources:
  project-rules:
    source: { entry: AGENTS.md }
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-resources.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });

    await writeFile(join(directory, 'legacy-source.yaml'), `
version: 3
context:
  project-context:
    source: { type: workspace, path: AGENTS.md }
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-source.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });

    await writeFile(join(directory, 'legacy-node-name.yaml'), `
version: 3
nodes:
  review:
    kind: agent
    name: Review
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-node-name.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });

    await writeFile(join(directory, 'legacy-node-resources.yaml'), `
version: 3
nodes:
  review:
    kind: agent
    resources: [project-context]
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-node-resources.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });

    await writeFile(join(directory, 'legacy-claim-types.yaml'), `
version: 3
nodes:
  verify:
    kind: agent
    claimTypes: [quality]
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-claim-types.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });
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

  it('keeps Context global and validates Node Skill references', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-context-skill-'));
    await writeFile(join(directory, 'collision.yaml'), `
version: 3
context:
  shared: { source: { entry: AGENTS.md } }
skills:
  shared: { source: { entry: skills/shared } }
`);
    await expect(loadHarnessConfig(join(directory, 'collision.yaml'))).rejects.toMatchObject({ code: 'RESOURCE_ID_COLLISION' });

    await writeFile(join(directory, 'missing-skill.yaml'), `
version: 3
nodes:
  review:
    kind: agent
    description: Review a bounded change
    skill: [missing]
`);
    await expect(loadHarnessConfig(join(directory, 'missing-skill.yaml'))).rejects.toMatchObject({ code: 'MISSING_SKILL' });
  });

  it('rejects dependencies embedded in reusable node definitions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-node-dependency-'));
    await writeFile(join(directory, 'harness.yaml'), `
version: 3
nodes:
  inspect:
    kind: agent
    needs: [prepare]
`);
    await expect(loadHarnessConfig(join(directory, 'harness.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });
  });

  it('validates flat Agent and shell Command nodes without speculative execution fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-executors-'));
    await writeFile(join(directory, 'harness.yaml'), `
version: 3
nodes:
  check:
    kind: command
    description: Run the test suite
    command: pnpm test
`);

    const config = await loadHarnessConfig(join(directory, 'harness.yaml'));
    expect(config.nodes.check).toMatchObject({ kind: 'command', description: 'Run the test suite', command: 'pnpm test' });
    expect(availableNodes(config)).toEqual([{
      id: 'check',
      kind: 'command',
      description: 'Run the test suite',
      command: 'pnpm test',
    }]);

    await writeFile(join(directory, 'missing-node-description.yaml'), `
version: 3
nodes:
  check:
    kind: command
    command: pnpm test
`);
    await expect(loadHarnessConfig(join(directory, 'missing-node-description.yaml'))).rejects.toMatchObject({ code: 'INVALID_CONFIG' });

    await writeFile(join(directory, 'empty-node-description.yaml'), `
version: 3
nodes:
  check:
    kind: command
    description: ''
    command: pnpm test
`);
    await expect(loadHarnessConfig(join(directory, 'empty-node-description.yaml'))).rejects.toMatchObject({ code: 'INVALID_CONFIG' });

    await writeFile(join(directory, 'legacy-execution-fields.yaml'), `
version: 3
nodes:
  check:
    kind: command
    command: pnpm test
    artifactTypes: [test-report]
    executionPolicy: { idempotent: true }
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-execution-fields.yaml'))).rejects.toMatchObject({ code: 'UNKNOWN_CONFIG_FIELD' });

    await writeFile(join(directory, 'legacy-executor.yaml'), `
version: 3
nodes:
  check:
    executor: { kind: command, argv: [pnpm, test] }
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-executor.yaml'))).rejects.toMatchObject({ code: 'INVALID_NODE_KIND' });

    await writeFile(join(directory, 'capability.yaml'), `
version: 3
nodes:
  publish:
    kind: capability
    capability: artifact-publisher
`);
    await expect(loadHarnessConfig(join(directory, 'capability.yaml'))).rejects.toMatchObject({ code: 'INVALID_NODE_KIND' });

    await writeFile(join(directory, 'command-array.yaml'), `
version: 3
nodes:
  check:
    kind: command
    description: Run the test suite
    command: [pnpm, test]
`);
    await expect(loadHarnessConfig(join(directory, 'command-array.yaml'))).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('requires inputs and outputs to be described inline JSON Schemas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-port-schema-'));
    await writeFile(join(directory, 'missing-description.yaml'), `
version: 3
nodes:
  deploy:
    kind: agent
    description: Deploy the service
    outputs:
      environment:
        type: object
`);
    await expect(loadHarnessConfig(join(directory, 'missing-description.yaml'))).rejects.toMatchObject({ code: 'INVALID_PORT_SCHEMA' });

    await writeFile(join(directory, 'legacy-array.yaml'), `
version: 3
nodes:
  deploy:
    kind: agent
    description: Deploy the service
    outputs: [environment]
`);
    await expect(loadHarnessConfig(join(directory, 'legacy-array.yaml'))).rejects.toMatchObject({ code: 'INVALID_NODE' });
  });
});
