import { createHash } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import {
  applyResolutionProposal,
  validateResolutionProposal,
} from './brain-governance.ts'
import { indexBrain } from './brain-index.ts'
import { isRecord } from './brain-schema.ts'
import type {
  BrainAgent,
  BrainConfig,
  BrainEvent,
  BrainMaintenanceJob,
  BrainMaintenancePreparation,
  ResolutionApplyResult,
  ResolutionProposal,
} from './brain-types.ts'
import { compileWiki } from './brain-wiki.ts'
import { writeJsonAtomic } from './safe-io.ts'

export interface BrainMaintainResult {
  processed: number
  observed: number
  resolved: number
  pending: number
}

export async function maintainBrain({
  homeDir,
  agent,
  sessionId,
}: {
  homeDir?: string
  agent?: BrainAgent
  sessionId?: string
} = {}): Promise<BrainMaintainResult> {
  const prepared = await prepareBrainMaintenance({ homeDir, agent, sessionId })
  return {
    processed: 0,
    observed: prepared.observed,
    resolved: 0,
    pending: prepared.pending,
  }
}

export async function prepareBrainMaintenance({
  homeDir,
  agent,
  sessionId,
}: {
  homeDir?: string
  agent?: BrainAgent
  sessionId?: string
} = {}): Promise<BrainMaintenancePreparation> {
  const config = await loadBrainConfig({ homeDir })
  const paths = brainPaths(homeDir)
  const jobs: BrainMaintenanceJob[] = []

  for (const name of (await safeReaddir(paths.queueRoot)).sort()) {
    if (!name.endsWith('.json')) continue
    const job = await readMaintenanceJob(join(paths.queueRoot, name))
    if (!job) continue
    const event = await readEvent(config, job)
    if (agent && event.agent !== agent) continue
    if (sessionId && event.session_id !== sessionId) continue
    const observationId = await writeObservation(
      config,
      event,
      requiredString(job.job_id, 'job.job_id'),
    )
    jobs.push({
      job_id: requiredString(job.job_id, 'job.job_id'),
      event_id: event.event_id,
      observation_id: observationId,
      source_id: event.source_id,
      local_source_path: event.source_id
        ? join(
          paths.rawSourcesRoot,
          'sessions',
          event.agent,
          utcPartition(event.occurred_at),
          basename(requiredString(job.event_path, 'job.event_path')),
        )
        : null,
      agent: event.agent,
      session_id: event.session_id,
      classification: event.classification,
      scopes: event.scopes,
    })
  }

  await indexBrain({ homeDir })
  return {
    observed: jobs.length,
    pending: jobs.length,
    jobs,
    prompt: renderMaintenancePrompt(config, jobs),
  }
}

export async function applyBrainMaintenanceProposal({
  homeDir,
  proposal: rawProposal,
}: {
  homeDir?: string
  proposal: ResolutionProposal
}): Promise<ResolutionApplyResult> {
  const proposal = validateResolutionProposal(structuredClone(rawProposal))
  if (proposal.provider !== 'agent-hook') {
    throw new Error('Brain maintenance proposal provider must be agent-hook')
  }
  const config = await loadBrainConfig({ homeDir })
  const jobPath = join(
    brainPaths(homeDir).queueRoot,
    `${safeJobId(proposal.job_id)}.json`,
  )
  const job = await readMaintenanceJob(jobPath)
  if (!job) {
    throw new Error(`Brain maintenance job is not pending: ${proposal.job_id}`)
  }
  const event = await readEvent(config, job)
  const expectedInputIds = [
    event.event_id,
    ...(event.source_id ? [event.source_id] : []),
  ]
  if (
    proposal.device_id !== config.device_id ||
    proposal.policy_version !== config.compiler.policy_version ||
    proposal.input_classification !== event.classification ||
    !sameStrings(proposal.input_ids, expectedInputIds) ||
    !sameStrings(proposal.evidence_refs, event.source_id
      ? [event.source_id]
      : [event.event_id])
  ) {
    throw new Error(
      `Brain maintenance proposal does not match pending job ${proposal.job_id}`,
    )
  }
  const result = await applyResolutionProposal({ homeDir, proposal })
  await rm(jobPath)
  await compileWiki({ homeDir })
  await indexBrain({ homeDir })
  return result
}

async function readMaintenanceJob(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const job: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(job) && job.kind === 'maintain-event' ? job : null
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

async function readEvent(
  config: BrainConfig,
  job: Record<string, unknown>,
): Promise<BrainEvent> {
  const eventPath = join(
    config.knowledge_repo,
    requiredString(job.event_path, 'job.event_path'),
  )
  return JSON.parse(await readFile(eventPath, 'utf8')) as BrainEvent
}

async function writeObservation(
  config: BrainConfig,
  event: BrainEvent,
  jobId: string,
): Promise<string> {
  const observationId = observationIdFor(event.event_id)
  const occurredAt = new Date(event.occurred_at)
  const partition = `${occurredAt.getUTCFullYear()}/${String(
    occurredAt.getUTCMonth() + 1,
  ).padStart(2, '0')}`
  const path = join(
    config.knowledge_repo,
    'observations',
    event.device_id,
    partition,
    `${observationId}.json`,
  )
  await writeJsonAtomic(path, {
    schema_version: 1,
    observation_id: observationId,
    created_at: event.occurred_at,
    event_id: event.event_id,
    source_id: event.source_id,
    job_id: jobId,
    title: `${event.agent} ${event.event_type}`,
    classification: event.classification,
    scopes: event.scopes,
    status: 'active',
    provisional: true,
    authority: 'observed',
    confidence: 0.5,
    content: event.payload,
  })
  return observationId
}

function observationIdFor(eventId: string): string {
  return `observation_${createHash('sha256')
    .update(eventId)
    .digest('hex')
    .slice(0, 24)}`
}

function renderMaintenancePrompt(
  config: BrainConfig,
  jobs: BrainMaintenanceJob[],
): string {
  if (jobs.length === 0) return ''
  const jobText = jobs
    .map((job) => `${JSON.stringify(job, null, 2)}`)
    .join('\n\n')
  return `# Deweyou Agent Memory Maintenance

Use the current agent model and the conversation already in context. Do not
start an external model command. Review the pending Observations below and
decide whether each contains a durable preference, decision, project fact, or
reusable lesson.

For each job, submit exactly one ResolutionProposal through:

\`deweyou-cli brain apply --data '<proposal-json>'\`

Use \`provider: "agent-hook"\`, \`prompt_version:
"agent-maintenance-v1"\`, device \`${config.device_id}\`, and policy
\`${config.compiler.policy_version}\`. Copy the job's event id into
\`input_ids\`; append its Source id when present. Use the Source id as
\`evidence_refs\` when present, otherwise use the Event id. Match the input
classification exactly.

When a job has \`local_source_path\`, inspect that local-only evidence if the
current conversation is insufficient. Never copy the transcript body into a
Claim or any Git-tracked artifact.

Allowed operations:

- ADD_CLAIM
- MERGE_CLAIMS
- SUPERSEDE_CLAIM
- SPLIT_SCOPE
- MARK_STALE
- LINK_ENTITIES
- REJECT_OBSERVATION
- REQUEST_HUMAN_DECISION

Do not copy a transcript into a Claim. Use REJECT_OBSERVATION when nothing is
worth retaining, and REQUEST_HUMAN_DECISION for ambiguous high-impact changes.
Never lower classification or include credentials.

After every proposal that you can safely resolve has been applied, run
\`deweyou-cli brain sync\`. If Git reports a non-generated conflict, stop and
surface it instead of overwriting either side.

Pending jobs:

${jobText}
`
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function utcPartition(value: string): string {
  const date = new Date(value)
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function safeJobId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('Brain maintenance job id is invalid')
  }
  return value
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return []
    throw error
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
