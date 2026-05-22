import { defineConfig } from 'vitepress'

const skillItems = [
  { text: 'repo-memory', link: '/skills/repo-memory' },
  { text: 'git-delivery', link: '/skills/git-delivery' },
  { text: 'spec-driven-coding', link: '/skills/spec-driven-coding' },
  { text: 'skill-eval', link: '/skills/skill-eval' },
  { text: 'product-notes', link: '/skills/product-notes' },
  { text: 'ui-design', link: '/skills/ui-design' },
  { text: 'product-design', link: '/skills/product-design' },
]

const zhSkillItems = skillItems.map((item) => ({
  ...item,
  link: `/zh${item.link}`,
}))

export default defineConfig({
  title: 'Agents',
  description: 'Reusable agent skills, rules, design contracts, and CLI docs.',
  base: '/agents/',
  cleanUrls: true,
  lastUpdated: true,
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/' },
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
    socialLinks: [
      { icon: 'github', link: 'https://github.com/deweyou/agents' },
    ],
  },
})
