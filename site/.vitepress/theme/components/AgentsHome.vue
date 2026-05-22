<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'

type Locale = 'en' | 'zh'

const props = defineProps<{
  locale: Locale
}>()

const content = computed(() => pageContent[props.locale])

const pageContent = {
  en: {
    eyebrow: 'Agent Asset System',
    title: 'Reusable agent workflows for real repositories.',
    intro:
      'A compact hub for skills, rules, design contracts, and the CLI that installs them into real repositories.',
    mapParagraph:
      'Start from the system map: skills drive active workflows, rules keep routine work consistent, design contracts shape interfaces, and deweyou-cli wires the pieces into a project.',
    primaryCta: 'Browse skills',
    secondaryCta: 'Read the guide',
    skillsHref: '/skills/',
    guideHref: '/guide/',
    mapTitle: 'System map',
    mapSubtitle: 'Four asset types, one installable agent context.',
    featuredTitle: 'Featured workflows',
    featuredSubtitle: 'Start with the workflows that protect context, delivery, implementation, and interface quality.',
    cliTitle: 'CLI setup',
    cliSubtitle: 'Refresh the asset cache, install selected workflows, then verify the repository context.',
    cliLinks: [
      { label: 'CLI docs', href: '/cli/' },
      { label: 'Design contracts', href: '/design/' },
      { label: 'Rules', href: '/rules/' },
    ],
    mapNodes: [
      {
        title: 'Skills',
        href: '/skills/',
        description: 'Active workflows for memory, delivery, specs, design, and evaluation.',
        meta: 'skills/<name>/SKILL.md',
      },
      {
        title: 'Rules',
        href: '/rules/',
        description: 'Passive preferences for code style, engineering choices, and collaboration.',
        meta: 'rules/<name>.md',
      },
      {
        title: 'Design',
        href: '/design/',
        description: 'Reusable interface contracts for restrained, useful product surfaces.',
        meta: 'design/<name>.md',
      },
      {
        title: 'deweyou-cli',
        href: '/cli/',
        description: 'Installs selected assets, renders context, and checks repository wiring.',
        meta: 'agent init · doctor · context',
      },
    ],
    workflows: [
      {
        name: 'repo-memory',
        href: '/skills/repo-memory',
        description: 'Preserves durable repository knowledge before commits and after meaningful changes.',
      },
      {
        name: 'git-delivery',
        href: '/skills/git-delivery',
        description: 'Protects dirty work, stages intentionally, commits, pushes, and prepares PR delivery.',
      },
      {
        name: 'spec-driven-coding',
        href: '/skills/spec-driven-coding',
        description: 'Keeps features, plans, implementation, and verification aligned as behavior changes.',
      },
      {
        name: 'ui-design',
        href: '/skills/ui-design',
        description: 'Guides UX structure, visual quality, implementation checks, and design contract use.',
      },
    ],
  },
  zh: {
    eyebrow: 'Agent 资产系统',
    title: '接入真实仓库的可复用 agent 工作流。',
    intro: '一个紧凑的资产中心，集中维护 skills、rules、设计契约，以及把它们安装进真实仓库的 CLI。',
    mapParagraph:
      '先看系统地图：skills 驱动主动工作流，rules 保持日常工作一致，design contracts 约束界面表达，deweyou-cli 把这些资产接入项目。',
    primaryCta: '浏览 Skills',
    secondaryCta: '阅读指南',
    skillsHref: '/zh/skills/',
    guideHref: '/zh/guide/',
    mapTitle: '系统地图',
    mapSubtitle: '四类资产，组成一套可安装的 agent context。',
    featuredTitle: '精选工作流',
    featuredSubtitle: '从保护上下文、交付、实现过程和界面质量的工作流开始。',
    cliTitle: 'CLI 设置',
    cliSubtitle: '刷新资产缓存，安装选中的工作流，然后检查仓库 context 是否接入正确。',
    cliLinks: [
      { label: 'CLI 文档', href: '/zh/cli/' },
      { label: '设计契约', href: '/zh/design/' },
      { label: 'Rules', href: '/zh/rules/' },
    ],
    mapNodes: [
      {
        title: 'Skills',
        href: '/zh/skills/',
        description: '用于记忆、交付、规格、设计和评测的主动工作流。',
        meta: 'skills/<name>/SKILL.md',
      },
      {
        title: 'Rules',
        href: '/zh/rules/',
        description: '用于代码风格、工程判断和协作习惯的被动偏好。',
        meta: 'rules/<name>.md',
      },
      {
        title: 'Design',
        href: '/zh/design/',
        description: '用于克制、清晰、可用产品界面的可复用设计契约。',
        meta: 'design/<name>.md',
      },
      {
        title: 'deweyou-cli',
        href: '/zh/cli/',
        description: '安装选中的资产，渲染 context，并检查仓库接入状态。',
        meta: 'agent init · doctor · context',
      },
    ],
    workflows: [
      {
        name: 'repo-memory',
        href: '/zh/skills/repo-memory',
        description: '在提交前和重要变更后沉淀仓库长期知识。',
      },
      {
        name: 'git-delivery',
        href: '/zh/skills/git-delivery',
        description: '保护未提交改动，精确 staging，并完成提交、推送与 PR 交付准备。',
      },
      {
        name: 'spec-driven-coding',
        href: '/zh/skills/spec-driven-coding',
        description: '让功能、计划、实现和验证在行为变更中保持对齐。',
      },
      {
        name: 'ui-design',
        href: '/zh/skills/ui-design',
        description: '指导 UX 结构、视觉质量、实现检查和设计契约使用。',
      },
    ],
  },
} as const
</script>

<template>
  <main class="agents-home">
    <section class="agents-hero">
      <div class="agents-hero__content">
        <p class="agents-eyebrow">{{ content.eyebrow }}</p>
        <h1>{{ content.title }}</h1>
        <p class="agents-hero__intro">{{ content.intro }}</p>
        <p class="agents-hero__map-copy">{{ content.mapParagraph }}</p>
        <div class="agents-hero__actions" aria-label="Primary navigation">
          <a class="agents-button agents-button--primary" :href="withBase(content.skillsHref)">{{ content.primaryCta }}</a>
          <a class="agents-button agents-button--secondary" :href="withBase(content.guideHref)">{{ content.secondaryCta }}</a>
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
      <pre class="agents-command" aria-label="CLI setup command"><code>npm install -g deweyou-cli
deweyou-cli agent update
deweyou-cli agent init --skills repo-memory,git-delivery,spec-driven-coding --rules code-style
deweyou-cli agent doctor</code></pre>
    </section>
  </main>
</template>
