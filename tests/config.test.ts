import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { loadHarnessConfig, selectableWorkflows } from '../src/core/config/load.js';
import { HarnessError } from '../src/core/errors.js';

const temporaryDirectories: string[] = [];

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'harness-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('loadHarnessConfig', () => {
  test('loads nested monorepo imports, namespaces IDs, and preserves declaring source paths', async () => {
    const root = await fixture();
    await mkdir(join(root, 'packages', 'shared', 'rules'), { recursive: true });
    await writeFile(
      join(root, 'packages', 'shared', 'base.yaml'),
      `version: 1
resources:
  house-rule:
    kind: rule
    source: { type: workspace, path: rules/house.md }
  writer:
    kind: skill
    source: { type: registry, repo: acme/skills, skill: writer }
nodes:
  draft:
    executor: { type: agent, skills: [writer] }
workflows:
  base:
    name: Shared base
    description: Shared non-selectable workflow.
    selectable: false
    rules: [house-rule]
    stages:
      execute:
        - use: draft
`,
    );
    await writeFile(
      join(root, 'harness.yaml'),
      `version: 1
imports:
  - path: packages/shared/base.yaml
    as: shared
nodes:
  review:
    executor: { type: agent }
workflows:
  article:
    name: Article
    description: Write and review an article.
    selectable: true
    extends: shared.base
    stages:
      verify:
        - use: review
`,
    );

    const config = await loadHarnessConfig(join(root, 'harness.yaml'));

    expect(config.resources['shared.house-rule']?.source).toEqual({
      type: 'workspace',
      path: join(await realpath(root), 'packages', 'shared', 'rules', 'house.md'),
    });
    expect(config.nodes['shared.draft']?.executor).toEqual({ type: 'agent', skills: ['shared.writer'] });
    expect(config.workflows.article?.rules).toEqual(['shared.house-rule']);
    expect(config.workflows.article?.stages.execute?.[0]).toMatchObject({ id: 'draft', use: 'shared.draft' });
    expect(config.workflows.article?.stages.verify?.[0]).toMatchObject({ id: 'review', use: 'review' });
    expect(selectableWorkflows(config).map((workflow) => workflow.id)).toEqual(['article']);
  });

  test('declared inherited lists and stages replace rather than deep merge', async () => {
    const root = await fixture();
    await writeFile(
      join(root, 'harness.yaml'),
      `version: 1
resources:
  one: { kind: rule, source: { type: workspace, path: one.md } }
  two: { kind: rule, source: { type: workspace, path: two.md } }
nodes:
  a: { executor: { type: agent } }
  b: { executor: { type: agent } }
workflows:
  base:
    name: Base
    description: Base workflow.
    rules: [one]
    stages:
      execute: [{ use: a }]
  child:
    name: Child
    description: Child workflow.
    extends: base
    rules: [two]
    stages:
      execute: [{ use: b }]
`,
    );
    const config = await loadHarnessConfig(join(root, 'harness.yaml'));
    expect(config.workflows.child?.rules).toEqual(['two']);
    expect(config.workflows.child?.stages.execute?.map((node) => node.use)).toEqual(['b']);
  });

  test.each([
    ['import cycles', `version: 1\nimports: [harness.yaml]\n`, 'IMPORT_CYCLE'],
    [
      'same-stage DAG cycles',
      `version: 1
nodes:
  a: { executor: { type: agent } }
  b: { executor: { type: agent } }
workflows:
  bad:
    name: Bad
    description: Invalid cycle.
    stages:
      execute:
        - { use: a, needs: [b] }
        - { use: b, needs: [a] }
`,
      'DAG_CYCLE',
    ],
    [
      'unknown stages',
      `version: 1
workflows:
  bad:
    name: Bad
    description: Invalid stage.
    stages: { publish: [] }
`,
      'INVALID_STAGE',
    ],
    ['unknown fields', `version: 1\nresource_loading: eager\n`, 'UNKNOWN_CONFIG_FIELD'],
  ])('rejects %s', async (_name, yaml, code) => {
    const root = await fixture();
    await writeFile(join(root, 'harness.yaml'), yaml);
    await expect(loadHarnessConfig(join(root, 'harness.yaml'))).rejects.toMatchObject({ code } satisfies Partial<HarnessError>);
  });

  test('rejects collisions without an import namespace', async () => {
    const root = await fixture();
    await writeFile(join(root, 'one.yaml'), 'version: 1\nnodes:\n  work: { executor: { type: agent } }\n');
    await writeFile(join(root, 'two.yaml'), 'version: 1\nnodes:\n  work: { executor: { type: agent } }\n');
    await writeFile(join(root, 'harness.yaml'), 'version: 1\nimports: [one.yaml, two.yaml]\n');
    await expect(loadHarnessConfig(join(root, 'harness.yaml'))).rejects.toMatchObject({ code: 'IMPORT_COLLISION' } satisfies Partial<HarnessError>);
  });
});
