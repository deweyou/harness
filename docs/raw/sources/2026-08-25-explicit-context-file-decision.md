# Explicit Context files

- Date: 2026-08-25
- Source: product design conversation
- Status: accepted

A Context resource must identify one explicit file. Harness does not infer
`CONTEXT.md`, `README.md`, or another entrypoint when a Context source resolves
to a directory. Skill directories remain valid because `SKILL.md` is a standard
Skill entrypoint.
