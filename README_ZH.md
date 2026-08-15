# Deweyou Harness

Deweyou Harness 是一个面向 Codex 的通用工作流插件。插件只提供一个用户入口
`/dhw`，以及一个本地 MCP Server，用于校验配置、编排 DAG、渐进加载资源并记录
可重放的 Run 证据。

Harness Core 不内置 coding、写作、视频、产品或仓库规则。工作区通过
`harness.yaml` 注入 skills、rules、knowledge、nodes 和 workflows。

## 开发验证

```bash
pnpm install
pnpm run check
pnpm run test:coverage
pnpm run validate:plugin
```

仓库会跟踪打包后的 `dist/server.mjs`，插件安装后不依赖 TypeScript 运行时。
本项目不再发布公共 CLI，也不迁移旧 DDev/Brain 状态。

完整契约见 [Harness Core](docs/harness-core.md)。
