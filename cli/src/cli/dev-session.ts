import { randomBytes } from 'node:crypto'
import { readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  parseDevEventLog,
  renderDevSummary,
  summarizeDevEvents,
  validateDevEventSequence,
} from './dev-events.ts'
import {
  assertDdevCompatibility,
  assertDdevRuntimeAssets,
  loadDdevManifest,
} from './dev-manifest.ts'
import {
  currentBranch,
  currentHead,
  legacySessionPath,
  resolveDdevPaths,
  type DdevPaths,
} from './dev-paths.ts'
import {
  ensurePrivateFile,
  mkdirPrivate,
  readTextLimited,
  writeFileAtomic,
  writeJsonAtomic,
} from './safe-io.ts'
import type {
  DevFlags,
  DevSession,
  DevSessionListItem,
  DevSessionListResult,
  DevSessionResult,
} from './types.ts'
import { CLI_VERSION } from './version-contract.ts'

const SESSION_METADATA = 'session.json'
const MINIMAL_SESSION_FILES: Record<string, string> = {
  'events.jsonl': '',
  'summary.md': '# DDev Session Summary\n\n- Incomplete: no events summarized yet.\n',
}

export interface ResolvedSession {
  id: string
  branch: string
  path: string
  session: DevSession | null
  legacy: boolean
}

export async function runDevSessionStart(flags: DevFlags = {}): Promise<DevSessionResult> {
  const title = requireTitle(flags.title)
  const paths = await resolveDdevPaths(flags)
  await assertRuntimeReady(paths)
  const current = await readCurrentSession(paths)
  if (current?.status === 'active') {
    throw new Error(
      `DDev session ${current.id} is already active for this checkout. Close it before starting another task.`,
    )
  }

  const now = new Date()
  const branch = await currentBranch(paths.repoRoot)
  const session: DevSession = {
    schema_version: 1,
    id: createSessionId(title, now),
    title,
    repo_id: paths.repoId,
    repo_root: paths.repoRoot,
    branch,
    head_sha: await currentHead(paths.repoRoot),
    status: 'active',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
  const sessionPath = join(paths.repoStateRoot, 'sessions', session.id)

  await mkdirPrivate(sessionPath)
  await writeJsonAtomic(join(sessionPath, SESSION_METADATA), session)
  await writeFileAtomic(
    join(sessionPath, 'task.md'),
    `# Task\n\n- Title: ${title}\n- Branch: ${branch}\n- Status: active\n`,
  )
  await Promise.all(
    Object.entries(MINIMAL_SESSION_FILES).map(([name, content]) =>
      ensurePrivateFile(join(sessionPath, name), content),
    ),
  )
  await writeCurrentSession(paths, session.id)

  console.log(`Started DDev session: ${session.id}`)
  console.log(`Task: ${session.title}`)
  console.log(`Session: ${sessionPath}`)
  return { session, sessionPath }
}

export async function runDevSessionList(flags: DevFlags = {}): Promise<DevSessionListResult> {
  const paths = await resolveDdevPaths(flags)
  const pointer = await readPointer(paths)
  const roots = [paths.repoStateRoot, paths.legacyGlobalRepoStateRoot].filter(
    (path): path is string => Boolean(path),
  )
  const sessions: DevSessionListItem[] = []

  for (const root of roots) {
    sessions.push(...await listRootSessions(root, pointer?.session_id ?? null))
  }
  sessions.sort((left, right) => left.id.localeCompare(right.id))

  if (sessions.length === 0) {
    console.log('No DDev sessions found for this repository.')
  } else {
    for (const session of sessions) {
      const marker = session.current ? '*' : ' '
      console.log(`${marker} ${session.id}\t${session.status}\t${session.title ?? session.branch ?? ''}`)
    }
  }

  return { sessions }
}

export async function runDevSessionStatus(flags: DevFlags = {}): Promise<DevSessionResult | null> {
  const paths = await resolveDdevPaths(flags)
  const resolved = flags.id
    ? await resolveSessionById(paths, flags.id)
    : await resolveCurrentSession(paths)

  if (!resolved || !resolved.session) {
    console.log(flags.id ? `DDev session not found: ${flags.id}` : 'No current DDev session for this checkout.')
    return null
  }

  console.log(`DDev Session: ${resolved.session.id}`)
  console.log(`Task: ${resolved.session.title}`)
  console.log(`Status: ${resolved.session.status}`)
  console.log(`Branch: ${resolved.session.branch}`)
  console.log(`Path: ${resolved.path}`)
  return { session: resolved.session, sessionPath: resolved.path }
}

export async function runDevSessionClose(flags: DevFlags = {}): Promise<DevSessionResult> {
  const paths = await resolveDdevPaths(flags)
  await assertRuntimeReady(paths)
  const resolved = await requireManagedSession(paths, flags.id)
  if (resolved.session.status !== 'active') {
    throw new Error(`DDev session ${resolved.id} is ${resolved.session.status}, not active.`)
  }

  await updateSessionSummary(resolved)
  const session = await updateSessionStatus(resolved, 'closed')
  console.log(`Closed DDev session: ${resolved.id}`)
  return { session, sessionPath: resolved.path }
}

export async function runDevSessionArchive(flags: DevFlags = {}): Promise<DevSessionResult> {
  const paths = await resolveDdevPaths(flags)
  await assertRuntimeReady(paths)
  const resolved = await requireManagedSession(paths, flags.id)
  if (resolved.session.status !== 'closed') {
    throw new Error(`DDev session ${resolved.id} must be closed before it can be archived.`)
  }

  const archivePath = join(paths.repoStateRoot, 'archives', resolved.id)
  await mkdirPrivate(join(paths.repoStateRoot, 'archives'))
  await rename(resolved.path, archivePath)
  const session = await updateSessionStatus(
    { ...resolved, path: archivePath },
    'archived',
  )
  console.log(`Archived DDev session: ${resolved.id}`)
  return { session, sessionPath: archivePath }
}

export async function runDevSessionClean(flags: DevFlags = {}): Promise<{
  target: string
  removed: boolean
  dryRun: boolean
}> {
  const paths = await resolveDdevPaths(flags)
  const dryRun = flags.dryRun === true
  if (!dryRun && flags.force !== true) {
    throw new Error('DDev session clean permanently deletes local task state. Re-run with --force.')
  }

  if (flags.all) {
    const active = (await runDevSessionListQuiet(paths)).filter((item) => item.status === 'active')
    if (active.length > 0) {
      throw new Error(`Close active DDev sessions before cleaning all: ${active.map((item) => item.id).join(', ')}`)
    }
    const target = paths.repoStateRoot
    if (dryRun) return cleanPlan(target)
    let removed = false
    for (const name of ['sessions', 'archives', 'checkouts']) {
      const child = join(paths.repoStateRoot, name)
      if (await pathExists(child)) {
        await rm(child, { recursive: true, force: true })
        removed = true
      }
    }
    console.log(removed ? `Removed DDev task state: ${target}` : `Nothing to clean: ${target}`)
    return { target, removed, dryRun }
  }

  const id = flags.id ?? await currentSessionId(paths)
  if (!id) throw new Error('No DDev session selected. Pass --id <session-id>.')
  const resolved = await resolveSessionById(paths, id)
  const target = resolved?.path ?? join(paths.repoStateRoot, 'sessions', assertSafeId(id))
  if (dryRun) return cleanPlan(target)
  if (!resolved) {
    console.log(`Nothing to clean: ${target}`)
    return { target, removed: false, dryRun }
  }
  if (resolved.session?.status === 'active') {
    throw new Error(`DDev session ${id} is active. Close it before permanent cleanup.`)
  }

  await rm(target, { recursive: true, force: true })
  await clearPointerIfCurrent(paths, id)
  console.log(`Removed DDev session: ${target}`)
  return { target, removed: true, dryRun }
}

export async function resolveOperationalSession(
  flags: DevFlags,
  { allowClosed = false } = {},
): Promise<ResolvedSession> {
  const paths = await resolveDdevPaths(flags)
  await assertRuntimeReady(paths)

  if (flags.branch) {
    const path = legacySessionPath(paths.repoStateRoot, flags.branch)
    if (!await pathExists(path)) {
      throw new Error(
        `Legacy DDev branch session is missing: ${path}. Start a task session with \`deweyou-cli dev session start --title "..."\`.`,
      )
    }
    return { id: flags.branch, branch: flags.branch, path, session: null, legacy: true }
  }

  const resolved = flags.id
    ? await resolveSessionById(paths, flags.id)
    : await resolveCurrentSession(paths)
  if (!resolved?.session) {
    throw new Error(
      'No active DDev task session. Run `deweyou-cli dev session start --title "..."` first.',
    )
  }
  if (!allowClosed && resolved.session.status !== 'active') {
    throw new Error(`DDev session ${resolved.id} is ${resolved.session.status}, not active.`)
  }
  return resolved
}

export async function assertRuntimeReady(paths: DdevPaths): Promise<void> {
  const manifest = await loadDdevManifest(paths.homeDir)
  assertDdevCompatibility(manifest)
  const runtime = await readJson(join(paths.runtimeRoot, 'config.json'))
  const repo = await readJson(join(paths.repoStateRoot, 'config.json'))
  if (runtime.runtimeSchema !== manifest.runtime_schema || repo.runtimeSchema !== manifest.runtime_schema) {
    throw new Error('DDev runtime is not initialized or is incompatible. Run `deweyou-cli dev install`.')
  }
  if (runtime.cliVersion !== CLI_VERSION) {
    throw new Error(
      `DDev runtime was initialized by CLI ${String(runtime.cliVersion)}, current ${CLI_VERSION}. Run \`deweyou-cli dev install\`.`,
    )
  }
  await assertDdevRuntimeAssets(paths.homeDir, manifest)
}

async function requireManagedSession(paths: DdevPaths, id?: string): Promise<ResolvedSession & { session: DevSession }> {
  const resolved = id ? await resolveSessionById(paths, id) : await resolveCurrentSession(paths)
  if (!resolved) throw new Error(id ? `DDev session not found: ${id}` : 'No active DDev session for this checkout.')
  if (!resolved.session) throw new Error(`Legacy DDev session ${resolved.id} has no managed lifecycle metadata.`)
  return { ...resolved, session: resolved.session }
}

async function resolveCurrentSession(paths: DdevPaths): Promise<ResolvedSession | null> {
  const id = await currentSessionId(paths)
  return id ? resolveSessionById(paths, id) : null
}

async function currentSessionId(paths: DdevPaths): Promise<string | null> {
  return (await readPointer(paths))?.session_id ?? null
}

async function readCurrentSession(paths: DdevPaths): Promise<DevSession | null> {
  return (await resolveCurrentSession(paths))?.session ?? null
}

async function resolveSessionById(paths: DdevPaths, idValue: string): Promise<ResolvedSession | null> {
  const id = assertSafeId(idValue)
  for (const container of ['sessions', 'archives']) {
    const path = join(paths.repoStateRoot, container, id)
    if (!await pathExists(path)) continue
    const session = await readSession(path)
    return {
      id,
      branch: session?.branch ?? id,
      path,
      session,
      legacy: session === null,
    }
  }
  return null
}

async function readSession(path: string): Promise<DevSession | null> {
  try {
    const value = JSON.parse(await readFile(join(path, SESSION_METADATA), 'utf8'))
    if (!isSession(value)) {
      throw new Error(`Invalid DDev session metadata: ${join(path, SESSION_METADATA)}`)
    }
    return value
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

async function updateSessionStatus(
  resolved: ResolvedSession & { session: DevSession },
  status: 'closed' | 'archived',
): Promise<DevSession> {
  const session: DevSession = {
    ...resolved.session,
    status,
    updated_at: new Date().toISOString(),
  }
  await writeJsonAtomic(join(resolved.path, SESSION_METADATA), session)
  const taskPath = join(resolved.path, 'task.md')
  const task = await readFile(taskPath, 'utf8')
  await writeFileAtomic(taskPath, task.replace(/- Status: \w+/, `- Status: ${status}`))
  return session
}

async function updateSessionSummary(resolved: ResolvedSession & { session: DevSession }): Promise<void> {
  const eventsPath = join(resolved.path, 'events.jsonl')
  const events = parseDevEventLog(await readTextLimited(eventsPath, 10 * 1024 * 1024))
  validateDevEventSequence(events, {
    expectedBranch: resolved.session.branch,
    expectedSessionId: resolved.session.id,
  })
  const summary = summarizeDevEvents(resolved.session.id, events)
  await writeFileAtomic(join(resolved.path, 'summary.md'), renderDevSummary(summary))
}

async function writeCurrentSession(paths: DdevPaths, sessionId: string): Promise<void> {
  await writeJsonAtomic(paths.checkoutPointerPath, {
    schema_version: 1,
    session_id: sessionId,
    repo_root: paths.repoRoot,
    updated_at: new Date().toISOString(),
  })
}

async function readPointer(paths: DdevPaths): Promise<{ session_id: string } | null> {
  try {
    const value = JSON.parse(await readFile(paths.checkoutPointerPath, 'utf8'))
    return isRecord(value) && typeof value.session_id === 'string'
      ? { session_id: value.session_id }
      : null
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

async function clearPointerIfCurrent(paths: DdevPaths, id: string): Promise<void> {
  if ((await readPointer(paths))?.session_id === id) {
    await rm(paths.checkoutPointerPath, { force: true })
  }
}

async function listRootSessions(root: string, currentId: string | null): Promise<DevSessionListItem[]> {
  const items: DevSessionListItem[] = []
  for (const [container, archived] of [['sessions', false], ['archives', true]] as const) {
    const directory = join(root, container)
    for (const entry of await readDirectories(directory)) {
      const path = join(directory, entry)
      const session = await readSession(path)
      items.push({
        id: session?.id ?? entry,
        path,
        status: session?.status ?? (archived ? 'archived' : 'legacy'),
        title: session?.title ?? null,
        branch: session?.branch ?? (session ? null : entry.replace(/__/g, '/')),
        current: currentId === (session?.id ?? entry),
      })
    }
  }
  return items
}

async function runDevSessionListQuiet(paths: DdevPaths): Promise<DevSessionListItem[]> {
  const roots = [paths.repoStateRoot, paths.legacyGlobalRepoStateRoot].filter(
    (path): path is string => Boolean(path),
  )
  const items: DevSessionListItem[] = []
  for (const root of roots) items.push(...await listRootSessions(root, null))
  return items
}

async function readDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return []
    /* v8 ignore next -- unexpected readdir errors should surface unchanged */
    throw error
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : {}
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return {}
    /* v8 ignore next -- malformed JSON and unexpected read errors should surface unchanged */
    throw error
  }
}

function createSessionId(title: string, at: Date): string {
  const timestamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task'
  return `${slug}-${timestamp}-${randomBytes(3).toString('hex')}`
}

function requireTitle(value: string | undefined): string {
  const title = value?.trim()
  if (!title) throw new Error('DDev session title is required. Pass --title "...".')
  if (title.length > 120) throw new Error('DDev session title must be 120 characters or fewer.')
  return title
}

function assertSafeId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value)) {
    throw new Error(`Invalid DDev session id: ${value}`)
  }
  return value
}

function cleanPlan(target: string) {
  console.log(`DDev clean target: ${target}`)
  return { target, removed: false, dryRun: true }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    /* v8 ignore next -- unexpected stat errors should surface unchanged */
    throw error
  }
}

function isSession(value: unknown): value is DevSession {
  if (!isRecord(value)) return false
  return value.schema_version === 1
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.repo_id === 'string'
    && typeof value.repo_root === 'string'
    && typeof value.branch === 'string'
    && (value.head_sha === null || typeof value.head_sha === 'string')
    && (value.status === 'active' || value.status === 'closed' || value.status === 'archived')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
