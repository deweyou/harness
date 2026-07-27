import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { brainPaths } from './brain-config.ts'
import { writeFileAtomic, writeJsonAtomic } from './safe-io.ts'

const execFileAsync = promisify(execFile)
const LABEL = 'com.deweyou.brain.worker'
const MIN_INTERVAL_SECONDS = 60
const MAX_INTERVAL_SECONDS = 86_400

export interface BrainScheduleOptions {
  homeDir?: string
  intervalSeconds?: number
  dryRun?: boolean
  command?: string[]
  activate?: boolean
}

export interface BrainScheduleStatus {
  supported: boolean
  installed: boolean
  active: boolean
  label: string
  path: string
  intervalSeconds: number | null
  command: string[]
  detail: string
}

export async function installBrainSchedule(
  options: BrainScheduleOptions = {},
): Promise<BrainScheduleStatus> {
  assertSupported()
  const intervalSeconds = validateInterval(options.intervalSeconds ?? 300)
  const command = options.command ?? defaultWorkerCommand()
  const path = schedulePath(options.homeDir)
  if (options.dryRun) {
    return {
      supported: true,
      installed: false,
      active: false,
      label: LABEL,
      path,
      intervalSeconds,
      command,
      detail: 'planned',
    }
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, launchAgentPlist(command, intervalSeconds))
  await chmod(path, 0o600)
  await writeJsonAtomic(brainPaths(options.homeDir).scheduleManifestPath, {
    schema_version: 1,
    label: LABEL,
    path,
    interval_seconds: intervalSeconds,
    command,
  })
  /* v8 ignore next 8 -- launchctl activation is an OS integration boundary. */
  if (options.activate !== false) {
    await bootout(path)
    await execFileAsync('launchctl', [
      'bootstrap',
      launchDomain(),
      path,
    ])
  }
  return scheduleStatus(options.homeDir, options.activate !== false)
}

export async function uninstallBrainSchedule({
  homeDir,
  dryRun = false,
  activate = true,
}: BrainScheduleOptions = {}): Promise<BrainScheduleStatus> {
  assertSupported()
  const before = await scheduleStatus(homeDir, activate)
  if (dryRun) return { ...before, detail: 'planned removal' }
  /* v8 ignore next -- launchctl removal is an OS integration boundary. */
  if (activate) await bootout(before.path)
  await rm(before.path, { force: true })
  await rm(brainPaths(homeDir).scheduleManifestPath, { force: true })
  return {
    ...before,
    installed: false,
    active: false,
    intervalSeconds: null,
    command: [],
    detail: 'not installed',
  }
}

export async function scheduleStatus(
  homeDir?: string,
  inspectLaunchctl = true,
): Promise<BrainScheduleStatus> {
  /* v8 ignore next 11 -- exercised on non-macOS CI; this workspace is macOS. */
  if (platform() !== 'darwin') {
    return {
      supported: false,
      installed: false,
      active: false,
      label: LABEL,
      path: schedulePath(homeDir),
      intervalSeconds: null,
      command: [],
      detail: 'V1 scheduled workers support macOS launchd',
    }
  }
  const path = schedulePath(homeDir)
  const installed = await exists(path)
  let intervalSeconds: number | null = null
  let command: string[] = []
  try {
    const manifest = JSON.parse(
      await readFile(brainPaths(homeDir).scheduleManifestPath, 'utf8'),
    ) as { interval_seconds?: unknown; command?: unknown }
    if (typeof manifest.interval_seconds === 'number') {
      intervalSeconds = manifest.interval_seconds
    }
    if (
      Array.isArray(manifest.command) &&
      manifest.command.every((item) => typeof item === 'string')
    ) {
      command = manifest.command
    }
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
  }
  /* v8 ignore next 3 -- active launchd inspection requires a live user service. */
  const active = installed && inspectLaunchctl
    ? (await launchctlResult(['print', `${launchDomain()}/${LABEL}`])).ok
    : false
  return {
    supported: true,
    installed,
    active,
    label: LABEL,
    path,
    intervalSeconds,
    command,
    detail: installed ? (active ? 'installed and active' : 'installed') : 'not installed',
  }
}

export async function withBrainWorkerLock<T>(
  homeDir: string | undefined,
  work: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  const lockPath = join(brainPaths(homeDir).locksRoot, 'worker')
  await mkdir(dirname(lockPath), { recursive: true })
  try {
    await mkdir(lockPath)
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
    const metadata = await stat(lockPath)
    if (Date.now() - metadata.mtimeMs <= 30 * 60 * 1000) {
      return { skipped: true, reason: 'worker already running' }
    }
    await rm(lockPath, { recursive: true, force: true })
    await mkdir(lockPath)
  }
  try {
    return await work()
  } finally {
    await rm(lockPath, { recursive: true, force: true })
  }
}

function schedulePath(homeDir = brainPaths().homeDir): string {
  return join(homeDir, 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

function defaultWorkerCommand(): string[] {
  /* v8 ignore next -- Node CLI processes always provide argv[1]. */
  const entry = process.argv[1] ? resolve(process.argv[1]) : 'deweyou-cli'
  /* v8 ignore next 2 -- the fallback exists for embedded launchers only. */
  return entry === 'deweyou-cli'
    ? [entry, 'brain', 'worker']
    : [process.execPath, entry, 'brain', 'worker']
}

function launchAgentPlist(command: string[], intervalSeconds: number): string {
  const argumentsXml = command
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function validateInterval(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_INTERVAL_SECONDS ||
    value > MAX_INTERVAL_SECONDS
  ) {
    throw new Error(
      `Brain schedule interval must be ${MIN_INTERVAL_SECONDS}-${MAX_INTERVAL_SECONDS} seconds`,
    )
  }
  return value
}

function assertSupported(): void {
  /* v8 ignore next 3 -- exercised on non-macOS CI; this workspace is macOS. */
  if (platform() !== 'darwin') {
    throw new Error('Brain scheduled workers currently require macOS launchd')
  }
}

function launchDomain(): string {
  return `gui/${process.getuid?.() ?? 0}`
}

async function bootout(path: string): Promise<void> {
  await launchctlResult(['bootout', launchDomain(), path])
}

/* v8 ignore next -- launchctl process behavior is an OS integration boundary. */
async function launchctlResult(
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('launchctl', args)
    return { ok: true, output: `${stdout}${stderr}` }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
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

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
