# Inline Node port schemas

- Date: 2026-08-26
- Source: product design conversation
- Status: accepted

Node Definitions declare named `inputs` and `outputs` without referring to any
other Node. Each port value is an inline JSON Schema with a required
`description`; no top-level type registry or executable TypeScript
configuration is introduced.

Plan dependencies remain Run-scoped composition decisions. Core validates
actual planned input before an execution starts and requires every declared
output to satisfy its schema when an execution succeeds. Non-success terminal
states may retain incomplete diagnostic output. The frozen Run configuration
snapshot supplies the authoritative port contracts for replay.
