import type { BrainConfig } from './brain-types.ts'

export function knowledgeRepositoryTemplates(
  config: BrainConfig,
  now: Date,
): Record<string, string> {
  const createdAt = now.toISOString()
  return {
    'AGENTS.md': `---
id: repository-agent-entry
type: instruction
title: Personal Context Hub agent entry
classification: private
scope:
  - personal
status: active
---

# Personal Context Hub

This repository is a Deweyou Context Hub knowledge repository.

## Entry protocol for agents

1. Read \`brain.yaml\` for repository defaults and schema versions.
2. Read \`wiki/index.md\` for the human-readable knowledge map.
3. Use \`deweyou-cli brain recall\` for scope-filtered, token-budgeted context.
4. Filter by both consumer clearance and allowed scopes before showing content.
5. Never bypass artifact \`classification\`, \`scope\`, or \`status\`.
6. Treat \`sources/\` manifests and \`events/\` as immutable evidence. Raw
   session bodies stay in the local Deweyou runtime.
7. Treat \`claims/\`, \`resolutions/\`, and \`decisions/\` as governed history.
8. Treat \`wiki/\` as a compiled view that may be regenerated.
9. Never store credentials, tokens, cookies, private keys, or authentication
   material in this repository.

## Repository map

- \`sources/\`: portable manifests for local raw evidence.
- \`events/<device-id>/\`: append-only lifecycle facts written by one device.
- \`observations/\`: provisional information awaiting semantic governance.
- \`claims/\`: atomic, sourced, governed knowledge.
- \`resolutions/\`: immutable proposals and canonical structured operations.
- \`decisions/\`: explicit human lifecycle and policy exceptions.
- \`wiki/\`: deterministic Markdown views compiled from effective claims.
- \`policy/\` and \`schemas/\`: normative rules for every writer and consumer.

## Mutation rules

- Append new source, event, proposal, resolution, or decision artifacts. Do not
  rewrite their history.
- Do not edit generated Wiki pages by hand; recompile them.
- A model may raise classification but may never lower it.
- Device-local paths belong only to \`device/<id>\` evidence. Promote semantic
  knowledge into a separate cross-device Claim.
- Use \`deweyou-cli brain state\` for stale, archive, delete, and restore actions.
`,
    'brain.yaml': `schema_version: 1
created_at: ${createdAt}
default_classification: private
default_scopes:
  - personal
classifications:
  - public
  - private
  - confidential
  - restricted
statuses:
  - active
  - stale
  - superseded
  - archived
  - deleted
policy_version: ${config.compiler.policy_version}
artifact_schema_version: 1
`,
    '.gitignore': `.DS_Store
.deweyou/
brain.sqlite
brain.sqlite-shm
brain.sqlite-wal
*.lock
`,
    'policy/README.md': `---
id: policy-index
type: policy
title: Knowledge policy
classification: public
scope:
  - system/context-hub
status: active
---

# Knowledge policy

The runtime enforces classification and scope before recall, model invocation,
or export. Read the policies in this directory before producing durable
knowledge.
`,
    'policy/classification.md': `---
id: policy-classification
type: policy
title: Classification and display policy
classification: public
scope:
  - system/context-hub
status: active
---

# Classification and display policy

Every artifact has one classification:

\`public < private < confidential < restricted\`

- A consumer may receive an artifact only when its clearance is at least the
  artifact classification and one of its allowed scopes matches.
- Filtering happens before model invocation, Context Pack assembly, or export.
- Derived artifacts inherit the highest classification of all inputs.
- Models may raise classification but may not lower it.
- Only a user-authored decision may lower classification.
- Classification is a display and routing rule, not encryption.
- Credentials and authentication material are forbidden at every level.
`,
    'policy/lifecycle.md': `---
id: policy-lifecycle
type: policy
title: Lifecycle policy
classification: public
scope:
  - system/context-hub
status: active
---

# Lifecycle policy

Effective artifact states are:

- \`active\`: eligible for normal recall and compilation.
- \`stale\`: still visible, but down-ranked and explicitly labeled.
- \`superseded\`: retained for provenance and excluded from normal recall.
- \`archived\`: cold history, returned only when explicitly requested.
- \`deleted\`: soft-deleted tombstone; excluded from recall and compilation.

State changes are append-only resolutions or human decisions. Routine
maintenance never physically destroys canonical history. Hard purge is an
explicit emergency response for accidentally captured secrets.

Age alone never changes lifecycle state: old but durable preferences may still
be valid. Age affects retrieval freshness only. A Claim becomes stale through
an explicit user decision or a governed \`MARK_STALE\` operation backed by new
evidence, an expired validity window, or a changed source/project version.
`,
    'policy/governance.md': `---
id: policy-governance
type: policy
title: Governance policy
classification: public
scope:
  - system/context-hub
status: active
---

# Governance policy

Models do not edit the ledger freely. They may propose only:

- \`ADD_CLAIM\`
- \`MERGE_CLAIMS\`
- \`SUPERSEDE_CLAIM\`
- \`SPLIT_SCOPE\`
- \`MARK_STALE\`
- \`LINK_ENTITIES\`
- \`REJECT_OBSERVATION\`
- \`REQUEST_HUMAN_DECISION\`

Every proposal records its job id, input ids, evidence references, confidence,
model and prompt version, policy version, and device id. Deterministic
validation runs before a canonical resolution is written. Policy conflicts,
classification downgrades, permission changes, and unresolved high-impact
disagreements require a human decision.

If multiple devices resolve the same deterministic job while offline, Git
keeps every device proposal and selects the lexicographically smallest proposal
path as the canonical resolution. Claims emitted only by a losing proposal are
retained for provenance but become ineffective in local indexes and Wiki views.

Semantic governance runs in the active Codex, Claude, Hermes, OpenClaw, or Trae
turn. \`brain maintain\` prepares a prompt and \`brain apply\` is the only path
that accepts the model's structured proposal. Background workers never invoke
a model.
`,
    'schemas/README.md': `---
id: schema-index
type: schema
title: Schemas
classification: public
scope:
  - system/context-hub
status: active
---

# Schemas

Schema version 1 is implemented and validated by \`deweyou-cli\`. Durable JSON
records carry \`schema_version: 1\`; Markdown records use YAML frontmatter.
See \`artifact-v1.md\` for the common contract.
`,
    'schemas/artifact-v1.md': `---
id: schema-artifact-v1
type: schema
title: Artifact schema V1
classification: public
scope:
  - system/context-hub
status: active
---

# Artifact schema V1

Markdown artifacts use YAML frontmatter. The common shape is:

\`\`\`yaml
id: stable-artifact-id
type: claim
title: Human-readable title
classification: private
scope:
  - personal
status: active
authority: user
confidence: 0.9
updated_at: 2026-07-27T00:00:00.000Z
source_refs:
  - source-id
\`\`\`

Required fields are \`id\`, \`type\`, \`classification\`, \`scope\`, and
\`status\`. Claims also record authority, confidence, and evidence. JSON
events, sources, observations, resolutions, and decisions carry the equivalent
fields plus \`schema_version: 1\`.

Unknown classifications, statuses, unsafe ids, invalid scopes, and missing
identity fail indexing. Missing Markdown classification or scope may inherit
the nearest domain \`purpose.md\`, then the repository defaults.
`,
    'sources/README.md': `---
id: source-index
type: instruction
title: Sources
classification: private
scope:
  - personal
status: active
---

# Sources

Sources are evidence manifests, not conclusions. Portable manifests are stored
under \`sources/manifests/<agent>/<year>/<month>/\`; raw session bodies remain
under \`~/.deweyou/brain/raw-sources/\` on the capturing device. Keep source ids
stable and reference them from observations, claims, and resolutions. Never
commit raw transcripts, local cache paths, or authentication material.
`,
    'wiki/README.md': `---
id: wiki-readme
type: instruction
title: Compiled Wiki
classification: private
scope:
  - personal
status: active
---

# Compiled Wiki

\`wiki/index.md\` is the human entry point. Domain pages are deterministic views
of effective Claims and may be regenerated at any time. Organize durable topics
under \`wiki/domains/<domain>/\`; use \`purpose.md\` to declare that domain's
purpose, default classification, and scopes. Chronological summaries belong in
\`wiki/journal/\`, while canonical evidence remains outside the Wiki.
`,
    'wiki/index.md': `---
id: wiki-index
type: catalog
title: Personal Context Hub
classification: private
scope:
  - personal
status: active
generated: true
updated_at: ${createdAt}
---

# Personal Context Hub

The Wiki has not been compiled yet. Run \`deweyou-cli brain worker --no-push\`
or apply an agent-generated maintenance proposal.
`,
    'wiki/domains/personal/purpose.md': `---
id: purpose-personal
type: purpose
title: Personal domain
classification: private
scope:
  - personal
status: active
defaults:
  classification: private
  scopes:
    - personal
---

# Personal domain

Long-lived personal preferences, decisions, interests, and playbooks.
`,
    'wiki/journal/README.md': `---
id: wiki-journal-readme
type: instruction
title: Journal
classification: private
scope:
  - personal
status: active
---

# Journal

Chronological compiled summaries are written here. Source events remain in
\`events/\` and are never replaced by journal prose.
`,
    [`devices/${config.device_id}.yaml`]: `schema_version: 1
device_id: ${config.device_id}
created_at: ${createdAt}
classification: private
scope:
  - device/${config.device_id}
`,
    'events/.gitkeep': '',
    'sources/manifests/.gitkeep': '',
    'observations/.gitkeep': '',
    'claims/.gitkeep': '',
    'resolutions/proposals/.gitkeep': '',
    'resolutions/jobs/.gitkeep': '',
    'decisions/.gitkeep': '',
  }
}
