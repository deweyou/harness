# Harness Work

Deweyou Harness Work 是插件唯一面向用户的 Skill，并且只接受显式触发：用户调用
`/harness-work`、引用 `$harness-work`，或在宿主界面明确选择 Deweyou Harness 插件。
仅安装插件或普通请求的语义相似，不会激活本 Skill。触发后可以创建、迭代或迁移
仓库配置，也可以提交需要持久化执行的任务。主 Agent 会在需要时建立
Commitment，为当前任务提出 Plan，把边界清晰的节点执行优先交给 Subagent，渐进
激活所需能力，并将可复盘的 Run 保存到 `~/.deweyou/harness/`。`harness.yaml`
只声明工作空间策略、资源和节点能力，不声明工作流。
新建 Run 前，`workspace_prepare` 会先拉取 base，再根据根配置中的 `strategy`
准备本地任务分支或隔离 worktree；`run_create` 必须携带返回的 Receipt。

用户明确要求沉淀或回溯仓库知识时，本 Skill 也会进入统一的 Evidence 驱动维护
流程。根目录和模块级 `AGENTS.md` 只负责约束与导航，长期知识放在对应作用域的
`docs/` 中。

执行中的小改动默认走最小增量 Plan：复用未受影响的成果，只重跑受影响节点并
补充必要的局部验证，不重新执行整套方案和实现。

每轮回复末尾都说明下一步的具体行动及执行者；正在提问或请求确认时，以问题或
确认请求收尾即可。已有授权且可执行的工作继续推进，不要求用户回复“继续”。
任务完成后明确说明已无必须执行的后续工作，可选建议不会自动扩大任务范围。

问题澄清保持轻量、自然，不会变成固定阶段。需要长期保留的 Spec 通过通用
Markdown Export 沉淀，Dashboard 统一预览 Markdown 和 JSON Export。初始化仓库
知识时可以安全建立 `CLAUDE.md -> AGENTS.md`，关系复杂时优先用 Mermaid，并为
持续维护的文档保留简洁的更新时间 footer。

配置与运行时契约见 [Harness Core](../../docs/harness-core.md)。
