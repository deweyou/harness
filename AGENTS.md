# AGENTS.md

This repository is Dewey's personal agents hub. It contains reusable skills,
rules, and the `deweyou-cli` package that installs them into other repos.

## Read First

- If you add or update skills, rules, or CLI behavior, read
  [docs/asset-workflow.md](./docs/asset-workflow.md).
- Repository knowledge lives under [docs/](./docs/). Do not create a separate
  `knowledge/` directory for this repo.
- Before evolving DDev beyond its manual structured-session protocol, read
  [docs/ddev-evolution.md](./docs/ddev-evolution.md) for adoption triggers and
  boundaries.
- `CLAUDE.md` should remain a symlink to this file.

## Asset Map

| Asset | Location | Purpose |
|-------|----------|---------|
| Skills | `skills/<name>/SKILL.md` | Active workflows that trigger for specific situations. |
| Rules | `rules/<name>.md` | Passive coding and development preferences shared across projects. |
| Design | `design/<name>.md` | Reusable interface design contracts installed into target repos as `DESIGN.md`. |
| CLI | `cli/` | TypeScript package for the `deweyou-cli` binary. |
| Asset Tests | `tests/` | Node test coverage for registry and asset scanning. |

## Core Conventions

- Skill directories, rule filenames, design filenames, and frontmatter `name`
  values must be kebab-case.
- Skills, rules, and design contracts must include `name` and `description`
  frontmatter.
- Rules use plain `rules/<name>.md` filenames. Do not rename them to `*.rules.md`.
- Implement skills, rules, MCP assets, and plugin assets in English, including
  frontmatter, instructions, examples, prompts, script help text, and user-facing
  runtime messages.
- Keep English executable assets as the single source of truth. Maintain Chinese
  human-reading companions in `skills/<name>/README_ZH.md` and
  `docs/zh/assets/{rules,design}/`; do not install these companions as assets.
- Every new or modified skill must include updated `skill-eval` cases in
  `skills/<name>/evals/evals.json`; only run LLM-backed evals when the user
  explicitly asks for execution.
- Run `pnpm run lint:assets` after changing skills, rules, or design contracts.
- Run `pnpm test` after changing asset-scanning behavior.
- Run `npm run typecheck`, `npm test`, and `npm run test:coverage` in `cli/`
  after changing CLI behavior.

## CLI Commands

```bash
pnpm test
pnpm run coverage
pnpm run lint:assets
pnpm run typecheck:cli
pnpm run test:cli
pnpm run coverage:cli
cd cli && npm pack --dry-run
```
