# GitHub Pages Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VitePress-powered GitHub Pages site for the agents repository, with an English-first product home page, Chinese locale switching, README-backed skill pages, Dewey Interface styling, and a Pages deployment workflow.

**Architecture:** Add a `site/` VitePress app that builds from committed Markdown wrappers plus a generated asset manifest. A root `scripts/sync-site-content.mjs` script will read existing repository Markdown and write reproducible English pages under the VitePress root locale (`site/guide`, `site/skills`, `site/rules`, `site/design`, `site/cli`) plus Chinese pages under `site/zh/`. VitePress owns routing, locale switching, search, and static output; custom theme CSS and a small home component apply `design/dewey-interface.md`.

**Tech Stack:** Node 22, pnpm, VitePress, Vue single-file components for the home page, repository-local Markdown source files, GitHub Actions Pages deployment.

---

## File Structure

- Modify `package.json`: add VitePress dependency and site scripts.
- Modify `pnpm-lock.yaml`: updated by `pnpm install`.
- Create `scripts/sync-site-content.mjs`: generate VitePress Markdown pages and asset metadata from root README files, skill README files, rules, and design contracts.
- Create `tests/site-content.test.mjs`: verify generated content paths, locale fallbacks, and metadata.
- Create `site/index.md`: English home page shell that mounts the custom home component.
- Create `site/zh/index.md`: Chinese home page shell that mounts the same component with Chinese copy.
- Create `site/.vitepress/config.ts`: VitePress config, locales, navigation, sidebars, base path, search, and theme metadata.
- Create `site/.vitepress/theme/index.ts`: extend default VitePress theme and register home components.
- Create `site/.vitepress/theme/styles.css`: Dewey Interface token overrides and layout styling.
- Create `site/.vitepress/theme/components/AgentsHome.vue`: productized system-map-first home page.
- Generate `site/guide/index.md`, `site/zh/guide/index.md`, `site/skills/*.md`, `site/zh/skills/*.md`, `site/rules/index.md`, `site/design/index.md`, `site/cli/index.md`, and matching Chinese index pages from the sync script.
- Create `.github/workflows/pages.yml`: build and deploy VitePress to GitHub Pages.
- Modify `README.md` and `README_ZH.md`: add a GitHub Pages link once the site path is available.

## Implementation Decision

Generated VitePress pages should be committed. This keeps local preview, GitHub Pages builds, and pull request diffs inspectable. The sync script remains the source of reproducibility; tests will fail if generated pages drift from source Markdown.

Rule and design detail pages will start as generated index pages that summarize the assets and link back to source files. Full rule/design detail pages are not required in the first pass because the approved spec only requires full skill details.

## Task 1: Add VitePress Scripts And Dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add scripts and dependency**

Update the root `package.json` scripts and devDependencies:

```json
{
  "scripts": {
    "lint:assets": "node scripts/lint-agent-assets.mjs",
    "test": "node --test tests/*.test.mjs",
    "coverage": "node --test --experimental-test-coverage --test-coverage-include='scripts/asset-scanner.mjs' --test-coverage-lines=90 --test-coverage-branches=90 --test-coverage-functions=90 tests/*.test.mjs",
    "test:cli": "npm --prefix cli test",
    "typecheck:cli": "npm --prefix cli run typecheck",
    "coverage:cli": "npm --prefix cli run test:coverage",
    "site:sync": "node scripts/sync-site-content.mjs",
    "site:dev": "pnpm run site:sync && vitepress dev site --host 127.0.0.1",
    "site:build": "pnpm run site:sync && vitepress build site",
    "site:preview": "vitepress preview site --host 127.0.0.1",
    "prepare": "simple-git-hooks"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "@typescript/native-preview": "7.0.0-dev.20260328.1",
    "bumpp": "^11.0.1",
    "simple-git-hooks": "^2.13.0",
    "typescript": "^6.0.2",
    "vite-plus": "latest",
    "vitepress": "^1.6.4"
  }
}
```

- [ ] **Step 2: Install dependency**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` records `vitepress` and transitive dependencies.

- [ ] **Step 3: Commit dependency setup**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add vitepress site tooling"
```

## Task 2: Test Content Sync Behavior First

**Files:**
- Create: `tests/site-content.test.mjs`
- Create later: `scripts/sync-site-content.mjs`

- [ ] **Step 1: Write failing tests for generated site content**

Create `tests/site-content.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
node --test tests/site-content.test.mjs
```

Expected: FAIL because `scripts/sync-site-content.mjs` does not exist.

## Task 3: Implement Content Sync Script

**Files:**
- Create: `scripts/sync-site-content.mjs`
- Generate: `site/guide/index.md`
- Generate: `site/zh/guide/index.md`
- Generate: `site/skills/*.md`
- Generate: `site/zh/skills/*.md`
- Generate: `site/skills/index.md`
- Generate: `site/zh/skills/index.md`
- Generate: `site/rules/index.md`
- Generate: `site/zh/rules/index.md`
- Generate: `site/design/index.md`
- Generate: `site/zh/design/index.md`
- Generate: `site/cli/index.md`
- Generate: `site/zh/cli/index.md`
- Generate: `site/.vitepress/generated/assets.json`
- Test: `tests/site-content.test.mjs`

- [ ] **Step 1: Create the sync script exports and CLI entry**

Create `scripts/sync-site-content.mjs` with these public functions:

```js
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const GITHUB_SOURCE_BASE = 'https://github.com/deweyou/agents/blob/main';
const SITE_BASE = '/agents';
const generatedMarker = '<!-- Generated by scripts/sync-site-content.mjs. Do not edit directly. -->';

const skillOrder = [
  'repo-memory',
  'git-delivery',
  'spec-driven-coding',
  'skill-eval',
  'product-notes',
  'ui-design',
  'product-design',
];

export async function discoverSiteAssets(repositoryRoot) {
  const skills = await Promise.all(
    skillOrder.map(async (name) => {
      const skillRoot = path.join(repositoryRoot, 'skills', name);
      const skillMarkdown = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
      const { frontmatter } = parseFrontmatter(skillMarkdown);

      return {
        name,
        description: frontmatter.description.replace(/\s+/g, ' ').trim(),
        hasEnglish: true,
        hasChinese: true,
        englishReadme: path.posix.join('skills', name, 'README.md'),
        chineseReadme: path.posix.join('skills', name, 'README_ZH.md'),
      };
    }),
  );

  const rules = await Promise.all(
    ['collaboration-defaults', 'code-style', 'engineering-principles'].map(
      async (name) => {
        const source = `rules/${name}.md`;
        const markdown = await readFile(path.join(repositoryRoot, source), 'utf8');
        const { frontmatter } = parseFrontmatter(markdown);
        return { name, description: frontmatter.description, source };
      },
    ),
  );

  const designs = await Promise.all(
    ['dewey-interface'].map(async (name) => {
      const source = `design/${name}.md`;
      const markdown = await readFile(path.join(repositoryRoot, source), 'utf8');
      const { frontmatter } = parseFrontmatter(markdown);
      return { name, description: frontmatter.description, source };
    }),
  );

  return { skills, rules, designs };
}
```

- [ ] **Step 2: Add frontmatter parsing and link rewriting**

Add:

```js
function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  return {
    frontmatter: yaml.load(match[1]) ?? {},
    body: markdown.slice(match[0].length),
  };
}

export function rewriteMarkdownLinks(markdown, sourceDirectory) {
  return markdown.replace(/\]\((\.\/[^)]+|\.\.\/[^)]+)\)/g, (fullMatch, linkTarget) => {
    const normalizedTarget = path.posix.normalize(
      path.posix.join(sourceDirectory.replaceAll(path.sep, '/'), linkTarget),
    );

    if (normalizedTarget === 'skills') {
      return '](/agents/skills/)';
    }

    if (normalizedTarget.startsWith('skills/') && normalizedTarget.endsWith('/')) {
      const skillName = normalizedTarget.split('/')[1];
      return `](/agents/skills/${skillName})`;
    }

    return `](${GITHUB_SOURCE_BASE}/${normalizedTarget})`;
  });
}
```

- [ ] **Step 3: Add page writers**

Add:

```js
function pageFrontmatter(title, description) {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n`;
}

async function writeGeneratedPage(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${generatedMarker}\n${content}`, 'utf8');
}

async function copyReadmePage({ repositoryRoot, siteRoot, source, output, title, description }) {
  const sourceMarkdown = await readFile(path.join(repositoryRoot, source), 'utf8');
  const body = rewriteMarkdownLinks(sourceMarkdown, path.posix.dirname(source));
  await writeGeneratedPage(
    path.join(siteRoot, output),
    `${pageFrontmatter(title, description)}${body}`,
  );
}
```

- [ ] **Step 4: Add index page generation**

Add:

```js
function createSkillIndex(locale, skills) {
  const heading = locale === 'zh' ? 'Skills' : 'Skills';
  const intro =
    locale === 'zh'
      ? '可安装的主动 agent 工作流。每个页面来自对应 skill 的 README。'
      : 'Installable active agent workflows. Each page is generated from the skill README.';
  const rows = skills
    .map(
      (skill) =>
        `| [${skill.name}](./${skill.name}.md) | ${skill.description} |`,
    )
    .join('\n');

  return `${pageFrontmatter(heading, intro)}# ${heading}\n\n${intro}\n\n| Skill | Description |\n| --- | --- |\n${rows}\n`;
}

function createAssetIndex({ title, intro, assets }) {
  const rows = assets
    .map(
      (asset) =>
        `| \`${asset.name}\` | ${asset.description} | [Source](${GITHUB_SOURCE_BASE}/${asset.source}) |`,
    )
    .join('\n');

  return `${pageFrontmatter(title, intro)}# ${title}\n\n${intro}\n\n| Asset | Description | Source |\n| --- | --- | --- |\n${rows}\n`;
}

function createCliPage(locale) {
  const title = 'CLI';
  const intro =
    locale === 'zh'
      ? '`deweyou-cli` 会把这个仓库中的 skills、rules 和 design contracts 接入其他本地仓库。'
      : '`deweyou-cli` wires skills, rules, and design contracts from this hub into other local repositories.';

  return `${pageFrontmatter(title, intro)}# ${title}\n\n${intro}\n\n\`\`\`bash\nnpm install -g deweyou-cli\ndeweyou-cli agent update\ndeweyou-cli agent init\ndeweyou-cli agent doctor\n\`\`\`\n\nRead the package docs in [cli/README.md](${GITHUB_SOURCE_BASE}/cli/README.md).\n`;
}
```

- [ ] **Step 5: Add buildSiteContent and run it**

Add:

```js
export async function buildSiteContent({ repositoryRoot, siteRoot }) {
  const assets = await discoverSiteAssets(repositoryRoot);

  await rm(path.join(siteRoot, 'guide'), { recursive: true, force: true });
  await rm(path.join(siteRoot, 'skills'), { recursive: true, force: true });
  await rm(path.join(siteRoot, 'rules'), { recursive: true, force: true });
  await rm(path.join(siteRoot, 'design'), { recursive: true, force: true });
  await rm(path.join(siteRoot, 'cli'), { recursive: true, force: true });
  await rm(path.join(siteRoot, 'zh'), { recursive: true, force: true });
  await rm(path.join(siteRoot, '.vitepress/generated'), { recursive: true, force: true });

  await copyReadmePage({
    repositoryRoot,
    siteRoot,
    source: 'README.md',
    output: 'guide/index.md',
    title: 'Guide',
    description: 'Repository guide for the agents hub.',
  });
  await copyReadmePage({
    repositoryRoot,
    siteRoot,
    source: 'README_ZH.md',
    output: 'zh/guide/index.md',
    title: '指南',
    description: 'Agents hub 仓库指南。',
  });

  await writeGeneratedPage(path.join(siteRoot, 'skills/index.md'), createSkillIndex('en', assets.skills));
  await writeGeneratedPage(path.join(siteRoot, 'zh/skills/index.md'), createSkillIndex('zh', assets.skills));

  for (const skill of assets.skills) {
    await copyReadmePage({
      repositoryRoot,
      siteRoot,
      source: skill.englishReadme,
      output: `skills/${skill.name}.md`,
      title: skill.name,
      description: skill.description,
    });
    await copyReadmePage({
      repositoryRoot,
      siteRoot,
      source: skill.chineseReadme,
      output: `zh/skills/${skill.name}.md`,
      title: skill.name,
      description: skill.description,
    });
  }

  await writeGeneratedPage(
    path.join(siteRoot, 'rules/index.md'),
    createAssetIndex({
      title: 'Rules',
      intro: 'Reusable passive preferences and constraints for agent work.',
      assets: assets.rules,
    }),
  );
  await writeGeneratedPage(
    path.join(siteRoot, 'zh/rules/index.md'),
    createAssetIndex({
      title: 'Rules',
      intro: '跨项目复用的被动偏好和约束。',
      assets: assets.rules,
    }),
  );
  await writeGeneratedPage(
    path.join(siteRoot, 'design/index.md'),
    createAssetIndex({
      title: 'Design',
      intro: 'Reusable interface design contracts for AI-assisted UI work.',
      assets: assets.designs,
    }),
  );
  await writeGeneratedPage(
    path.join(siteRoot, 'zh/design/index.md'),
    createAssetIndex({
      title: 'Design',
      intro: '用于 AI 辅助 UI 工作的可复用界面设计契约。',
      assets: assets.designs,
    }),
  );
  await writeGeneratedPage(path.join(siteRoot, 'cli/index.md'), createCliPage('en'));
  await writeGeneratedPage(path.join(siteRoot, 'zh/cli/index.md'), createCliPage('zh'));

  await mkdir(path.join(siteRoot, '.vitepress/generated'), { recursive: true });
  await writeFile(
    path.join(siteRoot, '.vitepress/generated/assets.json'),
    `${JSON.stringify(assets, null, 2)}\n`,
    'utf8',
  );
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await buildSiteContent({
    repositoryRoot,
    siteRoot: path.join(repositoryRoot, 'site'),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
```

- [ ] **Step 6: Run tests and content sync**

Run:

```bash
node --test tests/site-content.test.mjs
pnpm run site:sync
```

Expected: test PASS and generated `site/guide`, `site/skills`, `site/zh`, and `site/.vitepress/generated/assets.json` files exist.

- [ ] **Step 7: Commit content sync**

```bash
git add scripts/sync-site-content.mjs tests/site-content.test.mjs site/guide site/skills site/rules site/design site/cli site/zh site/.vitepress/generated/assets.json
git commit -m "feat: sync site content from readmes"
```

## Task 4: Configure VitePress Locales And Navigation

**Files:**
- Create: `site/.vitepress/config.ts`

- [ ] **Step 1: Create VitePress config**

Create `site/.vitepress/config.ts`:

```ts
import { defineConfig } from 'vitepress';

const skillLinks = [
  { text: 'repo-memory', link: '/skills/repo-memory' },
  { text: 'git-delivery', link: '/skills/git-delivery' },
  { text: 'spec-driven-coding', link: '/skills/spec-driven-coding' },
  { text: 'skill-eval', link: '/skills/skill-eval' },
  { text: 'product-notes', link: '/skills/product-notes' },
  { text: 'ui-design', link: '/skills/ui-design' },
  { text: 'product-design', link: '/skills/product-design' },
];

function sidebar(locale: 'en' | 'zh') {
  const prefix = locale === 'zh' ? '/zh' : '';

  return [
    {
      text: locale === 'zh' ? '指南' : 'Guide',
      items: [{ text: locale === 'zh' ? '概览' : 'Overview', link: `${prefix}/guide/` }],
    },
    {
      text: 'Skills',
      items: [{ text: 'Overview', link: `${prefix}/skills/` }, ...skillLinks.map((item) => ({
        ...item,
        link: `${prefix}${item.link}`,
      }))],
    },
    {
      text: locale === 'zh' ? '资产' : 'Assets',
      items: [
        { text: 'Rules', link: `${prefix}/rules/` },
        { text: 'Design', link: `${prefix}/design/` },
        { text: 'CLI', link: `${prefix}/cli/` },
      ],
    },
  ];
}

export default defineConfig({
  title: 'Agents',
  description: 'Reusable agent workflows, rules, design contracts, and CLI wiring.',
  base: '/agents/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#047857' }],
  ],
  themeConfig: {
    logo: { light: '/logo.svg', dark: '/logo.svg' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/deweyou/agents' }],
    search: { provider: 'local' },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: 'Agents',
      description: 'Reusable agent workflows, rules, design contracts, and CLI wiring.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/' },
          { text: 'Skills', link: '/skills/' },
          { text: 'Rules', link: '/rules/' },
          { text: 'Design', link: '/design/' },
          { text: 'CLI', link: '/cli/' },
        ],
        sidebar: sidebar('en'),
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      title: 'Agents',
      description: '可复用的 agent workflows、rules、design contracts 和 CLI 接入。',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh/guide/' },
          { text: 'Skills', link: '/zh/skills/' },
          { text: 'Rules', link: '/zh/rules/' },
          { text: 'Design', link: '/zh/design/' },
          { text: 'CLI', link: '/zh/cli/' },
        ],
        sidebar: sidebar('zh'),
      },
    },
  },
});
```

- [ ] **Step 2: Add temporary home pages**

Create `site/index.md`:

```md
---
layout: home
title: Agents
---

# Agents

Reusable agent workflows, rules, design contracts, and CLI wiring.
```

Create `site/zh/index.md`:

```md
---
layout: home
title: Agents
---

# Agents

可复用的 agent workflows、rules、design contracts 和 CLI 接入。
```

- [ ] **Step 3: Build and confirm routing works**

Run:

```bash
pnpm run site:build
```

Expected: PASS and VitePress writes `site/.vitepress/dist`.

- [ ] **Step 4: Commit VitePress config**

```bash
git add site/.vitepress/config.ts site/index.md site/zh/index.md
git commit -m "feat: configure vitepress site"
```

## Task 5: Build Dewey Interface Theme And Product Home

**Files:**
- Create: `site/.vitepress/theme/index.ts`
- Create: `site/.vitepress/theme/styles.css`
- Create: `site/.vitepress/theme/components/AgentsHome.vue`
- Modify: `site/index.md`
- Modify: `site/zh/index.md`

- [ ] **Step 1: Register custom theme and styles**

Create `site/.vitepress/theme/index.ts`:

```ts
import DefaultTheme from 'vitepress/theme';
import AgentsHome from './components/AgentsHome.vue';
import './styles.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('AgentsHome', AgentsHome);
  },
};
```

- [ ] **Step 2: Add Dewey Interface CSS**

Create `site/.vitepress/theme/styles.css`:

```css
:root {
  --vp-c-brand-1: #047857;
  --vp-c-brand-2: #059669;
  --vp-c-brand-3: #10b981;
  --vp-c-bg: #f6f6f4;
  --vp-c-bg-alt: #eeeeeb;
  --vp-c-bg-elv: #ffffff;
  --vp-c-border: #d9d8d2;
  --vp-c-divider: #e5e3dc;
  --vp-c-text-1: #1f2421;
  --vp-c-text-2: #5f6661;
  --vp-font-family-base: 'Source Han Sans SC', 'Source Han Sans', ui-sans-serif, system-ui, sans-serif;
  --vp-font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --vp-button-brand-bg: #047857;
  --vp-button-brand-hover-bg: #065f46;
  --vp-button-brand-active-bg: #064e3b;
  --vp-button-brand-border: #047857;
  --vp-button-alt-bg: #ffffff;
  --vp-button-alt-border: #d9d8d2;
  --vp-home-hero-name-color: #1f2421;
  --vp-home-hero-name-background: none;
}

.dark {
  --vp-c-bg: #171a18;
  --vp-c-bg-alt: #202420;
  --vp-c-bg-elv: #242924;
  --vp-c-border: #3a403b;
  --vp-c-divider: #303630;
  --vp-c-text-1: #f4f3ef;
  --vp-c-text-2: #c3c7c1;
}

.VPHome {
  padding-bottom: 0;
}

.agents-home {
  margin: 0 auto;
  max-width: 1120px;
  padding: 64px 24px 96px;
}

.agents-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 48px;
  align-items: center;
}

.agents-eyebrow {
  margin: 0 0 16px;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agents-title {
  margin: 0;
  max-width: 760px;
  color: var(--vp-c-text-1);
  font-family: 'Source Han Serif SC', 'Source Han Serif', ui-serif, Georgia, serif;
  font-size: clamp(42px, 6vw, 72px);
  line-height: 1.02;
}

.agents-lede {
  margin: 24px 0 0;
  max-width: 680px;
  color: var(--vp-c-text-2);
  font-size: 18px;
  line-height: 1.72;
}

.agents-actions,
.agents-section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.agents-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  padding: 0 18px;
  color: var(--vp-c-text-1);
  font-weight: 650;
  text-decoration: none;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.agents-button.primary {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: #ffffff;
}

.agents-button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.agents-button.primary:hover {
  background: #065f46;
  color: #ffffff;
}

.agents-map,
.agents-card {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg-elv);
}

.agents-map {
  padding: 20px;
}

.agents-map-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.agents-map-node {
  min-height: 104px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 14px;
}

.agents-map-node strong {
  display: block;
  color: var(--vp-c-text-1);
}

.agents-map-node span {
  display: block;
  margin-top: 6px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.55;
}

.agents-section {
  margin-top: 88px;
}

.agents-section h2 {
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: 28px;
  line-height: 1.2;
}

.agents-section p {
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.agents-card-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-top: 24px;
}

.agents-card {
  padding: 18px;
}

.agents-card h3 {
  margin: 0;
  font-size: 16px;
}

.agents-card p {
  margin: 10px 0 0;
  font-size: 14px;
}

.agents-command {
  overflow-x: auto;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  margin-top: 20px;
  padding: 18px;
  background: var(--vp-c-bg-elv);
}

.agents-command code {
  color: var(--vp-c-text-1);
}

@media (max-width: 860px) {
  .agents-home {
    padding: 40px 20px 72px;
  }

  .agents-hero,
  .agents-card-grid {
    grid-template-columns: 1fr;
  }

  .agents-title {
    font-size: 42px;
  }
}
```

- [ ] **Step 3: Add product home component**

Create `site/.vitepress/theme/components/AgentsHome.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{
  locale: 'en' | 'zh';
}>();

const copy = {
  en: {
    eyebrow: 'Agents Hub',
    title: 'Reusable agent assets for local repositories.',
    lede:
      'Agents keeps active skills, passive rules, design contracts, and a CLI in one repository so agent behavior can be installed, reviewed, and reused consistently.',
    primaryAction: 'Browse skills',
    secondaryAction: 'Read the guide',
    mapTitle: 'How the system fits together',
    featuredTitle: 'Featured workflows',
    setupTitle: 'Install the hub into a repository',
    setupText:
      'Use deweyou-cli to refresh the asset cache, initialize selected workflows, and verify repository wiring.',
    githubAction: 'Open GitHub',
  },
  zh: {
    eyebrow: 'Agents Hub',
    title: '面向本地仓库的可复用 agent 资产。',
    lede:
      'Agents 把主动 skills、被动 rules、设计契约和 CLI 放在同一个仓库里，让 agent 行为可以被一致地安装、审查和复用。',
    primaryAction: '浏览 Skills',
    secondaryAction: '阅读指南',
    mapTitle: '系统如何组合',
    featuredTitle: '精选工作流',
    setupTitle: '安装到一个仓库',
    setupText:
      '使用 deweyou-cli 刷新资产缓存、初始化选中的 workflows，并诊断仓库接入是否正常。',
    githubAction: '打开 GitHub',
  },
}[props.locale];

const prefix = props.locale === 'zh' ? '/zh' : '';

const nodes = [
  ['Skills', props.locale === 'zh' ? '主动触发的任务工作流。' : 'Active workflows that trigger for agent tasks.'],
  ['Rules', props.locale === 'zh' ? '跨项目复用的被动偏好。' : 'Passive preferences shared across projects.'],
  ['Design', props.locale === 'zh' ? 'AI 辅助 UI 的设计契约。' : 'Design contracts for AI-assisted UI work.'],
  ['deweyou-cli', props.locale === 'zh' ? '把资产接入本地仓库。' : 'Wires assets into local repositories.'],
];

const featured = [
  ['repo-memory', props.locale === 'zh' ? '沉淀 durable repository context。' : 'Keeps durable repository context fresh.'],
  ['git-delivery', props.locale === 'zh' ? '分支感知的提交、PR 和 CI 流程。' : 'Branch-aware commit, PR, and CI workflow.'],
  ['spec-driven-coding', props.locale === 'zh' ? '让功能实现先有 spec 和计划。' : 'Keeps features aligned through specs and plans.'],
  ['ui-design', props.locale === 'zh' ? '跨平台 UX/UI 设计和审查。' : 'UX/UI design and review across surfaces.'],
];
</script>

<template>
  <main class="agents-home">
    <section class="agents-hero">
      <div>
        <p class="agents-eyebrow">{{ copy.eyebrow }}</p>
        <h1 class="agents-title">{{ copy.title }}</h1>
        <p class="agents-lede">{{ copy.lede }}</p>
        <div class="agents-actions">
          <a class="agents-button primary" :href="`${prefix}/skills/`">{{ copy.primaryAction }}</a>
          <a class="agents-button" :href="`${prefix}/guide/`">{{ copy.secondaryAction }}</a>
        </div>
      </div>

      <div class="agents-map" aria-label="Agents system map">
        <div class="agents-map-grid">
          <div v-for="[title, text] in nodes" :key="title" class="agents-map-node">
            <strong>{{ title }}</strong>
            <span>{{ text }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="agents-section">
      <h2>{{ copy.mapTitle }}</h2>
      <p>
        Skills decide how agents act, rules keep passive preferences close,
        design contracts preserve interface taste, and the CLI installs the
        selected assets into target repositories.
      </p>
    </section>

    <section class="agents-section">
      <h2>{{ copy.featuredTitle }}</h2>
      <div class="agents-card-grid">
        <a
          v-for="[name, description] in featured"
          :key="name"
          class="agents-card"
          :href="`${prefix}/skills/${name}`"
        >
          <h3>{{ name }}</h3>
          <p>{{ description }}</p>
        </a>
      </div>
    </section>

    <section class="agents-section">
      <h2>{{ copy.setupTitle }}</h2>
      <p>{{ copy.setupText }}</p>
      <pre class="agents-command"><code>npm install -g deweyou-cli
deweyou-cli agent update
deweyou-cli agent init
deweyou-cli agent doctor</code></pre>
      <div class="agents-section-actions">
        <a class="agents-button primary" :href="`${prefix}/cli/`">CLI</a>
        <a class="agents-button" href="https://github.com/deweyou/agents">{{ copy.githubAction }}</a>
      </div>
    </section>
  </main>
</template>
```

- [ ] **Step 4: Use the custom home component**

Replace `site/index.md` with:

```md
---
layout: page
title: Agents
sidebar: false
aside: false
---

<AgentsHome locale="en" />
```

Replace `site/zh/index.md` with:

```md
---
layout: page
title: Agents
sidebar: false
aside: false
---

<AgentsHome locale="zh" />
```

- [ ] **Step 5: Build the site**

Run:

```bash
pnpm run site:build
```

Expected: PASS with no Vue, CSS, or VitePress route errors.

- [ ] **Step 6: Commit theme and home page**

```bash
git add site/.vitepress/theme site/index.md site/zh/index.md
git commit -m "feat: add dewey interface site home"
```

## Task 6: Add GitHub Pages Workflow

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Create Pages workflow**

Create `.github/workflows/pages.yml`:

```yaml
name: Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm run site:build

      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit workflow**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy vitepress site to pages"
```

## Task 7: Update Repository README Links

**Files:**
- Modify: `README.md`
- Modify: `README_ZH.md`

- [ ] **Step 1: Add site link to English README**

Add this paragraph after the language links in `README.md`:

```md
Website: [deweyou.github.io/agents](https://deweyou.github.io/agents/)
```

- [ ] **Step 2: Add site link to Chinese README**

Add this paragraph after the language links in `README_ZH.md`:

```md
网站：[deweyou.github.io/agents](https://deweyou.github.io/agents/)
```

- [ ] **Step 3: Commit README links**

```bash
git add README.md README_ZH.md
git commit -m "docs: link github pages site"
```

## Task 8: Verify Generated Content, Tests, And Browser Behavior

**Files:**
- Read: all changed files
- No planned edits unless verification finds issues

- [ ] **Step 1: Run full root verification**

Run:

```bash
pnpm run lint:assets
pnpm test
pnpm run site:build
```

Expected: all commands PASS.

- [ ] **Step 2: Start the local VitePress server**

Run:

```bash
pnpm run site:dev
```

Expected: VitePress dev server prints a local URL.

- [ ] **Step 3: Inspect with Browser**

Open the local URL in the in-app browser and check:

- English home renders at `/agents/` or the dev-server equivalent.
- Chinese home renders at `/zh/`.
- Locale switch works from home and skill pages.
- `repo-memory`, `git-delivery`, and `ui-design` skill detail pages render in both locales.
- Mobile viewport around 390px wide has no horizontal overflow.
- Desktop viewport around 1440px wide keeps the hero and system map balanced.
- Keyboard tab order reaches nav links, home CTAs, and skill cards visibly.

- [ ] **Step 4: Stop the dev server**

Stop the running `pnpm run site:dev` session with Ctrl-C after browser checks finish.

- [ ] **Step 5: Commit verification fixes if any**

If verification requires edits, inspect `git diff --name-only`, stage only the files changed by the verification fix, and commit with:

```bash
git commit -m "fix: polish vitepress site verification"
```

## Task 9: Final Delivery Check

**Files:**
- Read: `git status --short`
- Read: `git log --oneline origin/main..HEAD`

- [ ] **Step 1: Confirm intended commits**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: worktree clean except ignored `.superpowers/`, and commits include the spec plus site implementation commits.

- [ ] **Step 2: Report completion and ask for delivery**

Report:

- Site implementation summary.
- Verification command results.
- Browser inspection summary.
- Remaining risks or follow-up ideas.

Then ask:

```text
要我现在提交、push 并开 PR 吗？
```
