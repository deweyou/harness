<!-- Chinese reading companion
source: skills/spec-driven-coding/SKILL.md
source-digest: sha256:7f8e721dca1d019e08cdfb82a30a512e3c22cc3610fff8de8142cb342c67c1cb
translation-status: current
description: DDev 原生的需求对齐、实现和验证编码工作流。
-->

# spec-driven-coding

> DDev-native coding workflow，用于行为对齐、调试、TDD 和验证。

## 它是做什么的

`spec-driven-coding` 让实现始终和预期行为、验证证据保持一致。它支持轻量的
feature alignment、调试、可行时先写回归测试、TDD，以及编码过程中需求变化的处理。
当 `ddev` 调用它时，它是 coding-flow 模块，会在收集完编码证据后把生命周期控制权交还
给 DDev。

```mermaid
flowchart TD
    Task["编码任务"] --> Classify["分类范围"]
    Classify --> Feature["Feature alignment flow"]
    Classify --> Bugfix["轻量 bugfix flow"]
    Classify --> Debug["Debugging flow"]
    Feature --> Criteria["起草简短 spec 和验收标准"]
    Criteria --> Gate{"关键产品决策已解决？"}
    Gate -->|"用户明确确认"| Plan["规划实现"]
    Gate -->|"已有定义或明确委托低风险选择"| Plan
    Gate -->|"否"| Wait["展示 spec 并等待"]
    Bugfix --> Debug["复现并理解问题"]
    Debug --> Regression["可行时先加回归测试"]
    Plan --> Code["带测试实现"]
    Regression --> Code
    Code --> Evidence["收集验证证据"]
    Evidence --> DDev["作为模块调用时交还 DDev"]
```

## 什么时候触发

- 开始新功能或行为变更。
- 多步骤实现工作。
- 需求模糊，需要先对齐行为或风险。
- 简单 bugfix 仍需要调试、回归测试和验证。
- 编码过程中发现需求变化。

## 安装

```bash
npx skills add deweyou/agents --skill spec-driven-coding
```

仓库级接入更推荐：

```bash
deweyou-cli agent init --skills spec-driven-coding
```

## 特点

- 将工作分类为 feature alignment、轻量 bugfix、debugging 或非编码 flow。
- 实现前捕获目标、非目标、受影响行为、验收标准、可能文件和验证方式。
- 把“请实现”理解为允许启动开发流程，而不是批准 Agent 推断出的需求。
- 模糊的新功能必须先展示简短 spec，并在用户明确确认后才能编辑产品源码。
- 对大范围或高风险工作使用简洁计划，但不要求外部 workflow backend。
- 简单 bugfix 聚焦复现、回归测试、最小责任边界修复和目标验证。
- 当需求或长期行为变化时，更新任务上下文或 repo memory。
- 被 DDev 作为模块调用时，在编码证据完成后交还 DDev。

## SOP

1. 编辑前先分类任务。
2. 对 feature alignment，捕获行为边界和验收标准，并判断是否需要确认。
3. 当关键产品行为来自 Agent 推断时，展示简短 spec，等待用户明确确认后再编辑产品源码。
4. 对轻量 bugfix，复现问题，并在可行时添加回归测试。
5. 用 TDD 实现；当测试无法覆盖风险时，使用聚焦验证。
6. 将改动限制在已确认需求、假设和验证地图内。
7. 实现过程中需求变化时，更新任务上下文或重新对齐。
8. 运行相关项目检查并收集验证证据。
9. 只有当长期记忆或交付需要时，才运行 `repo-memory` 或 `git-delivery`。

## Source

This skill is maintained in `deweyou/agents` and indexed by
`deweyou-cli agent update`.
