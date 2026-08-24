# Repository knowledge maintenance decision

- Confirmed at: 2026-08-24 (Asia/Shanghai)
- Authority: repository owner in the implementation task
- Scope: Harness repository knowledge maintenance
- Reference: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

The repository owner approved a repository-oriented adaptation of the persistent
LLM-maintained wiki pattern:

1. Keep `harness-work` as the only user-facing Skill and add knowledge
   maintenance as a progressively loaded SOP.
2. Treat code, tests, schemas, configuration, and external sources as factual
   inputs; use `docs/` for maintained synthesis and `AGENTS.md` for concise
   execution constraints and navigation.
3. Keep repository-wide and cross-module knowledge at the root. In monorepos or
   complex repositories, allow nested `AGENTS.md` and colocated `docs/` only at
   durable module boundaries, without duplicating root instructions.
4. Require explicit user intent or an accepted evidence-backed proposal before
   changing repository knowledge. Ordinary questions do not trigger edits.
5. Let Harness own Evidence, attribution, proposal decisions, and validation
   lineage while the repository or configured Knowledge Provider owns content,
   indexing, retrieval, and publication.
6. Use Git and Harness events as authoritative change history instead of adding
   a duplicate hand-maintained chronological knowledge log.
