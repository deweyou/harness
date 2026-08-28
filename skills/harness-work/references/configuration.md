# Configuration Lifecycle

Use this workflow only when one of these conditions is true:

- `harness.yaml` is absent and the user explicitly asks to configure Harness
  or start Harness work in the current workspace;
- the user explicitly asks to add, remove, or revise Harness configuration; or
- run preflight finds a configuration version that the installed Harness Core
  does not support.

Read-only questions, Dashboard browsing, and Run inspection must not create or
rewrite workspace configuration.

## Establish The Target

Treat the installed `schemas/harness.schema.json` and `config_inspect` as the
current contract. Never infer the target version from an old Run snapshot or
silently downgrade a configuration produced by a newer Harness version.

Classify the change before editing:

- **create**: no workspace configuration exists;
- **update**: the current version is supported and the user requested a
  semantic change;
- **migrate**: the version is unsupported but can be translated to the current
  contract without inventing product intent.

If the configuration is newer than the installed contract, stop and recommend
upgrading the plugin. Do not attempt a downgrade.

## Create Or Update

Inspect the repository only as far as needed to identify real repository
Context, reusable Skills, commands, and Node Definitions. Preserve repository-owned naming
and commands. Keep `harness.yaml` domain-neutral: it may declare imports,
the root workspace strategy, Context, Skills, and reusable nodes, but not
task-specific dependencies, Workflows, or fixed Stages. `strategy` is only
`branch` or `worktree`; do not add configuration for base branches, remotes,
branch names, or synchronization mechanics. Dependencies belong to each Run's
Plan. Use readable Node IDs as both stable references and display labels; do
not add a duplicate Node `name`. Keep every import path relative to the configuration file that declares
it; absolute paths are invalid because repository configuration must remain
portable. A Context resource entry must identify one explicit file such as
`AGENTS.md` or `docs/architecture.md`; never point Context at a directory and
rely on an inferred entrypoint. A Skill may point at its directory because
`SKILL.md` is standardized. Resource sources contain only an optional `repo`
and required `entry`. Context applies to the repository/Run and is not
referenced by individual Nodes. A Node's `skill` list may reference only IDs
declared under the top-level `skills` map. Do not add a resource `kind`, Node
`resources`, `executor`, or executor `skills` field. Every Node declares either
`kind: agent` or `kind: command` plus a non-empty `description` of when to use
the Node. Description is discovery and Dashboard metadata, never a scheduling
rule. Agent Nodes may declare `skill`; Command Nodes declare one string
`command`. Split commands into separate Nodes when they need
independent status, retry, or dependencies. Define reusable Node inputs and
outputs as named inline JSON Schemas with a non-empty `description`. Describe
the local port contract only; never name or bind another Node in a definition.
Do not repeat output names in a Planned Node; execution and Dashboard views
derive them from the frozen Node Definition.
Use Node `authority` only for minimum semantic authorization required by that
definition. Planned Nodes inherit it and cannot weaken or replace it. Do not add
`artifactTypes` or `executionPolicy`: artifacts are represented by structured
outputs, Exports, and Evidence, while timeout and retry behavior belongs to the
host that actually performs execution.
Without `repo`, resolve the entry relative to the declaring config. With
`repo`, materialize Skill entries through `npx skills` and Context entries from
the repository's latest default branch.

For an existing Run, list and activate resources against its frozen config
snapshot. The first activation pins actual content in `cache/resources/`; later
activations reuse that digest even when the source file or remote default branch
has changed. Only a new Run should pick up the newer resource by default.

For an update, preserve unrelated valid entries and the user's formatting when
practical. Do not replace the whole file for a narrow change.

## Migrate

First preserve the source configuration so its intent can be compared with the
candidate. Translate only concepts with a clear current equivalent. In
particular, reusable node capabilities may remain Node Definitions, while
Workflow selection, Stage grouping, and dependency edges must not be copied
into `harness.yaml`; they become task-scoped Plan decisions at run time.

An unsupported version is a preflight failure, not permission to rewrite the
file blindly. If migration drops behavior, changes authority, changes command
execution, or requires choosing among plausible Node Definitions, present the
proposed difference and obtain the user's decision before writing. A
deterministic, semantics-preserving migration may be applied directly when the
original request already authorized Harness execution or configuration work.

## Validate And Continue

After writing, call `config_inspect` against the workspace and resolve every
schema, import, reference, and version error. Summarize whether the operation
created, updated, or migrated the configuration and identify material semantic
changes.

For a configuration-only request, stop after validation. For a run request,
resume the original Start Or Resume flow only after validation succeeds. Never
create a Run from an invalid or unsupported configuration.
