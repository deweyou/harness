import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  assertDdevCompatibility,
  loadDdevManifest,
  type DdevManifest,
} from '../src/cli/dev-manifest.ts'
import { cachePaths, updateCache } from '../src/cli/cache.ts'
import { legacySessionPath, resolveDdevPaths } from '../src/cli/dev-paths.ts'
import {
  assertRuntimeReady,
  resolveOperationalSession,
  runDevSessionArchive,
  runDevSessionClean,
  runDevSessionClose,
  runDevSessionList,
  runDevSessionStart,
  runDevSessionStatus,
} from '../src/cli/dev-session.ts'
import { runDevInstall, runDevRecord } from '../src/cli/dev.ts'
import { main } from '../src/cli/main.ts'
import { CLI_VERSION } from '../src/cli/version-contract.ts'
import {
  appendFileLocked,
  ensurePrivateFile,
  readTextLimited,
  writeFileAtomic,
} from '../src/cli/safe-io.ts'

const MODULE_SKILLS = [
  'problem-framing',
  'product-design',
  'ui-design',
  'spec-driven-coding',
  'git-delivery',
  'repo-memory',
]
const CAPABILITIES = [
  'agent:update',
  'cli:update',
  'ddev:event-schema@1',
  'ddev:runtime-schema@1',
  'ddev:task-sessions',
]

describe('DDev runtime hardening', () => {
  it('does not initialize a runtime with missing required rules', async () => {
    const { homeDir, repoRoot } = await tempRepo('missing-required-rule')
    for (const skill of MODULE_SKILLS) {
      const directory = join(homeDir, '.deweyou/agents/assets/skills', skill)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), `# ${skill}\n`)
    }
    const ddevDirectory = join(homeDir, '.deweyou/agents/assets/skills/ddev')
    await mkdir(ddevDirectory, { recursive: true })
    await writeFile(join(ddevDirectory, 'runtime.json'), JSON.stringify(manifest()))

    await assert.rejects(
      () => runDevInstall({ homeDir, repoRoot }),
      /required rule is missing/,
    )
    await assert.rejects(() => stat(join(homeDir, '.deweyou/dev')), { code: 'ENOENT' })
  })

  it('rejects unreadable, malformed, outdated, and unsupported runtime manifests', async () => {
    const { homeDir } = await tempRepo('manifest-errors')
    const manifestPath = join(homeDir, '.deweyou/agents/assets/skills/ddev/runtime.json')
    await mkdir(join(manifestPath, '..'), { recursive: true })

    await writeFile(manifestPath, '{')
    await assert.rejects(() => loadDdevManifest(homeDir), /manifest is unavailable/)

    const valid = manifest()
    const invalidValues = [
      null,
      [],
      { ...valid, schema_version: '1' },
      { ...valid, runtime_schema: '1' },
      { ...valid, event_schema: '1' },
      { ...valid, minimum_cli_version: 1 },
      { ...valid, required_cli_capabilities: [''] },
      { ...valid, module_skills: [1] },
      { ...valid, required_rules: null },
      { ...valid, session_files: 'session.json' },
    ]
    for (const value of invalidValues) {
      await writeFile(manifestPath, JSON.stringify(value))
      await assert.rejects(() => loadDdevManifest(homeDir), /manifest is invalid/)
    }

    const futureCliVersion =
      `${Number(CLI_VERSION.split('.')[0]) + 1}.0.0`
    assert.throws(
      () => assertDdevCompatibility({
        ...valid,
        minimum_cli_version: futureCliVersion,
      }),
      new RegExp(`requires deweyou-cli >= ${futureCliVersion}`),
    )
    assert.throws(
      () => assertDdevCompatibility({
        ...valid,
        required_cli_capabilities: [...CAPABILITIES, 'future:capability'],
      }),
      /future:capability/,
    )
    assert.doesNotThrow(() => assertDdevCompatibility({
      ...valid,
      minimum_cli_version: '1.3',
    }))
  })

  it('handles empty, missing, invalid, and legacy session selections explicitly', async () => {
    const { homeDir, repoRoot } = await installedRepo('session-selection')
    assert.deepEqual((await runDevSessionList({ homeDir, repoRoot })).sessions, [])
    assert.equal(await runDevSessionStatus({ homeDir, repoRoot }), null)
    assert.equal(await runDevSessionStatus({ homeDir, repoRoot, id: 'missing' }), null)
    await assert.rejects(
      () => resolveOperationalSession({ homeDir, repoRoot }),
      /No active DDev task session/,
    )
    await assert.rejects(
      () => runDevSessionStart({ homeDir, repoRoot }),
      /title is required/,
    )
    await assert.rejects(
      () => runDevSessionStart({ homeDir, repoRoot, title: 'x'.repeat(121) }),
      /120 characters or fewer/,
    )
    await assert.rejects(
      () => runDevSessionStatus({ homeDir, repoRoot, id: '../unsafe' }),
      /Invalid DDev session id/,
    )

    const paths = await resolveDdevPaths({ homeDir, repoRoot })
    await assert.rejects(
      () => resolveOperationalSession({ homeDir, repoRoot, branch: 'feature/old' }),
      /Legacy DDev branch session is missing/,
    )
    const legacyPath = legacySessionPath(paths.repoStateRoot, 'feature/old')
    await mkdir(legacyPath, { recursive: true })
    const legacy = await resolveOperationalSession({
      homeDir,
      repoRoot,
      branch: 'feature/old',
    })
    assert.equal(legacy.legacy, true)
    await assert.rejects(
      () => runDevSessionClose({ homeDir, repoRoot, id: 'feature__old' }),
      /has no managed lifecycle metadata/,
    )
  })

  it('enforces lifecycle transitions and clean safety for one or all sessions', async () => {
    const { homeDir, repoRoot } = await installedRepo('session-transitions')
    const started = await runDevSessionStart({ homeDir, repoRoot, title: 'Transitions' })

    await assert.rejects(
      () => runDevSessionArchive({ homeDir, repoRoot }),
      /must be closed/,
    )
    await assert.rejects(
      () => runDevSessionClean({ homeDir, repoRoot, all: true, dryRun: true }),
      /Close active DDev sessions/,
    )
    await runDevSessionClose({ homeDir, repoRoot })
    await assert.rejects(
      () => runDevSessionClose({ homeDir, repoRoot }),
      /not active/,
    )
    await assert.rejects(
      () => resolveOperationalSession({ homeDir, repoRoot }),
      /not active/,
    )
    assert.equal((await resolveOperationalSession(
      { homeDir, repoRoot },
      { allowClosed: true },
    )).id, started.session.id)

    const dryRun = await runDevSessionClean({ homeDir, repoRoot, all: true, dryRun: true })
    assert.equal(dryRun.dryRun, true)
    assert.equal(dryRun.removed, false)
    const cleaned = await runDevSessionClean({ homeDir, repoRoot, all: true, force: true })
    assert.equal(cleaned.removed, true)
    const empty = await runDevSessionClean({ homeDir, repoRoot, all: true, force: true })
    assert.equal(empty.removed, false)
    await assert.rejects(
      () => runDevSessionClean({ homeDir, repoRoot, force: true }),
      /No DDev session selected/,
    )
    const missingDryRun = await runDevSessionClean({
      homeDir,
      repoRoot,
      id: 'missing',
      dryRun: true,
    })
    assert.equal(missingDryRun.removed, false)
    const missing = await runDevSessionClean({
      homeDir,
      repoRoot,
      id: 'missing',
      force: true,
    })
    assert.equal(missing.removed, false)
  })

  it('refuses incompatible initialized runtimes and missing module skills', async () => {
    const { homeDir, repoRoot } = await installedRepo('runtime-errors')
    const paths = await resolveDdevPaths({ homeDir, repoRoot })
    const runtimeConfig = JSON.parse(await readFile(paths.configPath, 'utf8'))
    const repoConfigPath = join(paths.repoStateRoot, 'config.json')
    const repoConfig = JSON.parse(await readFile(repoConfigPath, 'utf8'))

    await writeFile(paths.configPath, JSON.stringify({ ...runtimeConfig, runtimeSchema: 2 }))
    await assert.rejects(() => assertRuntimeReady(paths), /not initialized or is incompatible/)
    await writeFile(paths.configPath, JSON.stringify({ ...runtimeConfig, cliVersion: '1.2.0' }))
    await assert.rejects(() => assertRuntimeReady(paths), /initialized by CLI 1.2.0/)
    await writeFile(paths.configPath, JSON.stringify(runtimeConfig))
    await writeFile(repoConfigPath, JSON.stringify({ ...repoConfig, runtimeSchema: 2 }))
    await assert.rejects(() => assertRuntimeReady(paths), /not initialized or is incompatible/)
    await writeFile(repoConfigPath, JSON.stringify(repoConfig))

    await writeFile(paths.configPath, '[]')
    await assert.rejects(() => assertRuntimeReady(paths), /not initialized or is incompatible/)
    await rm(paths.configPath)
    await assert.rejects(() => assertRuntimeReady(paths), /not initialized or is incompatible/)
    await writeFile(paths.configPath, JSON.stringify(runtimeConfig))

    const skillPath = join(homeDir, '.deweyou/agents/assets/skills/problem-framing/SKILL.md')
    await writeFile(skillPath, '')
    await stat(skillPath)
    await rm(skillPath)
    await assert.rejects(() => assertRuntimeReady(paths), /module skill is missing/)
    await writeFile(skillPath, '# problem-framing\n')
    const rulePath = join(homeDir, '.deweyou/agents/assets/rules/code-style.md')
    await rm(rulePath)
    await assert.rejects(() => assertRuntimeReady(paths), /required rule is missing/)
  })

  it('rejects corrupt managed metadata and ignores invalid checkout pointers', async () => {
    const { homeDir, repoRoot } = await installedRepo('corrupt-state')
    const paths = await resolveDdevPaths({ homeDir, repoRoot })
    await mkdir(join(paths.repoStateRoot, 'sessions', 'broken'), { recursive: true })
    await writeFile(join(paths.repoStateRoot, 'sessions', 'broken', 'session.json'), '{}')
    await assert.rejects(
      () => runDevSessionStatus({ homeDir, repoRoot, id: 'broken' }),
      /Invalid DDev session metadata/,
    )

    await mkdir(join(paths.checkoutPointerPath, '..'), { recursive: true })
    await writeFile(paths.checkoutPointerPath, '{}')
    assert.equal(await runDevSessionStatus({ homeDir, repoRoot }), null)

    await writeFile(paths.checkoutPointerPath, '{')
    await assert.rejects(
      () => runDevSessionStatus({ homeDir, repoRoot }),
      /JSON/,
    )
  })

  it('validates every managed session metadata field', async () => {
    const { homeDir, repoRoot } = await installedRepo('metadata-fields')
    const paths = await resolveDdevPaths({ homeDir, repoRoot })
    const started = await runDevSessionStart({ homeDir, repoRoot, title: 'Metadata' })
    const valid = JSON.parse(await readFile(join(started.sessionPath, 'session.json'), 'utf8'))
    const invalidValues = [
      null,
      [],
      { ...valid, schema_version: 2 },
      { ...valid, id: 1 },
      { ...valid, title: 1 },
      { ...valid, repo_id: 1 },
      { ...valid, repo_root: 1 },
      { ...valid, branch: 1 },
      { ...valid, head_sha: 1 },
      { ...valid, status: 'unknown' },
      { ...valid, created_at: 1 },
      { ...valid, updated_at: 1 },
    ]

    for (const [index, value] of invalidValues.entries()) {
      const id = `invalid-${index}`
      const directory = join(paths.repoStateRoot, 'sessions', id)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'session.json'), JSON.stringify(value))
      await assert.rejects(
        () => runDevSessionStatus({ homeDir, repoRoot, id }),
        /Invalid DDev session metadata/,
      )
    }
  })

  it('dispatches the complete task-session lifecycle through the public CLI entrypoint', async () => {
    const { homeDir, repoRoot } = await installedRepo('main-session-dispatch')
    const originalDirectory = process.cwd()
    const originalHome = process.env.HOME
    process.chdir(repoRoot)
    process.env.HOME = homeDir

    try {
      const implicitPaths = await resolveDdevPaths({})
      assert.equal(implicitPaths.homeDir, homeDir)
      assert.equal(implicitPaths.repoRoot, repoRoot)
      assert.equal(implicitPaths.repoStateRoot, (await resolveDdevPaths({ homeDir, repoRoot })).repoStateRoot)
      await main(['dev', 'session', 'start', '--title', 'CLI lifecycle'])
      await main(['dev', 'session', 'list'])
      await main(['dev', 'session', 'status'])
      await main(['dev', 'session', 'close'])
      await main(['dev', 'session', 'archive'])
      await main(['dev', 'session', 'clean', '--force'])
      await main(['update', '--dry-run', '--agents-only'])
    } finally {
      process.chdir(originalDirectory)
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
    }
  })

  it('accepts bounded event files and rejects ambiguous or oversized input', async () => {
    const { homeDir, repoRoot } = await installedRepo('event-input')
    await runDevSessionStart({ homeDir, repoRoot, title: 'Event input' })
    const dataFile = join(homeDir, 'event.json')
    await writeFile(dataFile, JSON.stringify({
      node_id: 'verify-input',
      node_type: 'verification',
      status: 'completed',
    }))

    const recorded = await runDevRecord({
      homeDir,
      repoRoot,
      kind: 'node',
      dataFile,
    })
    assert.equal(recorded.event.payload.node_id, 'verify-input')
    await assert.rejects(
      () => runDevRecord({
        homeDir,
        repoRoot,
        kind: 'node',
        data: '{}',
        dataFile,
      }),
      /Use only one DDev event input/,
    )
    await assert.rejects(
      () => runDevRecord({
        homeDir,
        repoRoot,
        kind: 'node',
        data: 'x'.repeat(1024 * 1024 + 1),
      }),
      /event data exceeds 1048576 bytes/,
    )
  })
})

describe('private DDev file I/O', () => {
  it('runs locked validation, enforces limits, and recovers a stale lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-safe-io-'))
    const path = join(root, 'events.jsonl')
    let observed = ''
    await appendFileLocked(path, 'first\n', {
      beforeAppend: (current) => { observed = current },
      maxBytes: 20,
    })
    assert.equal(observed, '')
    await appendFileLocked(path, 'second\n', {
      beforeAppend: (current) => { observed = current },
      maxBytes: 20,
    })
    assert.equal(observed, 'first\n')
    await assert.rejects(
      () => appendFileLocked(path, 'too-long-for-limit\n', { maxBytes: 20 }),
      /would exceed 20 bytes/,
    )
    await assert.rejects(() => readTextLimited(path, 2), /exceeds 2 bytes/)
    assert.equal(await readTextLimited(path, 20), 'first\nsecond\n')

    const lockPath = `${path}.lock`
    await writeFile(lockPath, '')
    const stale = new Date(Date.now() - 31_000)
    await utimes(lockPath, stale, stale)
    await appendFileLocked(path, 'third\n', { maxBytes: 30 })
    assert.match(await readFile(path, 'utf8'), /third/)

    const blockedPath = join(root, 'blocked.jsonl')
    await writeFile(`${blockedPath}.lock`, '')
    await assert.rejects(
      () => appendFileLocked(blockedPath, 'blocked\n'),
      /Timed out waiting for DDev event lock/,
    )
  })

  it('preserves existing private files and cleans temporary files after atomic failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-safe-existing-'))
    const path = join(root, 'state.txt')
    await ensurePrivateFile(path, 'original')
    await ensurePrivateFile(path, 'replacement')
    assert.equal(await readFile(path, 'utf8'), 'original')

    const directoryTarget = join(root, 'directory-target')
    await mkdir(directoryTarget)
    await assert.rejects(() => writeFileAtomic(directoryTarget, 'content'))
    const siblings = await readdir(root)
    assert.equal(siblings.some((name) => name.startsWith('directory-target.tmp-')), false)
  })
})

describe('atomic agent cache replacement', () => {
  it('removes a fresh replacement when the manifest cannot be committed', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-cache-fresh-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'deweyou-cache-source-'))
    const paths = cachePaths({ homeDir })
    await mkdir(paths.manifestPath, { recursive: true })

    await assert.rejects(() => updateCache({ homeDir, sourceRoot }))
    await assert.rejects(() => stat(paths.assetsRoot), { code: 'ENOENT' })
  })

  it('restores the previous cache when a replacement manifest cannot be committed', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-cache-restore-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'deweyou-cache-source-'))
    const paths = cachePaths({ homeDir })
    await updateCache({ homeDir, sourceRoot })
    const previousRegistry = await readFile(join(paths.assetsRoot, 'registry.json'), 'utf8')
    await rm(paths.manifestPath)
    await mkdir(paths.manifestPath)

    await assert.rejects(() => updateCache({ homeDir, sourceRoot }))
    assert.equal(
      await readFile(join(paths.assetsRoot, 'registry.json'), 'utf8'),
      previousRegistry,
    )
  })
})

function manifest(): DdevManifest {
  return {
    schema_version: 1,
    runtime_schema: 1,
    event_schema: 1,
    minimum_cli_version: '1.3.0',
    required_cli_capabilities: CAPABILITIES,
    module_skills: MODULE_SKILLS,
    required_rules: ['code-style', 'engineering-principles'],
    session_files: ['session.json', 'task.md', 'events.jsonl', 'summary.md'],
  }
}

async function tempRepo(name: string) {
  const root = await mkdtemp(join(tmpdir(), `ddev-${name}-`))
  const homeDir = join(root, 'home')
  let repoRoot = join(root, 'repo')
  await mkdir(repoRoot, { recursive: true })
  repoRoot = await realpath(repoRoot)
  return { homeDir, repoRoot }
}

async function installedRepo(name: string) {
  const result = await tempRepo(name)
  for (const skill of MODULE_SKILLS) {
    const directory = join(result.homeDir, '.deweyou/agents/assets/skills', skill)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `# ${skill}\n`)
  }
  const rulesDirectory = join(result.homeDir, '.deweyou/agents/assets/rules')
  await mkdir(rulesDirectory, { recursive: true })
  await writeFile(join(rulesDirectory, 'code-style.md'), '# code-style\n')
  await writeFile(join(rulesDirectory, 'engineering-principles.md'), '# engineering-principles\n')
  const ddevDirectory = join(result.homeDir, '.deweyou/agents/assets/skills/ddev')
  await mkdir(ddevDirectory, { recursive: true })
  await writeFile(join(ddevDirectory, 'runtime.json'), JSON.stringify(manifest()))
  await runDevInstall(result)
  return result
}
