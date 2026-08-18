# Deweyou Harness

Deweyou Harness 是一个支持 Codex、Claude Code、Cursor、Trae、OpenClaw 和 Hermes
Agent 的通用工作流插件。
插件只提供一个用户入口 `/dhw`，以及一个本地 MCP Server，用于校验配置、编排
DAG、渐进加载资源并记录可重放的 Run 证据，并在交付后生成有证据归因的资源优化
建议。

Harness Core 不内置 coding、写作、视频、产品或仓库规则。工作区通过
`harness.yaml` 注入 skills、rules、knowledge、nodes 和 workflows。

## 环境要求

- Node.js 22.5 或更高版本
- 工作区内存在 `harness.yaml`

## 安装

### Codex

```bash
codex plugin marketplace add deweyou/harness
codex plugin add deweyou-harness@deweyou
```

安装后开启一个新的 Codex session，再调用 `/dhw`。

### Claude Code

```bash
claude plugin marketplace add deweyou/harness
claude plugin install deweyou-harness@deweyou
```

在 Claude Code 中执行 `/reload-plugins`，然后调用
`/deweyou-harness:dhw`。Claude Code 会自动为插件 Skill 添加插件命名空间。

本地开发时也可以只在当前 session 加载：

```bash
claude --plugin-dir /absolute/path/to/harness
```

### Cursor

```bash
git clone https://github.com/deweyou/harness.git ~/.cursor/plugins/local/deweyou-harness
```

重启 Cursor 或执行 `Developer: Reload Window`，然后调用 `/dhw`。本地开发时可以
改用软链接：

```bash
ln -s /absolute/path/to/harness ~/.cursor/plugins/local/deweyou-harness
```

更新通过 clone 安装的插件：

```bash
git -C ~/.cursor/plugins/local/deweyou-harness pull --ff-only
```

### Trae

把下面这段 prompt 直接粘贴到 Trae：

```text
请从 https://github.com/deweyou/harness 安装 Deweyou Harness，把它作为原生
Trae 插件接入。将仓库根目录作为插件根目录，通过
.trae-plugin/plugin.json 发现插件，通过 skills/dhw/agents/openai.yaml
注册 dhw Skill，并从 .trae-mcp.json 加载 MCP 配置。直接使用仓库内已跟踪的
dist/server.mjs，不要执行 pnpm install。安装后请报告实际插件根目录，并检查
manifest、dhw Skill 和 deweyou-harness MCP Server 是否都已被识别。如果仍需用户
启用插件，请提示我到 Trae 的插件设置中启用，不要直接修改 Trae 的内部插件配置。
```

如有提示，在 Trae 插件设置中启用 **Deweyou Harness**，开启新 session 后调用
`/dhw`。还可以让 Trae 列出 `deweyou-harness` 的 MCP tools，确认 runtime 已连接。

插件和 Skill 共用同一套四节点 Harness 标识，方便在菜单和侧边栏的小尺寸场景中识别。

### OpenClaw

```bash
openclaw plugins install git:github.com/deweyou/harness
openclaw plugins enable deweyou-harness
openclaw gateway restart
```

检查 Skill 和 MCP Server 是否都被识别：

```bash
openclaw plugins inspect deweyou-harness
```

开启新 session 后调用 `/dhw`，也可以在 prompt 中引用 `$dhw`。

### Hermes Agent

Hermes 通过 Agent Plugins v1 兼容层加载当前仓库：

```bash
hermes plugins install deweyou/harness --enable
hermes plugins list
```

开启新的 Hermes session，然后要求它使用 Deweyou Harness 的 `dhw` Skill。Portable
Plugin Skill 是只读且带命名空间的；需要精确名称时先调用 `skills_list`，再通过
`skill_view` 加载。

## 开发验证

```bash
pnpm install
pnpm run check
pnpm run test:coverage
pnpm run validate:plugin
```

每次非 release 提交进入 `main` 后都会触发 Release workflow。它会读取尚未发布的
Conventional Commit：`!`/`BREAKING CHANGE` 升 major，`feat` 升 minor，其余改动升
patch；随后统一更新所有宿主 manifest 的版本、在 `CHANGELOG.md` 顶部增加记录、重新
构建 `dist/server.mjs`、执行完整校验，并把 `chore(release): v<version>` 提交回
`main`。Release commit 不会再次参与版本计算，也不会造成触发循环。

仓库会跟踪自包含的 `dist/server.mjs`，插件安装后不依赖 TypeScript 运行时或
`node_modules`。各宿主
manifest 只负责适配插件发现和 MCP 路径解析，各端共享同一份 Skill、Core、schema
和运行时 bundle。本项目不再发布公共 CLI，也不迁移旧 DDev/Brain 状态。

完整契约见 [Harness Core](docs/harness-core.md)。
