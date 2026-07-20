import {
  createReadStream,
} from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import type {
  DevCleanResult,
  DevDemoResult,
  DevDoctorCheck,
  DevDoctorResult,
  DevFlags,
  DevInstallResult,
  DevUninstallResult,
  DevStatusResult,
} from './types.ts'

const execFileAsync = promisify(execFile)
const DDEV_VERSION = '0.2.0'
const LEGACY_DDEV_EXCLUDE_LINE = '.deweyou/dev/'
const CODEX_HOOKS_PATH = '.codex/hooks.json'
const MODULE_SKILLS = [
  'problem-framing',
  'product-design',
  'ui-design',
  'spec-driven-coding',
  'git-delivery',
  'repo-memory',
] as const
const SESSION_FILES: Record<string, string> = {
  'task.md': '# Task\n\n- Goal:\n- Current branch:\n- Status:\n',
  'brainstorm.md': '# Brainstorm\n\n## Frame\n\n## Options\n\n## Tradeoffs\n\n## Recommendation\n',
  'context.md': '# Context\n\n## Repository\n\n## Relevant Files\n\n## Constraints\n',
  'graph.md': '# Graph\n\n- [ ] Understand request\n- [ ] Edit focused files\n- [ ] Verify behavior\n- [ ] Summarize outcome\n',
  'decisions.md': '# Decisions\n\n',
  'verification.md': '# Verification\n\n',
  'evidence.md': '# Evidence\n\n## Claims\n\n## Evidence\n\n',
  'demo.md': '# Demo\n\n- Path: demo/index.html\n- URL:\n- Evidence:\n',
  'retrospective.md': '# Retrospective\n\n',
  'events.jsonl': '',
}

export async function runDevInstall(
  flags: DevFlags = {},
): Promise<DevInstallResult> {
  const paths = devPaths(flags)
  const dryRun = flags.dryRun === true
  const branch = flags.branch ?? await currentBranch(paths.repoRoot)
  const sessionPath = sessionPathFor(paths.repoStateRoot, branch)

  if (dryRun) {
    console.log('DDev Install Plan')
    console.log(`Runtime: ${paths.runtimeRoot}`)
    console.log(`Repo state: ${paths.repoStateRoot}`)
    console.log(`Session: ${sessionPath}`)
    console.log(`Config: ${paths.configPath}`)
    console.log('Repository writes: none')
    console.log('Activation: manual')
    console.log(`Module skills: ${moduleSkillRoot(paths)}`)
    console.log(`Codex hooks: remove old DDev passive hooks from ${paths.codexHooksPath}`)
    return {
      runtimeRoot: paths.runtimeRoot,
      repoStateRoot: paths.repoStateRoot,
      configPath: paths.configPath,
      sessionPath,
      codexHooksPath: paths.codexHooksPath,
      moduleSkills: moduleSkillPaths(paths),
      dryRun,
      exclude: 'not needed: global state only',
      hooks: 'manual activation; not installed',
      codexHooks: 'dry-run',
    }
  }

  await mkdir(paths.runtimeRoot, { recursive: true })
  await writeRuntimeConfig(paths)
  await writeRepoConfig(paths)
  await ensureSession(paths.repoStateRoot, branch)

  const codexHooks = await removeDdevCodexHooks(paths)

  console.log('DDev installed')
  console.log(`Runtime: ${paths.runtimeRoot}`)
  console.log(`Repo state: ${paths.repoStateRoot}`)
  console.log(`Session: ${sessionPath}`)
  console.log('Repository writes: none')
  console.log('Activation: manual')
  console.log('Hooks: not installed')
  console.log(`Module skills: ${moduleSkillRoot(paths)}`)
  console.log(`Codex hooks: ${codexHooks}`)

  return {
    runtimeRoot: paths.runtimeRoot,
    repoStateRoot: paths.repoStateRoot,
    configPath: paths.configPath,
    sessionPath,
    codexHooksPath: paths.codexHooksPath,
    moduleSkills: moduleSkillPaths(paths),
    dryRun,
    exclude: 'not needed: global state only',
    hooks: 'manual activation; not installed',
    codexHooks,
  }
}

export async function runDevStatus(
  flags: DevFlags = {},
): Promise<DevStatusResult> {
  const result = await resolveDevStatus(flags)

  console.log('DDev Status')
  console.log(`Runtime: ${result.runtimeRoot} (${existsLabel(result.runtimeExists)})`)
  console.log(`Repo state: ${result.repoStateRoot} (${existsLabel(result.repoStateExists)})`)
  console.log(`Branch: ${result.branch}`)
  console.log(`Session: ${result.sessionPath} (${existsLabel(result.sessionExists)})`)

  return result
}

export async function runDevDoctor(
  flags: DevFlags = {},
): Promise<DevDoctorResult> {
  const paths = devPaths(flags)
  const branch = flags.branch ?? await currentBranch(paths.repoRoot)
  const checks: DevDoctorCheck[] = []

  checks.push(
    await pathExists(paths.runtimeRoot)
      ? pass(`runtime root exists: ${paths.runtimeRoot}`)
      : fail(`runtime root is missing: ${paths.runtimeRoot}. Run \`deweyou-cli dev install\`.`),
  )
  checks.push(...await checkModuleSkills(paths))
  checks.push(
    await pathExists(paths.repoStateRoot)
      ? pass(`global repo DDev state exists: ${paths.repoStateRoot}`)
      : warn(`global repo DDev state is not created yet: ${paths.repoStateRoot}`),
  )
  checks.push(await checkSessionFiles(paths.repoStateRoot, branch))
  checks.push(...await checkLegacyRepoState(paths))
  checks.push(...await checkCodexHooks(paths))

  for (const check of checks) {
    console.log(`${check.status.toUpperCase()} ${check.message}`)
  }

  const result = {
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
  }

  if (!result.ok) process.exitCode = 1

  return result
}

export async function runDevClean(
  flags: DevFlags = {},
): Promise<DevCleanResult> {
  const paths = devPaths(flags)
  const dryRun = flags.dryRun === true
  const target = flags.all
    ? paths.repoStateRoot
    : join(paths.repoStateRoot, 'sessions', sessionName(flags.branch ?? await currentBranch(paths.repoRoot)))
  const exists = await pathExists(target)

  if (dryRun) {
    console.log(`DDev clean target: ${target}`)
    return { target, removed: false, dryRun }
  }

  if (!exists) {
    console.log(`Nothing to clean: ${target}`)
    return { target, removed: false, dryRun }
  }

  await rm(target, { recursive: true, force: true })
  console.log(`Removed DDev state: ${target}`)

  return { target, removed: true, dryRun }
}

export async function runDevUninstall(
  flags: DevFlags = {},
): Promise<DevUninstallResult> {
  const paths = devPaths(flags)
  const dryRun = flags.dryRun === true
  const runtimeExists = await pathExists(paths.runtimeRoot)
  const repoStateExists = await pathExists(paths.repoStateRoot)

  if (dryRun) {
    console.log('DDev Uninstall Plan')
    console.log(`Runtime: remove only if no other repo state remains (${paths.runtimeRoot})`)
    console.log(`Repo state: ${paths.repoStateRoot}`)
    console.log(`Legacy repo state: remove ${paths.legacyRepoStateRoot}`)
    console.log(`Legacy git exclude: remove ${LEGACY_DDEV_EXCLUDE_LINE}`)
    console.log(`Codex hooks: remove old DDev passive hooks from ${paths.codexHooksPath}`)
    return {
      runtimeRoot: paths.runtimeRoot,
      repoStateRoot: paths.repoStateRoot,
      dryRun,
      runtimeRemoved: false,
      repoStateRemoved: false,
      exclude: 'dry-run',
      codexHooks: 'dry-run',
    }
  }

  const codexHooks = await removeDdevCodexHooks(paths)
  const exclude = await removeGitExclude(paths.repoRoot)
  const legacyRepoStateExists = await pathExists(paths.legacyRepoStateRoot)

  if (repoStateExists) await rm(paths.repoStateRoot, { recursive: true, force: true })
  if (legacyRepoStateExists) await rm(paths.legacyRepoStateRoot, { recursive: true, force: true })
  const runtimeRemoved = await removeRuntimeIfUnused(paths)

  console.log('DDev uninstalled')
  console.log(`Runtime: ${runtimeRemoved ? 'removed' : runtimeExists ? 'kept' : 'not present'} (${paths.runtimeRoot})`)
  console.log(`Repo state: ${repoStateExists ? 'removed' : 'not present'} (${paths.repoStateRoot})`)
  console.log(`Legacy repo state: ${legacyRepoStateExists ? 'removed' : 'not present'} (${paths.legacyRepoStateRoot})`)
  console.log(`Legacy git exclude: ${exclude}`)
  console.log(`Codex hooks: ${codexHooks}`)

  return {
    runtimeRoot: paths.runtimeRoot,
    repoStateRoot: paths.repoStateRoot,
    dryRun,
    runtimeRemoved,
    repoStateRemoved: repoStateExists,
    exclude,
    codexHooks,
  }
}

export async function runDevDemo(
  flags: DevFlags = {},
): Promise<DevDemoResult> {
  const paths = devPaths(flags)
  const dryRun = flags.dryRun === true
  const branch = flags.branch ?? await currentBranch(paths.repoRoot)
  const sessionPath = sessionPathFor(paths.repoStateRoot, branch)
  const demoRoot = join(sessionPath, 'demo')
  const indexPath = join(demoRoot, 'index.html')
  const host = flags.host ?? '127.0.0.1'
  const port = parsePort(flags.port)

  if (dryRun) {
    console.log('DDev Demo Plan')
    console.log(`Demo root: ${demoRoot}`)
    console.log(`Index: ${indexPath}`)
    console.log(`URL: http://${host}:${port}/`)
    return { demoRoot, indexPath, url: null, served: false, dryRun }
  }

  await ensureSession(paths.repoStateRoot, branch)
  await ensureDemoFile(demoRoot, indexPath, branch)

  if (flags.noServer === true) {
    console.log(`DDev demo ready: ${indexPath}`)
    return { demoRoot, indexPath, url: null, served: false, dryRun }
  }

  const server = await startDemoServer(demoRoot, host, port)
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}/`

  console.log(`DDev demo serving: ${demoRoot}`)
  console.log(`URL: ${url}`)
  console.log('Press Ctrl+C to stop.')

  if (flags.once === true) {
    await closeServer(server)
    return { demoRoot, indexPath, url, served: true, dryRun }
  }

  await waitForServerClose(server)
  return { demoRoot, indexPath, url, served: true, dryRun }
}

async function resolveDevStatus(flags: DevFlags): Promise<DevStatusResult> {
  const paths = devPaths(flags)
  const branch = flags.branch ?? await currentBranch(paths.repoRoot)
  const sessionPath = sessionPathFor(paths.repoStateRoot, branch)

  return {
    runtimeRoot: paths.runtimeRoot,
    repoStateRoot: paths.repoStateRoot,
    branch,
    sessionPath,
    runtimeExists: await pathExists(paths.runtimeRoot),
    repoStateExists: await pathExists(paths.repoStateRoot),
    sessionExists: await pathExists(sessionPath),
  }
}

function devPaths(flags: DevFlags) {
  const repoRoot = resolve(flags.repoRoot ?? process.cwd())
  const homeDir = flags.homeDir ?? homedir()
  const runtimeRoot = join(homeDir, '.deweyou', 'dev')
  const repoId = repoStateId(repoRoot)
  const repoStateContainer = join(runtimeRoot, 'repos')
  const repoStateRoot = join(repoStateContainer, repoId)

  return {
    repoRoot,
    homeDir,
    runtimeRoot,
    repoId,
    repoStateContainer,
    repoStateRoot,
    legacyRepoStateRoot: join(repoRoot, '.deweyou', 'dev'),
    configPath: join(runtimeRoot, 'config.json'),
    codexHooksPath: join(homeDir, CODEX_HOOKS_PATH),
  }
}

function repoStateId(repoRoot: string): string {
  const name = basename(repoRoot).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'
  const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 10)
  return `${name}-${hash}`
}

async function writeRuntimeConfig(paths: ReturnType<typeof devPaths>): Promise<void> {
  const current = await readJsonObject(paths.configPath)
  const next: Record<string, unknown> = {
    ...current,
    version: DDEV_VERSION,
    activation: 'manual',
    passiveHooks: false,
    stateLocation: 'global',
    stateRoot: paths.repoStateContainer,
    moduleSkillRoot: moduleSkillRoot(paths),
    moduleSkills: moduleSkillPaths(paths),
    moduleRefreshCommand: 'deweyou-cli agent update',
    sessionFiles: Object.keys(SESSION_FILES),
  }
  delete next.hooks
  await writeJsonIfChanged(paths.configPath, current, next)
}

async function writeRepoConfig(paths: ReturnType<typeof devPaths>): Promise<void> {
  const path = join(paths.repoStateRoot, 'config.json')
  const current = await readJsonObject(path)
  const next: Record<string, unknown> = {
    ...current,
    version: DDEV_VERSION,
    activation: 'manual',
    passiveHooks: false,
    entrySkill: 'ddev',
    moduleSkillResolution: 'global-dewey-cache',
    repoRoot: paths.repoRoot,
    repoId: paths.repoId,
    sessionFiles: Object.keys(SESSION_FILES),
  }
  delete next.hooks
  await writeJsonIfChanged(path, current, next)
}

function moduleSkillRoot(paths: ReturnType<typeof devPaths>): string {
  return join(paths.homeDir, '.deweyou', 'agents', 'assets', 'skills')
}

function moduleSkillPaths(paths: ReturnType<typeof devPaths>): Record<string, string> {
  return Object.fromEntries(
    MODULE_SKILLS.map((name) => [
      name,
      join(moduleSkillRoot(paths), name, 'SKILL.md'),
    ]),
  )
}

async function ensureSession(repoStateRoot: string, branch: string): Promise<string> {
  const directory = sessionPathFor(repoStateRoot, branch)
  await mkdir(directory, { recursive: true })
  await Promise.all(
    Object.entries(SESSION_FILES).map(async ([file, content]) => {
      const path = join(directory, file)
      if (await pathExists(path)) return
      await writeFile(path, content, 'utf8')
    }),
  )
  return directory
}

async function ensureDemoFile(
  demoRoot: string,
  indexPath: string,
  branch: string,
): Promise<void> {
  await mkdir(demoRoot, { recursive: true })
  if (await pathExists(indexPath)) return
  await writeFile(indexPath, defaultDemoHtml(branch), 'utf8')
}

export async function startDemoServer(
  demoRoot: string,
  host: string,
  port: number,
): Promise<Server> {
  const root = resolve(demoRoot)
  const server = createServer(async (request, response) => {
    /* v8 ignore next 4 -- Node HTTP requests always provide a URL in normal use */
    if (!request.url) {
      response.writeHead(400)
      response.end('Bad request')
      return
    }

    const filePath = resolveRequestPath(root, request.url)
    if (!filePath) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        response.writeHead(404)
        response.end('Not found')
        return
      }

      response.writeHead(200, { 'content-type': mimeType(filePath) })
      createReadStream(filePath).pipe(response)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      response.writeHead(500)
      response.end('Server error')
    }
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  return server
}

function resolveRequestPath(root: string, url: string): string | null {
  const parsed = new URL(url, 'http://localhost')
  const pathname = decodeURIComponent(parsed.pathname)
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const target = resolve(root, relativePath)
  const isInsideRoot = target === root || target.startsWith(`${root}${sep}`)
  return isInsideRoot ? target : null
}

function mimeType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

function parsePort(value: string | number | undefined): number {
  if (value === undefined) return 4173
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      /* v8 ignore next 4 -- Node only passes close errors for unusual server states */
      if (error) {
        rejectClose(error)
        return
      }
      resolveClose()
    })
  })
}

async function waitForServerClose(server: Server): Promise<void> {
  await new Promise<void>((resolveClose) => {
    server.on('close', resolveClose)
  })
}

async function removeGitExclude(repoRoot: string): Promise<string> {
  const excludePath = await gitPath(repoRoot, 'info/exclude')
  if (!excludePath) return 'skipped: not a git repository'

  const current = await readText(excludePath)
  if (!current) return 'not present'

  const lines = current.split(/\r?\n/)
  const filtered = lines.filter((line) =>
    line !== LEGACY_DDEV_EXCLUDE_LINE,
  )
  if (filtered.length === lines.length) return 'not present'

  let next = filtered.join('\n')
  if (next && !next.endsWith('\n')) next += '\n'
  await writeFile(excludePath, next, 'utf8')
  return 'removed'
}

async function removeRuntimeIfUnused(paths: ReturnType<typeof devPaths>): Promise<boolean> {
  if (!await pathExists(paths.runtimeRoot)) return false

  const remainingRepoStates = await directoryEntries(paths.repoStateContainer)
  if (remainingRepoStates.length > 0) return false

  await rm(paths.runtimeRoot, { recursive: true, force: true })
  return true
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    /* v8 ignore next -- unexpected readdir errors should surface unchanged */
    throw error
  }
}

async function checkLegacyRepoState(paths: ReturnType<typeof devPaths>): Promise<DevDoctorCheck[]> {
  const checks: DevDoctorCheck[] = []
  checks.push(
    await pathExists(paths.legacyRepoStateRoot)
      ? warn(`legacy repo-local DDev state exists: ${paths.legacyRepoStateRoot}. Run \`deweyou-cli dev uninstall\` to remove it.`)
      : pass(`legacy repo-local DDev state is absent: ${paths.legacyRepoStateRoot}`),
  )

  const excludePath = await gitPath(paths.repoRoot, 'info/exclude')
  if (!excludePath) return checks

  const current = await readText(excludePath)
  const lines = current.split(/\r?\n/)
  checks.push(
    lines.includes(LEGACY_DDEV_EXCLUDE_LINE)
      ? warn(`legacy git exclude contains ${LEGACY_DDEV_EXCLUDE_LINE}. Run \`deweyou-cli dev uninstall\` to remove it.`)
      : pass(`legacy git exclude is absent: ${LEGACY_DDEV_EXCLUDE_LINE}`),
  )

  return checks
}

async function checkSessionFiles(repoStateRoot: string, branch: string): Promise<DevDoctorCheck> {
  const directory = sessionPathFor(repoStateRoot, branch)
  if (!await pathExists(directory)) {
    return warn(`current branch session is missing: ${directory}`)
  }

  const missing: string[] = []
  for (const file of Object.keys(SESSION_FILES)) {
    if (!await pathExists(join(directory, file))) missing.push(file)
  }

  return missing.length === 0
    ? pass(`current branch session files exist: ${directory}`)
    : warn(`current branch session is missing files: ${missing.join(', ')}`)
}

async function checkModuleSkills(paths: ReturnType<typeof devPaths>): Promise<DevDoctorCheck[]> {
  const root = moduleSkillRoot(paths)
  if (!await pathExists(root)) {
    return [
      fail(`global DDev module skill cache is missing: ${root}. Run \`deweyou-cli agent update\`.`),
    ]
  }

  const missing: string[] = []
  for (const [name, skillPath] of Object.entries(moduleSkillPaths(paths))) {
    if (!await pathExists(skillPath)) missing.push(`${name} (${skillPath})`)
  }

  return missing.length === 0
    ? [pass(`global DDev module skills are available: ${root}`)]
    : [fail(`global DDev module skills are missing: ${missing.join(', ')}. Run \`deweyou-cli agent update\`.`)]
}

async function checkCodexHooks(paths: ReturnType<typeof devPaths>): Promise<DevDoctorCheck[]> {
  const hooks = await readCodexHooks(paths.codexHooksPath)
  if (!hooks) return [pass(`DDev passive hooks are absent: ${paths.codexHooksPath}`)]

  const entries = hookEntries(hooks)
  const ddev = entries.filter((entry) => isDdevHook(entry.command, paths.runtimeRoot))

  return [
    ddev.length === 0
      ? pass('DDev passive hooks are absent')
      : warn(`DDev passive hooks are still installed: ${ddev.map((entry) => entry.event).join(', ')}. Run \`deweyou-cli dev uninstall\`.`),
  ]
}

async function removeDdevCodexHooks(paths: ReturnType<typeof devPaths>): Promise<string> {
  const before = await readCodexHooks(paths.codexHooksPath)
  if (!before) return 'skipped: no readable Codex hooks file'
  if (!isRecord(before)) return 'skipped: Codex hooks file is not an object'

  const after = structuredClone(before)
  const hooks = isRecord(after.hooks) ? after.hooks : {}
  after.hooks = hooks
  const removed = removeDdevHooks(hooks, paths.runtimeRoot)

  if (removed === 0) return 'not present'

  await mkdir(dirname(paths.codexHooksPath), { recursive: true })
  await copyFile(paths.codexHooksPath, `${paths.codexHooksPath}.bak`)
  await writeJson(paths.codexHooksPath, after)

  return `removed ${removed} DDev passive hook(s)`
}

function removeDdevHooks(hooks: Record<string, unknown>, runtimeRoot: string): number {
  let removed = 0

  for (const [event, blocks] of Object.entries(hooks)) {
    if (!Array.isArray(blocks)) continue
    const nextBlocks: unknown[] = []

    for (const block of blocks) {
      if (!isRecord(block) || !Array.isArray(block.hooks)) {
        nextBlocks.push(block)
        continue
      }

      const nextHooks = block.hooks.filter((hook) => {
        if (!isRecord(hook) || typeof hook.command !== 'string') return true
        const shouldRemove = isDdevHook(hook.command, runtimeRoot)
        if (shouldRemove) removed += 1
        return !shouldRemove
      })

      if (nextHooks.length > 0) nextBlocks.push({ ...block, hooks: nextHooks })
    }

    if (nextBlocks.length > 0) {
      hooks[event] = nextBlocks
    } else {
      delete hooks[event]
    }
  }

  return removed
}

function hookEntries(codexHooks: unknown): Array<{ event: string, command: string }> {
  if (!isRecord(codexHooks) || !isRecord(codexHooks.hooks)) return []
  const entries: Array<{ event: string, command: string }> = []

  for (const [event, blocks] of Object.entries(codexHooks.hooks)) {
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (!isRecord(block) || !Array.isArray(block.hooks)) continue
      for (const hook of block.hooks) {
        if (isRecord(hook) && typeof hook.command === 'string') {
          entries.push({ event, command: hook.command })
        }
      }
    }
  }

  return entries
}

function isDdevHook(command: string, runtimeRoot: string): boolean {
  return (command.includes(runtimeRoot) && command.includes('/hooks/'))
    || command.includes('.deweyou/dev/hooks/')
}

async function readCodexHooks(path: string): Promise<unknown | null> {
  const text = await readText(path)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function gitPath(repoRoot: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'rev-parse',
      '--git-path',
      path,
    ])
    const resolved = stdout.trim()
    if (!resolved) return null
    return resolve(repoRoot, resolved)
  } catch {
    return null
  }
}

async function currentBranch(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ])
    const branch = stdout.trim()
    return branch && branch !== 'HEAD' ? branch : 'detached'
  } catch {
    return 'unknown'
  }
}

function sessionPathFor(repoStateRoot: string, branch: string): string {
  return join(repoStateRoot, 'sessions', sessionName(branch))
}

function sessionName(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '__')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') return false
    /* v8 ignore next -- non-missing stat errors should surface unchanged */
    throw error
  }
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') return ''
    /* v8 ignore next -- non-missing read errors should surface unchanged */
    throw error
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path)
  if (!text) return {}
  try {
    const value = JSON.parse(text)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

async function writeJsonIfChanged(
  path: string,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Promise<void> {
  if (JSON.stringify(current) === JSON.stringify(next)) return
  await writeJson(path, next)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function existsLabel(exists: boolean): string {
  return exists ? 'present' : 'missing'
}

function pass(message: string): DevDoctorCheck {
  return { status: 'pass', message }
}

function warn(message: string): DevDoctorCheck {
  return { status: 'warn', message }
}

function fail(message: string): DevDoctorCheck {
  return { status: 'fail', message }
}

function defaultDemoHtml(branch: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DDev Demo</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f5f1;
      color: #1f2933;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(135deg, rgba(32, 90, 118, 0.12), transparent 34%),
        linear-gradient(315deg, rgba(154, 85, 64, 0.12), transparent 38%),
        #f6f5f1;
    }

    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 48px 0;
    }

    header {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 28px;
      align-items: end;
      min-height: 260px;
    }

    h1 {
      max-width: 760px;
      margin: 0;
      font-size: 72px;
      line-height: 0.94;
      letter-spacing: 0;
    }

    .panel {
      border: 1px solid rgba(31, 41, 51, 0.14);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: 0 24px 60px rgba(31, 41, 51, 0.08);
      padding: 22px;
    }

    .label {
      margin: 0 0 12px;
      color: #59636e;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .summary {
      margin: 0;
      color: #334150;
      font-size: 18px;
      line-height: 1.5;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-top: 34px;
    }

    .card {
      min-height: 176px;
      border: 1px solid rgba(31, 41, 51, 0.12);
      border-radius: 8px;
      background: #ffffff;
      padding: 20px;
    }

    .card strong {
      display: block;
      margin-bottom: 10px;
      font-size: 18px;
    }

    .card p {
      margin: 0;
      color: #59636e;
      line-height: 1.5;
    }

    .stage {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 14px;
    }

    .preview {
      min-height: 240px;
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(31, 41, 51, 0.94), rgba(32, 90, 118, 0.86)),
        #1f2933;
      color: #ffffff;
      padding: 24px;
    }

    .preview h2 {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0;
    }

    .preview p {
      max-width: 440px;
      color: rgba(255, 255, 255, 0.78);
      line-height: 1.5;
    }

    @media (max-width: 800px) {
      main {
        width: min(100vw - 24px, 640px);
        padding: 28px 0;
      }

      header,
      .grid,
      .stage {
        grid-template-columns: 1fr;
      }

      h1 {
        font-size: 48px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="label">DDev branch ${escapeHtml(branch)}</p>
        <h1>Demo sketch</h1>
      </div>
      <section class="panel">
        <p class="label">Concept</p>
        <p class="summary">A local canvas for turning a brainstorm into something visible before touching product code.</p>
      </section>
    </header>

    <section class="grid" aria-label="Idea options">
      <article class="card">
        <strong>Option A</strong>
        <p>Replace this card with the strongest conservative direction.</p>
      </article>
      <article class="card">
        <strong>Option B</strong>
        <p>Use this card for the sharper or more opinionated alternative.</p>
      </article>
      <article class="card">
        <strong>Option C</strong>
        <p>Use this card for the risky bet, edge case, or future version.</p>
      </article>
    </section>

    <section class="stage" aria-label="Demo stage">
      <div class="preview">
        <h2>Primary moment</h2>
        <p>Turn the selected direction into a concrete screen, state, interaction, or artifact here.</p>
      </div>
      <div class="panel">
        <p class="label">Evidence</p>
        <p class="summary">When this demo proves or disproves an idea, record the claim and evidence in evidence.md.</p>
      </div>
    </section>
  </main>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
