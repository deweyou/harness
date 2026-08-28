# Unified context resources

- Date: 2026-08-25
- Source: product design conversation
- Status: accepted

Harness configuration treats repository rules and knowledge as the same
context-delivery concern. Config version 3 therefore exposes only `skill` and
`context` resource kinds. Whether context contains normative constraints or
descriptive knowledge is expressed by the document itself, not by Core.

Resource descriptions are removed from configuration. Resource identity is the
stable summary used by Core; Skill metadata and context content remain owned by
their source documents.
