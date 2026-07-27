import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { usageError } from './args.ts'
import {
  captureBrainEvent,
  defaultBrainDeviceId,
  initBrain,
} from './brain.ts'
import { brainPaths, loadBrainConfig } from './brain-config.ts'
import { syncBrain } from './brain-git.ts'
import {
  discoverBrainHistory,
  importDiscoveredBrainHistory,
} from './brain-history.ts'
import {
  brainHookStatus,
  installBrainHooks,
  runBrainHook,
  uninstallBrainHooks,
} from './brain-hooks.ts'
import { indexBrain } from './brain-index.ts'
import {
  recordArtifactStateDecision,
  type UserArtifactStatus,
} from './brain-lifecycle.ts'
import { exportBrainProjection } from './brain-export.ts'
import { importBrainHistory } from './brain-import.ts'
import { maintainBrain } from './brain-maintain.ts'
import { recallBrain } from './brain-recall.ts'
import { parseClassification } from './brain-schema.ts'
import {
  installBrainSchedule,
  scheduleStatus,
  uninstallBrainSchedule,
  withBrainWorkerLock,
} from './brain-schedule.ts'
import type {
  BrainAgent,
  BrainHookFlags,
  BrainHookResult,
  BrainInitPromptInput,
  BrainInitPromptResult,
  BrainInitOptions,
  Classification,
  ContextPack,
  DiscoverableBrainAgent,
} from './brain-types.ts'

const execFileAsync = promisify(execFile)

export interface BrainCliFlags {
  homeDir?: string
  repo?: string
  device?: string
  remote?: string
  branch?: string
  agent?: string
  event?: string
  session?: string
  cwd?: string
  scope?: string
  classification?: string
  query?: string
  clearance?: string
  budget?: string | number
  path?: string
  output?: string
  interval?: string | number
  id?: string
  status?: string
  reason?: string
  format?: string
  data?: string
  dataFile?: string
  dryRun?: boolean
  force?: boolean
  quiet?: boolean
  includeArchived?: boolean
  noPush?: boolean
  discover?: boolean
}

export type BrainInitPrompt = (
  input: BrainInitPromptInput,
) => Promise<BrainInitPromptResult>

export async function runBrainInit(
  flags: BrainCliFlags = {},
  dependencies: { promptForBrainInit?: BrainInitPrompt } = {},
) {
  const userHome = flags.homeDir ?? homedir()
  let interactiveImportAgents: DiscoverableBrainAgent[] = []
  let interactiveHookAgents: Array<
    'codex' | 'claude' | 'hermes' | 'openclaw'
  > = []
  let installInteractiveSchedule = false
  if (!flags.repo) {
    if (!dependencies.promptForBrainInit && !process.stdin.isTTY) {
      throw usageError(
        'brain init requires --repo <path> in a non-interactive shell',
      )
    }
    const discovery = await discoverBrainHistory({
      homeDir: userHome,
      agent: 'all',
    })
    const prompt =
      dependencies.promptForBrainInit ??
      (await import('./brain-prompts.ts')).promptForBrainInit
    const prompted = await prompt({
      homeDir: userHome,
      defaultRepo: join(userHome, 'Documents', 'personal-brain'),
      defaultDevice: defaultBrainDeviceId(),
      discovery,
      supportsSchedule: platform() === 'darwin',
    })
    flags = {
      ...flags,
      repo: prompted.repo,
      device: prompted.device,
      remote: prompted.remote,
      branch: prompted.branch,
    }
    interactiveImportAgents = prompted.importAgents
    interactiveHookAgents = prompted.hookAgents
    installInteractiveSchedule = prompted.installSchedule
  }
  const options: BrainInitOptions = {
    homeDir: flags.homeDir,
    repoPath: flags.repo!,
    deviceId: flags.device,
    remote: flags.remote,
    branch: flags.branch,
    force: flags.force,
    dryRun: flags.dryRun,
  }
  const result = await initBrain(options)
  console.log(flags.dryRun ? 'Brain Init Plan' : 'Brain initialized')
  console.log(`Runtime config: ${result.configPath}`)
  console.log(`Knowledge repository: ${result.repoPath}`)
  console.log(`Device: ${result.config.device_id}`)
  const historyImport =
    !flags.dryRun && interactiveImportAgents.length > 0
      ? await importDiscoveredBrainHistory({
          homeDir: flags.homeDir,
          agent: interactiveImportAgents.length === 2
            ? 'all'
            : interactiveImportAgents[0],
        })
      : undefined
  if (historyImport) {
    console.log(
      `History import: ${historyImport.totals.captured} captured, ` +
      `${historyImport.totals.deduplicated} already present, ` +
      `${historyImport.totals.quarantined} quarantined`,
    )
  }
  const hookInstalls = []
  for (const agent of interactiveHookAgents) {
    hookInstalls.push(await installBrainHooks({
      homeDir: flags.homeDir,
      agent,
      dryRun: flags.dryRun,
    }))
  }
  const scheduleInstall = installInteractiveSchedule
    ? await installBrainSchedule({
        homeDir: flags.homeDir,
        dryRun: flags.dryRun,
      })
    : undefined
  return {
    ...result,
    historyImport,
    hookInstalls,
    scheduleInstall,
  }
}

export async function runBrainStatus(flags: BrainCliFlags = {}) {
  const config = await loadBrainConfig({ homeDir: flags.homeDir })
  const paths = brainPaths(flags.homeDir)
  const queue = await safeReaddir(paths.queueRoot)
  const result = {
    ok: await exists(config.knowledge_repo),
    runtime_root: paths.runtimeRoot,
    config_path: paths.configPath,
    knowledge_repo: config.knowledge_repo,
    device_id: config.device_id,
    database: {
      path: paths.databasePath,
      exists: await exists(paths.databasePath),
    },
    pending_jobs: queue.filter((name) => name.endsWith('.json')).length,
    git: await gitStatus(config.knowledge_repo),
    hooks: await brainHookStatus({ homeDir: flags.homeDir, agent: 'all' }),
  }
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainCapture(flags: BrainCliFlags = {}) {
  if (!flags.agent || !flags.event) {
    throw usageError('brain capture requires --agent and --event')
  }
  const data = await resolveInput(flags)
  const result = await captureBrainEvent({
    homeDir: flags.homeDir,
    agent: flags.agent,
    eventType: flags.event,
    sessionId: flags.session,
    cwd: flags.cwd,
    scopes: commaList(flags.scope),
    classification: flags.classification
      ? parseClassification(flags.classification)
      : undefined,
    data,
  })
  if (!flags.quiet) console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainImport(flags: BrainCliFlags = {}) {
  if (flags.discover) {
    if (flags.path) {
      throw usageError('brain import cannot combine --discover and --path')
    }
    const result = await importDiscoveredBrainHistory({
      homeDir: flags.homeDir,
      agent: (flags.agent ?? 'all') as DiscoverableBrainAgent | 'all',
      scopes: commaList(flags.scope),
      classification: flags.classification
        ? parseClassification(flags.classification)
        : undefined,
      dryRun: flags.dryRun,
    })
    console.log(JSON.stringify(result, null, 2))
    return result
  }
  if (flags.dryRun) {
    throw usageError('brain import --dry-run requires --discover')
  }
  if (!flags.agent || !flags.path) {
    throw usageError(
      'brain import requires --agent and --path, or use --discover',
    )
  }
  if (flags.agent === 'all') {
    throw usageError('brain import --agent all requires --discover')
  }
  const result = await importBrainHistory({
    homeDir: flags.homeDir,
    agent: flags.agent,
    path: flags.path,
    scopes: commaList(flags.scope),
    classification: flags.classification
      ? parseClassification(flags.classification)
      : undefined,
  })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainIndex(flags: BrainCliFlags = {}) {
  const result = await indexBrain({ homeDir: flags.homeDir })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainRecall(flags: BrainCliFlags = {}): Promise<ContextPack> {
  if (!flags.query) throw usageError('brain recall requires --query <text>')
  await indexBrain({ homeDir: flags.homeDir })
  const result = await recallBrain({
    homeDir: flags.homeDir,
    query: flags.query,
    clearance: flags.clearance
      ? parseClassification(flags.clearance)
      : undefined,
    allowedScopes: commaList(flags.scope),
    tokenBudget: flags.budget === undefined
      ? undefined
      : positiveInteger(flags.budget, 'budget'),
    includeArchived: flags.includeArchived,
  })
  if (flags.format === 'json') console.log(JSON.stringify(result, null, 2))
  else console.log(renderContextPack(result))
  return result
}

export async function runBrainExport(flags: BrainCliFlags = {}) {
  if (!flags.output) throw usageError('brain export requires --output <path>')
  if (flags.format && flags.format !== 'wiki' && flags.format !== 'knowledge') {
    throw usageError('brain export --format must be wiki or knowledge')
  }
  const result = await exportBrainProjection({
    homeDir: flags.homeDir,
    outputDir: flags.output,
    clearance: flags.clearance
      ? parseClassification(flags.clearance)
      : 'public',
    allowedScopes: commaList(flags.scope),
    format: flags.format as 'wiki' | 'knowledge' | undefined,
    dryRun: flags.dryRun,
  })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainState(flags: BrainCliFlags = {}) {
  if (!flags.id || !flags.status || !flags.reason) {
    throw usageError('brain state requires --id, --status, and --reason')
  }
  const allowed = ['active', 'stale', 'archived', 'deleted'] as const
  if (!allowed.includes(flags.status as UserArtifactStatus)) {
    throw usageError(`brain state --status must be one of ${allowed.join(', ')}`)
  }
  const result = await recordArtifactStateDecision({
    homeDir: flags.homeDir,
    artifactId: flags.id,
    targetStatus: flags.status as UserArtifactStatus,
    reason: flags.reason,
  })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainMaintain(flags: BrainCliFlags = {}) {
  const result = await maintainBrain({ homeDir: flags.homeDir })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainSync(flags: BrainCliFlags = {}) {
  const result = await syncBrain({ homeDir: flags.homeDir })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainWorker(flags: BrainCliFlags = {}) {
  const result = await withBrainWorkerLock(flags.homeDir, async () => {
    const maintenance = await maintainBrain({ homeDir: flags.homeDir })
    const sync = flags.noPush ? null : await syncBrain({ homeDir: flags.homeDir })
    return { maintenance, sync }
  })
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainScheduleCommand(
  command: 'install' | 'status' | 'uninstall',
  flags: BrainCliFlags = {},
) {
  const result = command === 'install'
    ? await installBrainSchedule({
      homeDir: flags.homeDir,
      intervalSeconds: flags.interval === undefined
        ? undefined
        : positiveInteger(flags.interval, 'interval'),
      dryRun: flags.dryRun,
    })
    : command === 'uninstall'
      ? await uninstallBrainSchedule({
        homeDir: flags.homeDir,
        dryRun: flags.dryRun,
      })
      : await scheduleStatus(flags.homeDir)
  console.log(JSON.stringify(result, null, 2))
  return result
}

export async function runBrainHookCommand(
  command: 'install' | 'status' | 'uninstall' | 'run',
  flags: BrainHookFlags & { dataFile?: string },
): Promise<BrainHookResult | Awaited<ReturnType<typeof brainHookStatus>> | Record<string, unknown>> {
  if (command === 'run') {
    const data = flags.dataFile
      ? await readFile(flags.dataFile, 'utf8')
      : flags.data ?? await readStdin()
    const result = await runBrainHook({
      ...flags,
      agent: flags.agent as BrainAgent,
      event: flags.event!,
      data,
    })
    console.log(JSON.stringify(result))
    return result
  }
  if (command === 'status') {
    const result = await brainHookStatus(flags)
    console.log(JSON.stringify(result, null, 2))
    return result
  }
  const result = command === 'install'
    ? await installBrainHooks(flags)
    : await uninstallBrainHooks(flags)
  console.log(JSON.stringify(result, null, 2))
  return result
}

function renderContextPack(context: ContextPack): string {
  if (context.entries.length === 0) return '# Deweyou Context Pack\n\nNo matching context.\n'
  const warnings =
    context.warnings.length === 0
      ? ''
      : `\n## Warnings\n\n${context.warnings.map((warning) => `- ${warning}`).join('\n')}\n`
  return `# Deweyou Context Pack

Query: ${context.query}
Scopes: ${context.allowed_scopes.join(', ')}
Clearance: ${context.clearance}
Budget: ${context.estimated_tokens}/${context.token_budget} estimated tokens

${context.entries
  .map(
    (entry) => `## ${entry.title}

${entry.content}

_Source: ${entry.id}; path: ${entry.path}; classification: ${entry.classification}; status: ${entry.status}._
`,
  )
  .join('\n')}${warnings}`
}

async function resolveInput(flags: BrainCliFlags): Promise<string | undefined> {
  if (flags.data && flags.dataFile) {
    throw usageError('--data and --data-file cannot be used together')
  }
  if (flags.dataFile) return readFile(flags.dataFile, 'utf8')
  if (flags.data) return flags.data
  return readStdin()
}

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const value = Buffer.concat(chunks).toString('utf8')
  return value.trim() ? value : undefined
}

function commaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const values = value.split(',').map((item) => item.trim()).filter(Boolean)
  return values.length > 0 ? values : undefined
}

function positiveInteger(value: string | number, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw usageError(`${label} must be a positive integer`)
  }
  return parsed
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return []
    /* v8 ignore next -- unexpected readdir errors must surface unchanged. */
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    /* v8 ignore next -- unexpected stat errors must surface unchanged. */
    throw error
  }
}

async function gitStatus(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'status', '--short', '--branch'])
    return stdout.trim()
  } catch {
    /* v8 ignore next -- git availability is reported rather than fatal. */
    return 'unavailable'
  }
}

function hasCode(error: unknown, code: string): boolean {
  /* v8 ignore next -- defensive handling for non-Node filesystem throws. */
  return error instanceof Error && 'code' in error && error.code === code
}
