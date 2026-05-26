# Dewey CLI Init Skills Install Design

## Problem

`deweyou-cli agent init` should remain the single Dewey onboarding command, but
Dewey should not expose a second skills-management command family. Skill
installation already belongs to the community `skills` CLI.

## Decision

When `agent init` has selected skills and the install mode is `link` or `copy`,
it delegates skill installation to `npx -y skills@latest add`. Dewey still owns
asset selection, rule installation, design contracts, manifests, and instruction
wiring.

`pointer` mode does not materialize skills and keeps using the Dewey cache in the
manifest/context path.

## Mapping

- Selected skill ids map to `--skill <id...>`.
- `--tools codex,claude` maps to `--agent codex claude-code`.
- Project scope runs from the target repository.
- Global scope passes `-g`.
- `--mode copy` passes `--copy`; `link` uses the skills CLI default.
- `deweyou-cli agent skills`, `agent sync`, and `agent upgrade` are not exposed.

## Non-Goals

- Do not reimplement `skills-lock.json`, updates, listing, removal, or sync.
- Do not wrap every `skills` CLI command in Dewey-shaped aliases.
- Do not change rule or design contract installation semantics.
