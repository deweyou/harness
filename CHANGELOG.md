# Changelog

All notable changes to Deweyou Harness are recorded here.

## Unreleased

- Renamed the single user-facing Skill from `dhw` to `harness-work`.
- Added user-triggered configuration creation and updates plus preflight
  migration guidance before Run creation.
- Added the root `strategy` setting for branch or worktree preparation before a
  new Run.
- Added an evidence-backed repository knowledge maintenance SOP with root and
  module-level `AGENTS.md` and `docs/` scoping guidance.
- Added bounded per-attempt structured input and output inspection plus a
  generated `reports/retrospective.md` preview in the global Dashboard.
- Made in-progress iteration incremental by default: reuse unaffected work and
  limit revised Plans to affected patches and focused verification.
- Allowed necessary knowledge updates during any Run stage while keeping active
  knowledge current-state only and design history in Specs or Run Evidence.
- Added generic immutable JSON and Markdown Node Exports with Dashboard viewers;
  task Specs use the same Export contract with role `spec`.
- Added lightweight Problem Framing and Spec lifecycle guidance plus safe
  `CLAUDE.md` initialization, Mermaid-first documentation, and update footers.
- Added `workspace_prepare` with fetched-base branch/worktree preparation,
  idempotent Receipts, and mandatory Receipt validation in public `run_create`.
- Restricted Harness config imports to repository-portable relative paths.
- Started config version 3 by merging rule and knowledge resources into
  `context` and removing resource descriptions.
- Required Context resources to identify an explicit file instead of inferring
  a directory entrypoint.
- Unified resource sources as optional `repo` plus required `entry`; remote
  Skills use `npx skills` and remote Context files use the latest default Git
  branch.
- Removed duplicate Node `name` fields; Node IDs now provide stable references
  and humanized Dashboard labels.
- Split configured resources into repository-scoped `context` and reusable
  `skills`, removed configured resource `kind`, and made Node `skill` the only
  Node-level resource reference.
- Flattened Node execution to `kind: agent | command`; Command Nodes now use one
  shell command string, and the `executor` wrapper and speculative capability
  executor were removed.
- Upgraded Node inputs and outputs from labels to named inline JSON Schema ports
  validated at execution start and successful completion.
- Added optional five-value display phases to Planned Nodes and Dashboard views
  without changing DAG scheduling, and removed unused Node `claimTypes`.
- Removed unused Node `artifactTypes` and unenforced `executionPolicy`; Node
  `authority` is now a visible minimum requirement inherited by Planned Nodes.
- Removed duplicate Planned Node `expectedOutputs`; output names now derive
  from the frozen Node Definition contract.
- Moved the resolved Run configuration to persistent
  `cache/config.snapshot.yaml` and made Plan proposal, execution validation, and
  Dashboard projection consume that single snapshot.
- Added lazy Run-scoped resource pinning under `cache/resources/`; first
  activation snapshots full Skill support files or Context content, and later
  activations verify and reuse the same digest across server restarts.
- Required every open acceptance Claim to have a Planned Node path while
  allowing incremental Plans to reuse earlier coverage for the same Commitment;
  Dashboard Node Details now resolve Claim descriptions, status, and Evidence.
- Made Node `description` required for capability discovery and exposed it in
  Dashboard Node Details without giving it scheduling semantics.
- Changed `ready_nodes` to return execution assignments whose Node Definitions
  are resolved from the frozen Run configuration, preventing mutable workspace
  config from changing Agent Skills, Commands, or port contracts mid-Run.
- Added Run, Workspace path, Commitment revision, and Plan revision to the
  `ready_nodes` assignment envelope so its output can be delegated directly.
- Required `execution_start` to echo assignment revisions and reject stale
  Commitment or Plan state in both semantic-command and event-replay checks.
- Defined host-owned Command Node execution: fixed Run workspace cwd, explicit
  process-status mapping, raw logs as Evidence, and separately validated
  structured outputs without adding shell or environment configuration.
- Made retry explicit through evidence-backed `execution_retry`; terminal
  attempts no longer return automatically from `ready_nodes`.
- Bound Evidence to authoritative Execution inputs and reject stale proof when a
  later Plan changes the same Planned Node input.
- Reject Run completion while executions are running, freeze operational
  mutations after completion, and reject conflicting Commitment or Plan
  idempotency replays by canonical command input.

## [1.3.2] - 2026-09-10

- fix: keep harness conversations moving with explicit next steps (87de609)
- Merge pull request #51 from deweyou/codex/harness-conversation-continuity (631f148)

## [1.3.1] - 2026-08-28

- fix: require explicit harness invocation (152b225)
- Merge pull request #50 from deweyou/codex/harness-explicit-invocation (1e001ff)

## [1.3.0] - 2026-08-28

- feat: add global harness dashboard (69c2c6f)
- chore: configure harness workflow (5242735)
- refactor: align dashboard with harness v2 (66b9382)
- fix: restore reusable harness node definitions (1f205c2)
- feat: add harness-work configuration lifecycle (793355f)
- feat: add lazy workspace preparation (9aee9ba)
- feat: add incremental run retrospectives (a1b7f86)
- docs: define current knowledge publication (4bc342d)
- feat: add node export viewers and spec framing (713ad0c)
- feat: close harness config and runtime contracts (cf2f09a)
- Merge pull request #49 from deweyou/codex/global-dashboard (7b9da91)

## [1.2.0] - 2026-08-21

- feat: redesign harness around nodes and commitments (99ce60a)
- Merge pull request #48 from deweyou/codex/harness-v2 (8e43857)

## [1.1.0] - 2026-08-18

- feat: add native Trae plugin support (#47) (379a2e6)

## [1.0.0] - 2026-08-18

- Promoted the domain-neutral Harness Core MVP to its first stable release.
- Added automatic semantic versioning, synchronized host manifests, changelog generation, and rebuilt runtime commits after merges to `main`.
- Removed legacy `.claude/skills` and `.agents/skills` compatibility links.

## [0.1.0] - 2026-08-18

- Initial domain-neutral Harness Core MVP.
- Added `/dhw`, progressive resource dispatch, durable Run evidence, and post-delivery retrospectives.
- Added Codex, Claude Code, Cursor, OpenClaw, and Hermes Agent plugin adapters.
