# Workspace Preparation

Use this workflow only after the workspace preparation gate in `SKILL.md` has
passed and before the first project mutation. Merely loading the Skill,
inspecting or maintaining Harness configuration, or creating a read-only answer
must not invoke it.

`config_inspect` returns one workspace strategy:

- `branch`: create and switch to a task branch in the current checkout;
- `worktree`: create a task branch in a separate Git worktree and continue from
  that worktree path.

This preparation is not a Plan node. It establishes the workspace in which the
Run and its Plan will execute.

## Trigger Once

Implementation intent exists when the user explicitly requests a project
change, or when approved exploratory work reaches a necessary project write.
Configuration-only lifecycle work, read-only commands, builds that do not
generate tracked files, and inspection of existing state do not establish it.

Prepare immediately before the first mutating command, then retain the returned
canonical workspace path as task state. All later mutations and any new Run use
that path. Do not invoke preparation again during the same task unless the user
explicitly changes the target repository or base.

## Resolve The Base

Use a base branch explicitly requested by the user. Otherwise resolve the
remote's default branch. Infer the remote from the base branch's upstream,
falling back to `origin` only when it exists and no upstream is configured.
Stop and ask for a base branch when the repository has no unambiguous remote
default.

Fetch the resolved remote before creating the task branch. Network access and
credential prompts remain host-controlled actions. Do not claim the base is
current when fetch did not succeed.

Create a unique task branch from the freshly fetched remote base. If continuing
an existing task branch, rebase that task branch onto the freshly fetched base
before work continues. Never rebase, reset, or rewrite the user's base branch.

## Apply The Strategy

For `branch`, require the current checkout to be clean before switching. Do not
stash, discard, or commit unrelated changes automatically. Create and switch to
the task branch only after fetch succeeds.

For `worktree`, inspect existing worktrees and choose a new path and branch that
do not collide. Create the worktree from the resolved remote base. Return and
use its canonical path for `config_inspect`, `run_create`, every later MCP
command, agent execution, and command executor.

If the host already placed the session in the intended task worktree, reuse it
only when its branch and base satisfy this preflight. Do not create a nested
worktree merely to reproduce the configured strategy.

## Failure And Recovery

If fetch, branch creation, worktree creation, or rebase fails, stop before
`run_create`. Abort an in-progress rebase when doing so restores the task branch
without touching user changes. Do not delete an existing worktree or branch as
automatic recovery.

After preparation, run `config_inspect` from the prepared path. If the base does
not contain a valid `harness.yaml`, route through the configuration lifecycle in
that prepared workspace before creating the Run.
