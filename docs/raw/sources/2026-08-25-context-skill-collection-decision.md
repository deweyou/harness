# Context and Skill collections

- Date: 2026-08-25
- Source: product design conversation
- Status: accepted

Harness configuration separates repository-scoped Context from reusable
Skills. Top-level `context` and `skills` maps replace the heterogeneous
`resources` map, so configured resources no longer declare a `kind`.

All configured Context applies to the repository and Run. A Node does not bind
Context; its `skill` list may reference only IDs declared in the top-level
`skills` map. The former Node `resources` and agent executor `skills` fields are
removed.
