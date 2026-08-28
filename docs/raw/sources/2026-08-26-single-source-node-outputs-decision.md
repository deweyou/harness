# Single-source Node outputs

- Date: 2026-08-26
- Status: accepted
- Scope: Planned Nodes and Dashboard projection

Planned Nodes no longer carry an `expectedOutputs` string list. Node Definition
`outputs` is the sole output contract, including names, descriptions, and JSON
Schema types. Runtime validation and Dashboard presentation derive expected
output names from the Run's frozen configuration snapshot, preventing Plan data
from contradicting the reusable definition.
