# Execution Loop

The controller owns scheduling; subagents own bounded agent-node executions.

For every assignment provide:

- Run, workflow, stage, stage visit, node instance, and attempt identity
- the exact objective and inputs from `with`
- relevant workflow rules and knowledge metadata
- full dispatched skill instructions for this node
- allowed mutation and external-action boundaries
- expected output and evidence format
- the requirement to return a concise result, evidence references, and blockers

One subagent handles one node execution. Independent ready nodes may run in
parallel, but dependent or overlapping mutations must remain ordered. The main
agent reviews returned evidence, rejects outputs that violate current user or
workspace instructions, and records the terminal event.

Commands are deterministic nodes, not shell-shaped agent prompts. Capture the
command, working directory, exit status, duration, and a redacted output summary.
Store significant output as evidence. Never interpolate secrets into event data.

Retry only when the observed failure identifies a bounded technical correction.
A retry gets a new node execution and preserves the failed attempt. A changed
requirement is rework through align or execute, not a reset.
