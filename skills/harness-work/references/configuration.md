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

Inspect the repository only as far as needed to identify real reusable
resources, executors, and Node Definitions. Preserve repository-owned naming
and commands. Keep `harness.yaml` domain-neutral: it may declare imports,
resources, and reusable nodes, but not task-specific dependencies, Workflows,
or fixed Stages. Dependencies belong to each Run's Plan.

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
