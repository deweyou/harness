# ddev

> 面向 DDev 会话的个人跨仓库开发 harness 工作流。

## 它是做什么的

`ddev` 是 DDev 的工作流 owner。它负责仓库摸底、必要歧义澄清、
`~/.deweyou/dev/` 下的全局按仓库 session 状态、harness map、有边界的实现与验证
循环，以及按需路由交付和长期记忆模块。

DDev 默认手动激活：用户显式输入 `$DDev` / `ddev`，或项目指令把它设为非平凡
开发任务的默认工作流。它不依赖全局被动 hooks。

对于编码和架构工作，DDev 强依赖两个 rule：写、改、审代码前读取
`code-style`；模块设计、边界重构、依赖变更或有架构影响的行为变更前读取
`engineering-principles`。DDev 直接从全局 Dewey asset cache 读取它们，不要求
用户全局安装或逐仓库安装。

```mermaid
flowchart TD
    Request["DDev 任务"] --> Orient["摸底并判断操作类型"]
    Orient --> Rules["按操作读取强依赖 rules"]
    Rules --> Modules["按需加载能力 modules"]
    Modules --> Loop["实现与验证循环"]
    Loop --> Evidence["证据与交付判断"]
```

## 安装

```bash
npx skills add https://github.com/deweyou/agents --skill ddev
```

完整本地 runtime 推荐：

```bash
npm install -g deweyou-cli
deweyou-cli agent update
deweyou-cli agent init --skills ddev --mode link --yes
deweyou-cli dev install
deweyou-cli dev doctor
```

模块 skills 位于 `~/.deweyou/agents/assets/skills/<skill>/SKILL.md`；强依赖 rules
位于 `~/.deweyou/agents/assets/rules/`。对 DDev 来说，刷新 asset cache 即可，不需要
额外安装这两个 rules。

## 特点

- 一个 owner 管理 framing、UI、编码、证据、交付和记忆的完整生命周期。
- 分支级、人可读的临时工作状态放在项目源码之外。
- 按操作强制读取缓存中的 `code-style` 和 `engineering-principles`。
- UI 任务需要时执行原型和现场证据门禁。
- 只有用户明确要求时才交付，不静默 commit、push、开 PR 或安装被动 hooks。

## SOP

1. 显式触发 DDev 或通过项目指令启用，并运行 `deweyou-cli dev doctor`。
2. 分类请求、捕获必要状态并识别项目 harness。
3. 在对应编码或架构操作前读取强依赖 rules；文件缺失时刷新 cache，仍缺失则停止。
4. 按需加载能力 modules，执行有边界的实现和验证循环并记录证据。
5. 仅在任务需要时路由交付或长期记忆。

## Source

This skill is maintained in `deweyou/agents` and indexed by
`deweyou-cli agent update`.
