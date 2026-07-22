<!-- Chinese reading companion
source: rules/ddev-local-state.md
source-digest: sha256:01a3cb08a6a3b368b157748448b467bf014316a7f9aa75acaf2336ee5c08dffe
translation-status: current
description: 关于 ~/.deweyou/dev 下全局 DDev 本地状态的所有权、可见性、清理和提交边界。
-->

# DDev 本地状态

任务创建、读取、解释、清理、忽略、暂存或提交 DDev runtime 状态时使用本 Rule。

## 默认原则

- DDev 本地状态位于 `~/.deweyou/dev/`。
- 每个仓库的 session 位于
  `~/.deweyou/dev/repos/<repo-id>/sessions/<session-id>/`；branch、worktree 和 head
  只是元数据，不是 session 身份。
- 把 DDev 状态视为本地工作记忆，而不是项目源码。
- 不要创建项目内的 `.deweyou/dev/` 状态。
- 只有显式调用 DDev、仓库把 DDev 设为默认工作流，或正在运行
  `deweyou-cli dev` 命令时，才创建或更新 DDev 状态。
- 不要安装或依赖被动全局 hooks 来激活 DDev。
- 如果出现项目内 `.deweyou/dev/`，不要提交它；除非用户明确要求对 fixture 或示例做版本管理，
  否则把它视为旧版 DDev 状态。
- 新的全局状态安装不要向项目 `.gitignore` 或 `.git/info/exclude` 添加 DDev 忽略项。
- DDev 创建本地状态后，通过 `doctor`、`status` 或最终交接让它可见；不要留下无法解释的
  runtime 目录。
- 正常完成使用 `session close`；需要本地保留使用 `session archive`。
- 永久 `clean` 必须显式带 `--force`、拒绝删除 active session，并且只能删除 DDev
  拥有的状态，同时说明删除了什么。
- `uninstall` 只能删除当前仓库的全局 DDev 状态、旧版仓库内 DDev 状态、精确匹配的旧版
  DDev git exclude 行、旧的 DDev 被动 hooks，以及在没有其他仓库状态时的 runtime 根目录。
  不要影响无关的 harness Agent 和 hooks。

## Task Session

- 任务状态保存在 `~/.deweyou/dev/repos/<repo-id>/sessions/<session-id>/`。
- 四个核心 session 文件保持简短和临时；其他 artifact 只在有助于恢复、review 或证据时
  创建。
- 旧 branch 命名 session 和路径型 repo root 作为可见 legacy 状态保留，不隐式迁移或
  删除。
- 长期知识应进入仓库文档或 `repo-memory`，不要只保存在 DDev session 文件中。
- 使用 `graph.md` 记录轻量依赖，使用 `evidence.md` 记录结论、证据和未解决缺口。
- 不要把重放完整对话作为状态来源；应保存简短事实和证据链接。

## 暂存边界

Commit 或 PR 交付前：

- DDev 状态通常应位于仓库之外，不出现在 `git status` 中。
- 如果项目内 `.deweyou/dev/` 出现在 `git status` 中，默认不要暂存。
- 相关时，将其报告为旧版 DDev 状态。
