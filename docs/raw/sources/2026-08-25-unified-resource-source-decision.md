# Unified resource sources

- Date: 2026-08-25
- Source: product design conversation
- Status: accepted

Every config version 3 resource source contains a required `entry` and optional
`repo`. Without `repo`, the entry resolves relative to the declaring config.
With `repo`, the resource kind selects materialization: Skills use `npx skills`
with the entry as the Skill selector, while Context uses the entry as an
explicit file in the repository's latest default-branch checkout.

The config does not expose source type, registry, Git ref, path, or Skill-name
fields. Runtime records the loaded content digest and any Git revision it can
resolve so a Run remains inspectable even though remote configuration follows
the latest default branch.
