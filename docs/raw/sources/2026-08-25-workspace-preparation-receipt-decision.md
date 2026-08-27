# Workspace preparation Receipt decision

- Captured at: 2026-08-25
- Type: user-confirmed design decision
- Scope: branch/worktree strategy enforcement before Run creation

The root `strategy` field remains the only workspace-preparation configuration:
`branch` or `worktree`. Base branch, remote, task branch, and worktree path are
task inputs rather than additional `harness.yaml` fields.

Harness must enforce the strategy rather than treating it as Agent guidance.
`workspace_prepare` fetches the selected remote base, creates or rebases the task
branch in the configured checkout shape, and persists an idempotent Receipt.
Public `run_create` requires that Receipt and verifies it against the current
configuration and Git workspace before creating the Run.
