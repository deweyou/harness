<script setup lang="ts">
import { computed } from 'vue';
import { withBase } from 'vitepress';

type Locale = 'en' | 'zh';

const props = defineProps<{
  locale: Locale;
}>();

const content = computed(() => pageContent[props.locale]);

const pageContent = {
  en: {
    eyebrow: 'DDev Harness',
    title: 'One entry skill for personal cross-repository development.',
    intro:
      'DDev keeps the workflow owner explicit: install the ddev entry in a repository, keep module skills in the global Dewey cache, and let deweyou-cli provide the manual runtime.',
    primaryCta: 'Open DDev',
    secondaryCta: 'Read operations',
    primaryHref: '/ddev/',
    secondaryHref: '/ddev/operations',
    mapTitle: 'Runtime Model',
    mapSubtitle: 'Global assets, project opt-in, branch-local evidence.',
    featuredTitle: 'DDev Flow',
    featuredSubtitle: 'The harness keeps brainstorming, UI prototypes, coding, delivery, and memory under one lifecycle owner.',
    cliTitle: 'Install Shape',
    cliSubtitle: 'Only ddev is required in each project; module skills are loaded from absolute paths in the global cache.',
    cliLinks: [
      { label: 'CLI docs', href: '/cli/' },
      { label: 'Skills', href: '/skills/' },
      { label: 'Rules', href: '/rules/' },
    ],
    mapNodes: [
      {
        title: 'Global Cache',
        href: '/cli/',
        description: 'deweyou-cli agent update refreshes skills, rules, design contracts, and module skill files under ~/.deweyou/agents/assets.',
        meta: '~/.deweyou/agents/assets/skills/<skill>/SKILL.md',
      },
      {
        title: 'Project Entry',
        href: '/ddev/operations',
        description: 'Repositories install only the ddev entry skill, then opt into default or explicit DDev use through AGENTS.md.',
        meta: 'deweyou-cli agent init --skills ddev',
      },
      {
        title: 'Manual Runtime',
        href: '/ddev/operations',
        description: 'deweyou-cli dev install creates runtime config, repo-local state, excludes, and removes old passive hooks.',
        meta: '~/.deweyou/dev + .deweyou/dev',
      },
      {
        title: 'Evidence Loop',
        href: '/ddev/framework',
        description: 'DDev records task context, graph, demos, claims, checks, screenshots, gaps, and delivery handoffs.',
        meta: 'task.md · graph.md · evidence.md · demo.md',
      },
    ],
    workflows: [
      {
        name: 'brainstorm',
        href: '/skills/problem-framing',
        description: 'Frame fuzzy ideas, compare directions, critique tradeoffs, and decide whether a demo would clarify the path.',
      },
      {
        name: 'ui prototype',
        href: '/skills/ui-design',
        description: 'When requirements touch UI, produce the smallest useful prototype before implementation.',
      },
      {
        name: 'coding loop',
        href: '/skills/spec-driven-coding',
        description: 'Align scope, implementation, tests, and verification evidence for behavior-changing work.',
      },
      {
        name: 'ship',
        href: '/skills/git-delivery',
        description: 'Protect dirty work and handle intentional commit, push, PR, and CI follow-up only when requested.',
      },
    ],
  },
  zh: {
    eyebrow: 'DDev Harness',
    title: '一个入口 skill，服务个人跨仓库开发。',
    intro:
      'DDev 把 workflow owner 显式保留下来：仓库只安装 ddev 入口，模块 skills 放在全局 Dewey cache，deweyou-cli 提供手动 runtime。',
    primaryCta: '打开 DDev',
    secondaryCta: '阅读操作手册',
    primaryHref: '/zh/ddev/',
    secondaryHref: '/zh/ddev/operations',
    mapTitle: '运行模型',
    mapSubtitle: '全局资产、仓库 opt-in、分支本地证据。',
    featuredTitle: 'DDev 流程',
    featuredSubtitle: '一套 lifecycle owner 统一管理 brainstorming、UI 原型、编码、交付和记忆。',
    cliTitle: '安装形态',
    cliSubtitle: '每个项目只需要 ddev；模块 skills 由 DDev 从全局 cache 绝对路径加载。',
    cliLinks: [
      { label: 'CLI 文档', href: '/zh/cli/' },
      { label: 'Skills', href: '/zh/skills/' },
      { label: 'Rules', href: '/zh/rules/' },
    ],
    mapNodes: [
      {
        title: '全局 Cache',
        href: '/zh/cli/',
        description: 'deweyou-cli agent update 刷新 skills、rules、design contracts，并把模块 skill 放到 ~/.deweyou/agents/assets。',
        meta: '~/.deweyou/agents/assets/skills/<skill>/SKILL.md',
      },
      {
        title: '仓库入口',
        href: '/zh/ddev/operations',
        description: '目标仓库只安装 ddev entry skill，再通过 AGENTS.md 选择默认走 DDev 或显式触发。',
        meta: 'deweyou-cli agent init --skills ddev',
      },
      {
        title: '手动 Runtime',
        href: '/zh/ddev/operations',
        description: 'deweyou-cli dev install 创建 runtime config、本地状态、exclude，并清理旧版被动 hooks。',
        meta: '~/.deweyou/dev + .deweyou/dev',
      },
      {
        title: '证据循环',
        href: '/zh/ddev/framework',
        description: 'DDev 记录任务上下文、graph、demo、claim、检查、截图、缺口和交付 handoff。',
        meta: 'task.md · graph.md · evidence.md · demo.md',
      },
    ],
    workflows: [
      {
        name: 'brainstorm',
        href: '/skills/problem-framing',
        description: '梳理模糊想法，比较方向，批判 tradeoff，并判断 demo 是否更能澄清问题。',
      },
      {
        name: 'UI prototype',
        href: '/skills/ui-design',
        description: '需求涉及 UI 时，先做最小可用原型，再进入实现。',
      },
      {
        name: 'coding loop',
        href: '/skills/spec-driven-coding',
        description: '让范围、实现、测试和验证证据在行为变更中保持对齐。',
      },
      {
        name: 'ship',
        href: '/skills/git-delivery',
        description: '只在明确请求交付时，保护 dirty work 并处理 commit、push、PR 和 CI。',
      },
    ],
  },
} as const;
</script>

<template>
  <main class="agents-home">
    <section class="agents-hero">
      <div class="agents-hero__content">
        <p class="agents-eyebrow">{{ content.eyebrow }}</p>
        <h1>{{ content.title }}</h1>
        <p class="agents-hero__intro">{{ content.intro }}</p>
        <div class="agents-hero__actions" aria-label="Primary navigation">
          <a class="agents-button agents-button--primary" :href="withBase(content.primaryHref)">{{ content.primaryCta }}</a>
          <a class="agents-button agents-button--secondary" :href="withBase(content.secondaryHref)">{{ content.secondaryCta }}</a>
        </div>
      </div>

      <div class="agents-system-map" aria-labelledby="agents-system-map-title">
        <div class="agents-section-heading agents-section-heading--compact">
          <p class="agents-eyebrow">{{ content.mapTitle }}</p>
          <h2 id="agents-system-map-title">{{ content.mapSubtitle }}</h2>
        </div>
        <div class="agents-map-grid">
          <a v-for="node in content.mapNodes" :key="node.title" class="agents-map-node" :href="withBase(node.href)">
            <span class="agents-map-node__label">{{ node.title }}</span>
            <span class="agents-map-node__description">{{ node.description }}</span>
            <span class="agents-map-node__meta">{{ node.meta }}</span>
          </a>
        </div>
      </div>
    </section>

    <section class="agents-section" aria-labelledby="agents-featured-title">
      <div class="agents-section-heading">
        <p class="agents-eyebrow">{{ content.featuredTitle }}</p>
        <h2 id="agents-featured-title">{{ content.featuredSubtitle }}</h2>
      </div>
      <div class="agents-workflow-grid">
        <a v-for="workflow in content.workflows" :key="workflow.name" class="agents-workflow-card" :href="withBase(workflow.href)">
          <span class="agents-workflow-card__name">{{ workflow.name }}</span>
          <span class="agents-workflow-card__description">{{ workflow.description }}</span>
        </a>
      </div>
    </section>

    <section class="agents-cli" aria-labelledby="agents-cli-title">
      <div class="agents-cli__copy">
        <p class="agents-eyebrow">{{ content.cliTitle }}</p>
        <h2 id="agents-cli-title">{{ content.cliSubtitle }}</h2>
        <div class="agents-cli__links" aria-label="CLI related links">
          <a v-for="link in content.cliLinks" :key="link.href" :href="withBase(link.href)">{{ link.label }}</a>
        </div>
      </div>
      <pre class="agents-command" aria-label="DDev setup command"><code>npm install -g deweyou-cli
deweyou-cli agent update
deweyou-cli agent init --skills ddev --mode link --yes
deweyou-cli dev install
deweyou-cli dev doctor</code></pre>
    </section>
  </main>
</template>
