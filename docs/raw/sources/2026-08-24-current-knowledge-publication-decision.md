# Current knowledge publication decision

- Confirmed at: 2026-08-24 (Asia/Shanghai)
- Authority: repository owner in the implementation task
- Scope: Knowledge maintenance timing and current-state publication

The repository owner refined the repository knowledge maintenance policy:

1. Necessary knowledge updates may happen during any stage of authorized
   repository work when a verified change would otherwise leave active
   knowledge missing, stale, or contradictory. Maintenance does not wait for
   Retrospective.
2. Active knowledge records only conclusions that remain useful now. When
   design A is replaced by B, the canonical knowledge describes B directly.
3. The path from A to B, rejected alternatives, experiments, and design
   trade-offs belong in the task Spec, Run, Evidence, or Git history rather than
   the current knowledge consumed by future agents.
4. An obsolete approach remains in active knowledge only when a present
   compatibility, migration, rollback, or diagnostic constraint still depends
   on it. Its validity scope must be explicit.
5. Retrospective audits knowledge for omissions and conflicts; it is not the
   first or only publication trigger.
