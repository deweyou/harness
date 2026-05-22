import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildSiteContent,
  discoverSiteAssets,
  rewriteMarkdownLinks,
} from '../scripts/sync-site-content.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

test('discovers skills with English and Chinese README files', async () => {
  const assets = await discoverSiteAssets(repositoryRoot);
  const repoMemory = assets.skills.find((skill) => skill.name === 'repo-memory');

  assert.ok(repoMemory);
  assert.equal(repoMemory.hasEnglish, true);
  assert.equal(repoMemory.hasChinese, true);
  assert.equal(repoMemory.englishReadme, 'skills/repo-memory/README.md');
  assert.equal(repoMemory.chineseReadme, 'skills/repo-memory/README_ZH.md');
});

test('rewrites repository-relative markdown links for generated guide pages', () => {
  const markdown = '[skills](./skills/) and [workflow](./docs/asset-workflow.md)';

  assert.equal(
    rewriteMarkdownLinks(markdown, '.'),
    '[skills](/agents/skills/) and [workflow](https://github.com/deweyou/agents/blob/main/docs/asset-workflow.md)',
  );
});

test('builds English and Chinese skill pages from existing README files', async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'agents-site-'));

  try {
    await buildSiteContent({ repositoryRoot, siteRoot: outputRoot });

    const englishSkill = await readFile(
      path.join(outputRoot, 'skills/repo-memory.md'),
      'utf8',
    );
    const chineseSkill = await readFile(
      path.join(outputRoot, 'zh/skills/repo-memory.md'),
      'utf8',
    );
    const englishGuide = await readFile(
      path.join(outputRoot, 'guide/index.md'),
      'utf8',
    );

    assert.match(englishSkill, /^---\ntitle: repo-memory\n/m);
    assert.match(englishSkill, /# repo-memory/);
    assert.match(chineseSkill, /# repo-memory/);
    assert.match(englishGuide, /# Agents/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
