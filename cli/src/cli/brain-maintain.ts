import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import { applyResolutionProposal } from './brain-governance.ts'
import { indexBrain } from './brain-index.ts'
import {
  isRecord,
  parseClassification,
  parseScopes,
} from './brain-schema.ts'
import type {
  BrainConfig,
  BrainEvent,
  ResolutionOperation,
  ResolutionProposal,
} from './brain-types.ts'
import { compileWiki } from './brain-wiki.ts'
import { writeJsonAtomic } from './safe-io.ts'

const MAX_PROVIDER_OUTPUT = 10 * 1024 * 1024

export interface BrainMaintainResult {
  processed: number
  observed: number
  resolved: number
  pending: number
}

export async function maintainBrain({
  homeDir,
}: {
  homeDir?: string
} = {}): Promise<BrainMaintainResult> {
  const config = await loadBrainConfig({ homeDir })
  const paths = brainPaths(homeDir)
  const jobs = (await safeReaddir(paths.queueRoot))
    .filter((name) => name.endsWith('.json'))
    .sort()
  let processed = 0
  let observed = 0
  let resolved = 0
  let pending = 0

  for (const name of jobs) {
    const jobPath = join(paths.queueRoot, name)
    const job = JSON.parse(await readFile(jobPath, 'utf8')) as unknown
    if (!isRecord(job) || job.kind !== 'maintain-event') continue
    const eventPath = join(
      config.knowledge_repo,
      requiredString(job.event_path, 'job.event_path'),
    )
    const event = JSON.parse(await readFile(eventPath, 'utf8')) as BrainEvent
    await writeObservation(config, event, requiredString(job.job_id, 'job.job_id'))
    observed += 1

    if (config.compiler.provider === 'none') {
      pending += 1
      continue
    }

    const response = await runCommandProvider(config, {
      job,
      event,
      allowed_operations: [
        'ADD_CLAIM',
        'MERGE_CLAIMS',
        'SUPERSEDE_CLAIM',
        'SPLIT_SCOPE',
        'MARK_STALE',
        'LINK_ENTITIES',
        'REJECT_OBSERVATION',
        'REQUEST_HUMAN_DECISION',
      ],
    })
    const proposal = providerResponseToProposal(config, job, event, response)
    await applyResolutionProposal({ homeDir, proposal })
    await rm(jobPath)
    processed += 1
    resolved += 1
  }

  await compileWiki({ homeDir })
  await indexBrain({ homeDir })
  return { processed, observed, resolved, pending }
}

async function writeObservation(
  config: BrainConfig,
  event: BrainEvent,
  jobId: string,
): Promise<void> {
  const observationId = `observation_${createHash('sha256')
    .update(event.event_id)
    .digest('hex')
    .slice(0, 24)}`
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
}

async function runCommandProvider(
  config: BrainConfig,
  request: unknown,
): Promise<Record<string, unknown>> {
  const [file, ...args] = config.compiler.command
  if (!file) {
    throw new Error('Brain command compiler requires compiler.command')
  }
  const child = spawn(file, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length
    if (stdoutBytes <= MAX_PROVIDER_OUTPUT) stdout.push(chunk)
    else child.kill('SIGTERM')
  })
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  child.stdin.end(`${JSON.stringify(request)}\n`)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (stdoutBytes > MAX_PROVIDER_OUTPUT) {
    throw new Error(`Brain compiler output exceeds ${MAX_PROVIDER_OUTPUT} bytes`)
  }
  if (code !== 0) {
    throw new Error(
      `Brain compiler exited ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(stdout).toString('utf8'))
  } catch (error) {
    throw new Error(`Brain compiler returned invalid JSON: ${errorMessage(error)}`)
  }
  if (!isRecord(parsed)) throw new Error('Brain compiler response must be an object')
  return parsed
}

function providerResponseToProposal(
  config: BrainConfig,
  job: Record<string, unknown>,
  event: BrainEvent,
  response: Record<string, unknown>,
): ResolutionProposal {
  if (!Array.isArray(response.operations)) {
    throw new Error('Brain compiler response operations must be an array')
  }
  return {
    schema_version: 1,
    job_id: requiredString(job.job_id, 'job.job_id'),
    device_id: config.device_id,
    created_at: new Date().toISOString(),
    policy_version: config.compiler.policy_version,
    provider: 'command',
    model: requiredString(response.model, 'compiler.model'),
    prompt_version: requiredString(
      response.prompt_version ?? 'v1',
      'compiler.prompt_version',
    ),
    confidence: numberValue(response.confidence, 'compiler.confidence'),
    input_ids: [event.event_id, ...(event.source_id ? [event.source_id] : [])],
    input_classification: parseClassification(event.classification),
    evidence_refs: event.source_id ? [event.source_id] : [event.event_id],
    operations: response.operations as ResolutionOperation[],
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`)
  }
  return value
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    /* v8 ignore next -- unexpected readdir errors must surface unchanged. */
    throw error
  }
}

function errorMessage(error: unknown): string {
  /* v8 ignore next -- JSON.parse normally throws Error instances. */
  return error instanceof Error ? error.message : String(error)
}
