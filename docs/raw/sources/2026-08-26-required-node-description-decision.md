# Required Node description decision

Captured: 2026-08-26

The user confirmed that every Node Definition must have a non-empty
`description`.

The description explains when an agent should choose the reusable Node. Harness
returns it from configuration inspection and displays it in Dashboard Node
Details. It is discovery and presentation metadata only: it does not create
dependencies, affect readiness, or participate in completion.
