# Agents

[English](./README.md) | [简体中文](./README_ZH.md)

网站：[deweyou.github.io/agents](https://deweyou.github.io/agents/)

个人 agent 资产中心。这个仓库集中维护可复用的 **skills**、
**rules**，以及 `deweyou-cli` 包，用来把这些资产一致地安装或接入到其他仓库。

## 当前仓库包含什么

| 区域 | 位置 | 用途 |
|------|------|------|
| Skills | [`skills/`](./skills/) | 会在特定 agent 任务中主动触发的工作流。 |
| Rules | [`rules/`](./rules/) | 跨项目复用的被动编码与开发偏好。 |
| Design | [`design/`](./design/) | 用于 AI 辅助 UI 工作的可复用界面设计契约。 |
| CLI | [`cli/`](./cli/) | `deweyou-cli` 二进制命令的 TypeScript 包。 |
| Docs | [`docs/`](./docs/) | 仓库工作流、设计记录和实现计划。 |
| Tests | [`tests/`](./tests/) | 资产注册表与扫描逻辑测试。 |

`AGENTS.md` 是给 agent 使用的导航页。仓库工作流细节记录在
[`docs/asset-workflow.md`](./docs/asset-workflow.md)。

## deweyou-cli

`deweyou-cli` 用来把可复用 agent 工作流引入任意本地仓库。它会从这个资产中心刷新本地 skills、rules 和 design contracts 缓存，给仓库初始化选中的资产，渲染当前仓库启用的 agent context，并诊断仓库接入是否正常。

全局安装：

```bash
npm install -g deweyou-cli
deweyou-cli agent update
```

默认情况下，`agent update` 会把 `https://github.com/deweyou/agents.git`
克隆或拉取到 `~/.deweyou/agents/source`。如果本地开发时需要使用指定 checkout，可以设置：

```bash
export DEWEYOU_AGENTS_SOURCE=/path/to/deweyou/agents
deweyou-cli agent update
```

初始化另一个仓库：

```bash
cd /path/to/your/repo
deweyou-cli agent init
deweyou-cli agent doctor
deweyou-cli agent context --format markdown
```

脚本化初始化示例：

```bash
deweyou-cli agent init --all --mode link --yes
deweyou-cli agent init --skills repo-memory,spec-driven-coding,git-delivery --rules code-style
deweyou-cli agent init --skills ui-design --design dewey-interface
deweyou-cli agent init --global --tools codex --skills repo-memory,git-delivery --yes
deweyou-cli agent init --dry-run
```

### CLI 命令

| 命令 | 用途 |
|------|------|
| `deweyou-cli agent update` | 刷新本地资产缓存和生成的 registry。 |
| `deweyou-cli agent init` | 把选中的 skills、rules 和可选 `DESIGN.md` 加入当前仓库；也可用 `--global` 做用户级安装。 |
| `deweyou-cli agent context --format markdown` | 输出当前仓库启用的 agent instructions。 |
| `deweyou-cli agent context --format json` | 输出给工具使用的结构化 context。 |
| `deweyou-cli agent doctor` | 检查缓存、manifest、符号链接、已选资产和 hash 是否一致。 |

### 安装模式

| 模式 | 写入仓库的内容 | 适合场景 |
|------|----------------|----------|
| `link` | 把选中的资产符号链接到 `.agents/skills/`、`.agents/rules/`，并可选写入根目录 `DESIGN.md`。 | 日常本地开发，希望缓存更新后仓库立即看到变化。 |
| `copy` | 把选中的资产复制到 `.agents/skills/`、`.agents/rules/`，并可选写入根目录 `DESIGN.md`。 | 希望仓库保留一份已选资产快照。 |
| `pointer` | 只写入 `.agents/manifest.json` 和 `AGENTS.md`；资产仍保留在全局缓存中。 | 希望仓库占用最少文件。 |

## Skills

Skills 是主动工作流。它们位于 `skills/<name>/SKILL.md`，也可能包含面向人的
`README.md` 和 `README_ZH.md`、references、scripts、assets、previews 或 eval cases。

| Skill | 介绍 | 来源 |
|-------|------|------|
| `repo-memory` | 仓库长期记忆工作流。它初始化和刷新 durable repo context，运行提交前记忆检查，在工作改变重要知识时更新文档，并检查本地 skill drift。 | [`skills/repo-memory/`](./skills/repo-memory/) |
| `git-delivery` | 分支感知的 git 交付工作流，覆盖分支准备、有意 staging、提交、base 分支冲突检查、安全 rebase、push、PR 创建、CI 跟进和明确低风险 CI 失败的自动修复。 | [`skills/git-delivery/`](./skills/git-delivery/) |
| `spec-driven-coding` | 面向功能、行为变更和多步骤实现的 spec-driven coding 工作流。它让 Superpowers spec、plan、TDD、验证和需求更新在编码前后保持一致。 | [`skills/spec-driven-coding/`](./skills/spec-driven-coding/) |
| `skill-eval` | 仓库本地的 skill 评测工作流。它可以生成 eval cases，通过 agent CLI 运行 routing 或 execution 测试，给 transcript 打分并汇总触发准确率。 | [`skills/skill-eval/`](./skills/skill-eval/) |
| `product-notes` | 产品笔记工作流，用于分类并沉淀产品想法、定位变化、迭代规格、决策、洞察和复盘。 | [`skills/product-notes/`](./skills/product-notes/) |
| `ui-design` | UX/UI 设计工作流，用于跨 Web、移动端、HarmonyOS、小程序、macOS、仪表盘和工具进行模式调研、流程设计、视觉风格、实现、审查和 AI 设计 prompt 生成。 | [`skills/ui-design/`](./skills/ui-design/) |
| `product-design` | 面向个人产品的产品设计工作流。它在需要时调研现有产品，避免企业级流程表演，并给出合适深度的方向、版本或验证步骤建议。 | [`skills/product-design/`](./skills/product-design/) |

### 直接安装 Skills

用 Skills CLI 安装单个 skill：

```bash
npx skills add deweyou/agents --skill repo-memory
```

按需替换 skill 名称：

```bash
npx skills add deweyou/agents --skill git-delivery
npx skills add deweyou/agents --skill spec-driven-coding
npx skills add deweyou/agents --skill skill-eval
npx skills add deweyou/agents --skill product-notes
npx skills add deweyou/agents --skill ui-design
npx skills add deweyou/agents --skill product-design
```

如果要给整个仓库接入一组选中的 skills、rules 和设计契约，更推荐使用
`deweyou-cli agent init`，这样选择结果会一起记录在 `.agents/manifest.json`。

## Rules

Rules 是被动偏好和约束。它们位于 `rules/<name>.md`，并通过 `deweyou-cli` 按仓库选择启用。

| Rule | 介绍 | 来源 |
|------|------|------|
| `collaboration-defaults` | 默认 agent 协作行为，覆盖语言、歧义、上下文、任务顺序、并行工作、证据、安全和交付。 | [`rules/collaboration-defaults.md`](./rules/collaboration-defaults.md) |
| `code-style` | 命名、函数、注释、错误处理和测试的局部代码表达偏好。 | [`rules/code-style.md`](./rules/code-style.md) |
| `engineering-principles` | 模块边界、抽象、依赖、状态和易删除代码的设计偏好。 | [`rules/engineering-principles.md`](./rules/engineering-principles.md) |

## Design

设计契约在这个资产中心里放在 [`design/`](./design/) 下。它们是项目级设计契约：
一部分是设计规则，一部分是 token map，一部分是组件指导。`ui-design` 会优先读取
项目本地的 `DESIGN.md`；`deweyou-cli agent init --design dewey-interface`
会把 [`design/dewey-interface.md`](./design/dewey-interface.md) 安装到目标仓库根目录为
`DESIGN.md`。

| Design Contract | 介绍 | 来源 |
|-----------------|------|------|
| `dewey-interface` | 面向个人产品的克制、排版驱动、组件化界面风格。 | [`design/dewey-interface.md`](./design/dewey-interface.md) |

## 开发

修改 skills 或 rules 后运行：

```bash
pnpm run lint:assets
```

修改资产扫描行为后运行：

```bash
pnpm test
pnpm run coverage
```

修改 CLI 行为后运行：

```bash
pnpm run typecheck:cli
pnpm run test:cli
pnpm run coverage:cli
cd cli && npm pack --dry-run
```

每个新增或修改过的 skill 都必须更新 `skills/<name>/evals/evals.json`
中的 eval cases。执行 LLM-backed evals 是单独步骤，只有在用户明确要求时才运行。

每个 skill 目录都必须包含 `README.md` 和 `README_ZH.md`，说明概括、安装方式、
特点、SOP，并在有帮助时加入 Mermaid 图。每次 skill 工作流变化时都要同步更新两份
README。
