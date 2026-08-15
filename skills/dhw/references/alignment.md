# Alignment Stage

Align the objective and evidence threshold before execution. Use current user
statements and authoritative workspace contracts as the source of truth.

Ask only when an ambiguity materially changes behavior, data, cost, privacy,
safety, reversibility, or the delivered artifact. Low-risk implementation
details may be stated as assumptions and delegated.

The stage output should contain:

- objective and intended recipient
- in-scope and explicit non-goals
- constraints and required resources
- acceptance claims and the evidence that could prove each claim
- unresolved material decisions and their owner
- a concise node execution plan derived from the configured DAG

Alignment is not a universal request for ceremony. If the user's prompt and an
authoritative contract already define the result, record the evidence source
and proceed. If material choices remain, record `needs_alignment` and pause for
the user rather than letting a subagent invent policy.
