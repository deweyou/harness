import { defineConfig } from 'vitepress';

const skillItems = [
  { text: 'ddev', link: '/skills/ddev' },
  { text: 'problem-framing', link: '/skills/problem-framing' },
  { text: 'product-design', link: '/skills/product-design' },
  { text: 'ui-design', link: '/skills/ui-design' },
  { text: 'spec-driven-coding', link: '/skills/spec-driven-coding' },
  { text: 'git-delivery', link: '/skills/git-delivery' },
  { text: 'repo-memory', link: '/skills/repo-memory' },
  { text: 'product-notes', link: '/skills/product-notes' },
  { text: 'skill-eval', link: '/skills/skill-eval' },
];

const zhSkillItems = skillItems.map((item) => ({
  ...item,
  link: item.link,
}));

export default defineConfig({
  title: 'Agents',
  description: 'Reusable agent skills, rules, design contracts, CLI docs, and DDev harness docs.',
  base: '/agents/',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    config(markdown) {
      useMermaidFence(markdown);
    },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/' },
          { text: 'DDev', link: '/ddev/' },
          { text: 'Skills', link: '/skills/' },
          { text: 'Rules', link: '/rules/' },
          { text: 'Design', link: '/design/' },
          { text: 'CLI', link: '/cli/' },
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [{ text: 'Overview', link: '/guide/' }],
          },
          {
            text: 'DDev',
            items: [
              { text: 'Overview', link: '/ddev/' },
              { text: 'Operations', link: '/ddev/operations' },
              { text: 'Framework', link: '/ddev/framework' },
            ],
          },
          {
            text: 'Skills',
            items: [{ text: 'Overview', link: '/skills/' }, ...skillItems],
          },
          {
            text: 'Assets',
            items: [
              { text: 'Rules', link: '/rules/' },
              { text: 'Design', link: '/design/' },
              { text: 'CLI', link: '/cli/' },
            ],
          },
        ],
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh/guide/' },
          { text: 'DDev', link: '/zh/ddev/' },
          { text: 'Skills', link: '/zh/skills/' },
          { text: 'Rules', link: '/zh/rules/' },
          { text: 'Design', link: '/zh/design/' },
          { text: 'CLI', link: '/zh/cli/' },
        ],
        sidebar: [
          {
            text: '指南',
            items: [{ text: '概览', link: '/zh/guide/' }],
          },
          {
            text: 'DDev',
            items: [
              { text: '概览', link: '/zh/ddev/' },
              { text: '操作手册', link: '/zh/ddev/operations' },
              { text: '技术方案', link: '/zh/ddev/framework' },
            ],
          },
          {
            text: 'Skills',
            items: [{ text: '概览', link: '/zh/skills/' }, ...zhSkillItems],
          },
          {
            text: '资产',
            items: [
              { text: 'Rules', link: '/zh/rules/' },
              { text: 'Design', link: '/zh/design/' },
              { text: 'CLI', link: '/zh/cli/' },
            ],
          },
        ],
      },
    },
  },
  themeConfig: {
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/deweyou/agents' }],
  },
});

function useMermaidFence(markdown) {
  const defaultFenceRule = markdown.renderer.rules.fence;

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0];

    if (language !== 'mermaid') {
      return defaultFenceRule?.(tokens, index, options, env, self) ?? self.renderToken(tokens, index, options);
    }

    return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />`;
  };
}
