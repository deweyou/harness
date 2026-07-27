import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import yaml from 'js-yaml'

import { brainPaths, createBrainConfig, loadBrainConfig } from './brain-config.ts'
import { parseClassification, parseScopes } from './brain-schema.ts'
import { knowledgeRepositoryTemplates } from './brain-templates.ts'
import {
  BRAIN_AGENTS,
  type BrainCaptureOptions,
  type BrainCaptureResult,
  type BrainConfig,
  type BrainEvent,
  type BrainInitOptions,
  type BrainSource,
} from './brain-types.ts'
import {
  mkdirPrivate,
  readTextLimited,
  writeFileAtomic,
  writeJsonAtomic,
} from './safe-io.ts'

const { dump: dumpYaml } = yaml
const execFileAsync = promisify(execFile)
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024

export { loadBrainConfig } from './brain-config.ts'

export async function initBrain(options: BrainInitOptions): Promise<{
  config: BrainConfig
  configPath: string
  repoPath: string
  files: string[]
  dryRun: boolean
}> {
  const now = options.now ?? new Date()
  const homeDir = options.homeDir
  const repoPath = resolve(options.repoPath)
  const deviceId = options.deviceId ?? defaultBrainDeviceId()
  const config = createBrainConfig({
    repoPath,
    deviceId,
    remote: options.remote ? 'origin' : undefined,
    branch: options.branch,
  })
  const paths = brainPaths(homeDir)
  const templates = knowledgeRepositoryTemplates(config, now)
  const files = [paths.configPath, ...Object.keys(templates).map((path) => join(repoPath, path))]

  if (options.dryRun) {
    return { config, configPath: paths.configPath, repoPath, files, dryRun: true }
  }

  await prepareKnowledgeRepository(repoPath, config.sync.branch, options.remote)
  await mkdirPrivate(paths.runtimeRoot)
  await mkdirPrivate(paths.queueRoot)
  await mkdirPrivate(paths.quarantineRoot)
  await mkdirPrivate(paths.contextPackRoot)
  await mkdirPrivate(paths.locksRoot)
  await writeFileAtomic(
    paths.configPath,
    dumpYaml(config, { noRefs: true, lineWidth: 100 }),
  )

  for (const [path, content] of Object.entries(templates)) {
    await writeKnowledgeFile(join(repoPath, path), content, options.force === true)
  }
  await initializeGitRepository(repoPath, config.sync.branch, options.remote)

  return { config, configPath: paths.configPath, repoPath, files, dryRun: false }
}

export async function captureBrainEvent(
  options: BrainCaptureOptions,
): Promise<BrainCaptureResult> {
  const config = await loadBrainConfig({ homeDir: options.homeDir })
  const paths = brainPaths(options.homeDir)
  const agent = parseAgent(options.agent)
  const occurredAt = options.now ?? new Date()
  const id = options.idFactory?.() ?? randomUUID()
  const payload = await resolveCapturePayload(options)
  const sourceContent = await extractSourceContent(payload)
  const secretFindings = findSecrets(secretScanText(payload, sourceContent))

  if (secretFindings.length > 0) {
    const quarantinePath = join(
      paths.quarantineRoot,
      `${fileTimestamp(occurredAt)}-${safeSegment(id)}.json`,
    )
    const created = await writeImmutableJson(quarantinePath, {
      schema_version: 1,
      quarantined_at: occurredAt.toISOString(),
      agent,
      event_type: options.eventType,
      findings: secretFindings,
      payload,
      source_content: sourceContent,
    })
    return {
      status: 'quarantined',
      created,
      eventPath: null,
      sourcePath: null,
      jobPath: null,
      quarantinePath,
      event: null,
    }
  }

  const intendedScopes = parseScopes(
    options.scopes ?? config.defaults.scopes,
    'capture scopes',
  )
  const cwd = options.cwd ?? stringField(payload.cwd)
  const scopes = cwd ? [`device/${config.device_id}`] : intendedScopes
  const classification = parseClassification(
    options.classification ?? config.defaults.classification,
    'capture classification',
  )
  const sourceId = sourceContent === null ? null : `source_${id}`
  const eventPayload = structuredClone(payload)
  delete eventPayload.transcript
  delete eventPayload.transcript_path
  delete eventPayload.cwd
  if (sourceId) eventPayload.transcript_ref = sourceId
  if (cwd) eventPayload.intended_scopes = intendedScopes

  const event: BrainEvent = {
    schema_version: 1,
    event_id: `event_${id}`,
    occurred_at: occurredAt.toISOString(),
    device_id: config.device_id,
    agent,
    event_type: requiredEventType(options.eventType),
    session_id: options.sessionId ?? stringField(payload.session_id),
    cwd,
    scopes,
    classification,
    source_id: sourceId,
    payload: eventPayload,
  }
  const partition = datePartition(occurredAt)
  const eventPath = join(
    config.knowledge_repo,
    'events',
    config.device_id,
    partition,
    `${safeSegment(id)}.json`,
  )
  let sourcePath: string | null = null
  if (sourceId && sourceContent !== null) {
    const source: BrainSource = {
      schema_version: 1,
      source_id: sourceId,
      source_type: 'agent-session',
      captured_at: occurredAt.toISOString(),
      device_id: config.device_id,
      agent,
      session_id: event.session_id,
      scopes,
      classification,
      content: sourceContent,
    }
    sourcePath = join(
      config.knowledge_repo,
      'sources',
      'sessions',
      agent,
      partition,
      `${safeSegment(id)}.json`,
    )
    await writeImmutableJson(sourcePath, source)
  }
  const created = await writeImmutableJson(eventPath, event)

  const jobId = createHash('sha256')
    .update(`${event.event_id}:${sourceId ?? ''}:${config.compiler.policy_version}`)
    .digest('hex')
  const jobPath = join(paths.queueRoot, `${jobId}.json`)
  await writeJsonAtomic(jobPath, {
    schema_version: 1,
    job_id: jobId,
    kind: 'maintain-event',
    created_at: occurredAt.toISOString(),
    event_id: event.event_id,
    event_path: relative(config.knowledge_repo, eventPath),
    source_id: sourceId,
    source_path: sourcePath ? relative(config.knowledge_repo, sourcePath) : null,
    policy_version: config.compiler.policy_version,
    attempts: 0,
  })

  return {
    status: 'captured',
    created,
    eventPath,
    sourcePath,
    jobPath,
    quarantinePath: null,
    event,
  }
}

async function resolveCapturePayload(
  options: BrainCaptureOptions,
): Promise<Record<string, unknown>> {
  if (options.payload) return options.payload
  if (!options.data) return {}
  const bytes = Buffer.byteLength(options.data)
  if (bytes > MAX_CAPTURE_BYTES) {
    throw new Error(`Brain capture exceeds ${MAX_CAPTURE_BYTES} bytes`)
  }
  let value: unknown
  try {
    value = JSON.parse(options.data)
  } catch (error) {
    throw new Error(`Invalid Brain capture JSON: ${errorMessage(error)}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Brain capture data must be a JSON object')
  }
  return value as Record<string, unknown>
}

async function extractSourceContent(
  payload: Record<string, unknown>,
): Promise<unknown | null> {
  if (payload.transcript !== undefined) return payload.transcript
  if (typeof payload.transcript_path !== 'string') return null
  return readTextLimited(payload.transcript_path, MAX_CAPTURE_BYTES)
}

function findSecrets(value: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
    ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ['aws-access-key', /\bAKIA[A-Z0-9]{16}\b/],
    [
      'credential-assignment',
      /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i,
    ],
  ]
  return patterns.filter(([, pattern]) => pattern.test(value)).map(([name]) => name)
}

function secretScanText(...values: unknown[]): string {
  const strings: string[] = []
  const seen = new WeakSet<object>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value)
      return
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') strings.push(`${key}=${item}`)
      visit(item)
    }
  }
  for (const value of values) visit(value)
  return strings.join('\n')
}

async function writeKnowledgeFile(
  path: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (!force && await exists(path)) return
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, content)
  await chmod(path, 0o600)
}

async function initializeGitRepository(
  repoPath: string,
  branch: string,
  remote?: string,
): Promise<void> {
  if (!await exists(join(repoPath, '.git'))) {
    await execFileAsync('git', ['-C', repoPath, 'init', '-b', branch])
  }
  if (remote) {
    const existing = await gitOutput(repoPath, ['remote', 'get-url', 'origin'])
    if (!existing) {
      await execFileAsync('git', ['-C', repoPath, 'remote', 'add', 'origin', remote])
    } else if (existing !== remote) {
      throw new Error(`Knowledge repository origin already points to ${existing}`)
    }
  }
}

async function prepareKnowledgeRepository(
  repoPath: string,
  branch: string,
  remote?: string,
): Promise<void> {
  if (!remote || await exists(join(repoPath, '.git'))) {
    await mkdir(repoPath, { recursive: true })
    return
  }
  const remoteBranch = await commandResult('git', [
    'ls-remote',
    '--heads',
    remote,
    branch,
  ])
  if (!remoteBranch.ok) {
    throw new Error(
      `Unable to inspect Brain remote ${remote}: ${remoteBranch.stderr.trim()}`,
    )
  }
  if (!remoteBranch.stdout.trim()) {
    await mkdir(repoPath, { recursive: true })
    return
  }
  const cloned = await commandResult('git', [
    'clone',
    '--branch',
    branch,
    '--single-branch',
    remote,
    repoPath,
  ])
  if (!cloned.ok) {
    throw new Error(
      `Unable to clone Brain remote into ${repoPath}: ${cloned.stderr.trim()}`,
    )
  }
}

async function gitOutput(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args])
    return stdout.trim()
  } catch {
    return ''
  }
}

async function commandResult(
  file: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args)
    return { ok: true, stdout, stderr }
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      return {
        ok: false,
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? error.message),
      }
    }
    return { ok: false, stdout: '', stderr: errorMessage(error) }
  }
}

function parseAgent(value: string) {
  if (!BRAIN_AGENTS.includes(value as (typeof BRAIN_AGENTS)[number])) {
    throw new Error(`Brain agent must be one of ${BRAIN_AGENTS.join(', ')}`)
  }
  return value as (typeof BRAIN_AGENTS)[number]
}

function requiredEventType(value: string): string {
  if (!/^[a-z][a-z0-9._:-]{0,63}$/.test(value)) {
    throw new Error('Brain event type must be a lowercase safe identifier')
  }
  return value
}

export function defaultBrainDeviceId(): string {
  return hostname()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'device'
}

function datePartition(value: Date): string {
  return `${value.getUTCFullYear()}/${String(value.getUTCMonth() + 1).padStart(2, '0')}`
}

function fileTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-')
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 160)
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    /* v8 ignore next -- unexpected stat errors must surface unchanged. */
    throw error
  }
}

function errorMessage(error: unknown): string {
  /* v8 ignore next -- JSON.parse and execFile normally provide Error instances. */
  return error instanceof Error ? error.message : String(error)
}

async function writeImmutableJson(path: string, value: unknown): Promise<boolean> {
  const content = `${JSON.stringify(value, null, 2)}\n`
  try {
    const existing = await readFile(path, 'utf8')
    if (existing === content) return false
    throw new Error(
      `Immutable Brain artifact already exists with different content: ${path}`,
    )
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  await writeFileAtomic(path, content)
  return true
}
