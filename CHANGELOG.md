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
