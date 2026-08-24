# Repository Knowledge Maintenance

Use this workflow when the user explicitly asks to preserve repository
knowledge, accepts a Knowledge resource proposal, or requests a knowledge health
review. Do not invoke it merely because a question produced a useful answer.

Repository knowledge has three layers:

1. Code, tests, schemas, configuration, and immutable external sources are the
   factual substrate.
2. `docs/` contains maintained explanations, decisions, operating knowledge,
   and cross-module synthesis that cannot be read reliably from one source.
3. `AGENTS.md` is a concise execution contract and router into the relevant
   source and documentation. It is not the knowledge base itself.

Harness owns Evidence, attribution, proposals, decisions, and validation state.
The repository remains the owner of `AGENTS.md` and `docs/`. An accepted
proposal authorizes a separate maintenance task; it does not rewrite knowledge
inside the completed Run.

## Choose The Scope

Start at the repository root and locate existing instruction and documentation
conventions before adding files. Prefer updating an existing canonical page to
creating a competing explanation.

Keep repository-wide architecture, shared contracts, global engineering
constraints, cross-module data flow, and organization-wide decisions under the
root `docs/`. Keep the root `AGENTS.md` short: repository boundaries, global
invariants, primary commands, and links that route an agent to deeper material.

For a monorepo or complex repository, add a nested `AGENTS.md` and colocated
`docs/` only at a durable module boundary. A module is a suitable boundary when
it has independent ownership, domain language, build or release behavior,
runtime responsibility, or enough local invariants that root documentation
would become ambiguous. Do not create instruction files for ordinary source,
component, or utility directories.

A nested `AGENTS.md` inherits root constraints and records only local
differences, commands, entry points, and documentation links. Do not duplicate
the root file. Put contracts spanning multiple modules in the root documentation
or at the owning boundary, not in several module copies.

## Establish The Candidate

Classify the requested change before writing:

- **add**: a reusable fact, decision, procedure, or synthesis is missing;
- **update**: existing knowledge is incomplete or stale;
- **deprecate**: a claim or procedure is no longer valid but its history matters;
- **resolve**: maintained sources conflict and require an explicit decision;
- **lint**: inspect for contradictions, stale claims, broken navigation,
  duplication, or missing coverage without assuming edits are needed.

The candidate must identify its target scope, intended file or canonical topic,
source Evidence, current resource digest when available, and a validation plan.
Separate verified facts from inference and user preference. A conversationally
plausible answer is not sufficient source Evidence.

Do not preserve secrets, personal data, raw environment dumps, transient status,
or logs whose only value is one execution. Record locators and concise
conclusions instead of copying large Evidence into documentation.

## Write Durable Knowledge

Prepare the configured task workspace before the first knowledge repository
edit. Apply the narrowest change that keeps navigation and related pages
consistent.

Prefer colocating exact implementation facts with code, schemas, configuration,
or tests. Documentation should explain intent, boundaries, interactions,
diagnosis, decisions, and facts that span sources. Do not restate a signature,
default, field list, or command output that can be derived cheaply from its
authoritative source.

Every maintained claim should make its support discoverable. Use stable file,
schema, test, decision, external-source, or Harness Evidence locators. Include
scope or validity conditions when a statement is not universal. Avoid brittle
line-number-only anchors when a symbol, schema path, test name, or content digest
is available.

Maintain a content-oriented `docs/index.md` when the documentation is large
enough to need routing. Do not add a second chronological `log.md` when Git and
Harness events already provide the authoritative history.

## Validate And Publish

Validate at the same boundary as the change:

- verify links and instruction-file routing;
- confirm cited sources still support each material claim;
- check that root and nested instructions do not conflict or duplicate;
- replay the cases attached to an accepted proposal;
- run repository documentation or asset checks when available;
- inspect the final diff for unrelated knowledge rewrites.

Publication Evidence records the changed resource locator, previous and new
digests, validation results, and the proposal or source Evidence that authorized
the change. A successful file edit is not sufficient validation.

After publication, future resource activation should use the new digest. If the
same evidence-backed feedback recurs, create a new proposal rather than silently
editing the resource again.
