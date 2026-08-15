# AGENTS.md

This repository contains the Deweyou Harness Codex Plugin.

## Product Boundary

- Keep the Harness domain-neutral. Do not bundle coding, writing, publishing,
  product, or repository-specific resources.
- `skills/dhw/` is the only bundled user-facing skill.
- `harness.yaml` is the workspace-owned source of workflows and resource refs.
- The MCP server is a deterministic control/state plane; agents and subagents
  perform agent-node work.
- New state belongs under `~/.deweyou/harness/`. Never read, migrate, or delete
  old `~/.deweyou/dev/` state.
- `events.jsonl` is authoritative. `state.json` must remain rebuildable.
- There is no public CLI. Internal package scripts are development-only.

## Asset Conventions

- Executable plugin assets are written in English.
- Skill directories and frontmatter names use kebab-case.
- Every skill has `SKILL.md`, `README.md`, `README_ZH.md`, and
  `evals/evals.json`.
- Do not add an examples directory; express compatibility cases as tests.
- Keep `CLAUDE.md` as a symlink to this file.

## Verification

Run:

```bash
pnpm run lint:assets
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run build
pnpm run validate:plugin
```
