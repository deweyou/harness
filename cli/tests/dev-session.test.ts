import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { runDevInstall, runDevRecord } from '../src/cli/dev.ts'
import { resolveDdevPaths } from '../src/cli/dev-paths.ts'
import {
  runDevSessionArchive,
  runDevSessionClean,
  runDevSessionClose,
  runDevSessionList,
  runDevSessionStart,
  runDevSessionStatus,
} from '../src/cli/dev-session.ts'

const execFileAsync = promisify(execFile)
const MODULE_SKILLS = [
  'problem-framing',
  'product-design',
  'ui-design',
  'spec-driven-coding',
  'git-delivery',
  'repo-memory',
]

describe('DDev task sessions', () => {
  it('requires the cached runtime manifest before installation', async () => {
    const { homeDir, repoRoot } = await tempRepo('manifest-required')

    await assert.rejects(
      () => runDevInstall({ homeDir, repoRoot }),
      /runtime manifest is unavailable/,
    )
  })

  it('starts one minimal private task session per checkout', async () => {
    const { homeDir, repoRoot } = await installedRepo('session-start')
    const result = await runDevSessionStart({ homeDir, repoRoot, title: 'Implement update flow' })
    const metadata = JSON.parse(await readFile(join(result.sessionPath, 'session.json'), 'utf8'))
    const files = ['session.json', 'task.md', 'events.jsonl', 'summary.md']

    assert.equal(metadata.id, result.session.id)
    assert.equal(metadata.status, 'active')
    assert.equal(metadata.title, 'Implement update flow')
    assert.equal((await stat(result.sessionPath)).mode & 0o777, 0o700)
    for (const file of files) {
      assert.equal((await stat(join(result.sessionPath, file))).mode & 0o777, 0o600)
    }
    await assert.rejects(() => stat(join(result.sessionPath, 'context.md')), { code: 'ENOENT' })
    await assert.rejects(
      () => runDevSessionStart({ homeDir, repoRoot, title: 'Second task' }),
      /already active/,
    )

    const status = await runDevSessionStatus({ homeDir, repoRoot })
    const list = await runDevSessionList({ homeDir, repoRoot })
    assert.equal(status?.session.id, result.session.id)
    assert.equal(list.sessions[0].current, true)
  })

  it('closes, archives, and permanently cleans only with explicit force', async () => {
    const { homeDir, repoRoot } = await installedRepo('session-lifecycle')
    const started = await runDevSessionStart({ homeDir, repoRoot, title: 'Lifecycle task' })

    await assert.rejects(
      () => runDevSessionClean({ homeDir, repoRoot, id: started.session.id, force: true }),
      /is active/,
    )
    const closed = await runDevSessionClose({ homeDir, repoRoot })
    assert.equal(closed.session.status, 'closed')
    assert.equal((await runDevSessionStatus({ homeDir, repoRoot }))?.session.status, 'closed')

    const archived = await runDevSessionArchive({ homeDir, repoRoot })
    assert.equal(archived.session.status, 'archived')
    assert.match(archived.sessionPath, /\/archives\//)
    await assert.rejects(
      () => runDevSessionClean({ homeDir, repoRoot, id: started.session.id }),
      /Re-run with --force/,
    )
    const cleaned = await runDevSessionClean({
      homeDir,
      repoRoot,
      id: started.session.id,
      force: true,
    })
    assert.equal(cleaned.removed, true)
    assert.equal((await runDevSessionList({ homeDir, repoRoot })).sessions.length, 0)
  })

  it('lists old branch directories as legacy without migrating or deleting them', async () => {
    const { homeDir, repoRoot } = await installedRepo('legacy-list')
    const paths = await resolveDdevPaths({ homeDir, repoRoot })
    const legacyPath = join(paths.repoStateRoot, 'sessions', 'feature__old')
    await mkdir(legacyPath, { recursive: true })
    await writeFile(join(legacyPath, 'task.md'), '# Legacy\n')

    const list = await runDevSessionList({ homeDir, repoRoot })

    assert.deepEqual(list.sessions.map(({ id, status }) => ({ id, status })), [
      { id: 'feature__old', status: 'legacy' },
    ])
    assert.equal(await readFile(join(legacyPath, 'task.md'), 'utf8'), '# Legacy\n')
  })

  it('uses the normalized origin as stable repository identity across checkouts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-stable-repo-'))
    const homeDir = join(root, 'home')
    const first = join(root, 'first')
    const second = join(root, 'second')
    for (const repoRoot of [first, second]) {
      await mkdir(repoRoot, { recursive: true })
      await execFileAsync('git', ['init'], { cwd: repoRoot })
      await execFileAsync(
        'git',
        ['remote', 'add', 'origin', 'git@github.com:Deweyou/Agents.git'],
        { cwd: repoRoot },
      )
    }

    const firstPaths = await resolveDdevPaths({ homeDir, repoRoot: first })
    const secondPaths = await resolveDdevPaths({ homeDir, repoRoot: second })
    assert.equal(firstPaths.repoId, secondPaths.repoId)
    assert.equal(firstPaths.repoStateRoot, secondPaths.repoStateRoot)
    assert.notEqual(firstPaths.checkoutPointerPath, secondPaths.checkoutPointerPath)
  })

  it('serializes concurrent event appends without corrupting JSONL', async () => {
    const { homeDir, repoRoot } = await installedRepo('concurrent-events')
    await runDevSessionStart({ homeDir, repoRoot, title: 'Concurrent events' })

    await Promise.all(Array.from({ length: 20 }, (_, index) => runDevRecord({
      homeDir,
      repoRoot,
      kind: 'evidence',
      data: JSON.stringify({
        evidence_id: `e-${index}`,
        claim_id: `claim-${index}`,
        evidence_type: 'command',
        status: 'verified',
        summary: `Evidence ${index}`,
      }),
    })))

    const paths = await resolveDdevPaths({ homeDir, repoRoot })
    const pointer = JSON.parse(await readFile(paths.checkoutPointerPath, 'utf8'))
    const log = await readFile(
      join(paths.repoStateRoot, 'sessions', pointer.session_id, 'events.jsonl'),
      'utf8',
    )
    const events = log.trim().split('\n').map(JSON.parse)
    assert.equal(events.length, 20)
    assert.equal(new Set(events.map((event) => event.event_id)).size, 20)
  })
})

async function tempRepo(name: string) {
  const root = await mkdtemp(join(tmpdir(), `ddev-${name}-`))
  const homeDir = join(root, 'home')
  const repoRoot = join(root, 'repo')
  await mkdir(repoRoot, { recursive: true })
  return { homeDir, repoRoot }
}

async function installedRepo(name: string) {
  const result = await tempRepo(name)
  await writeRuntimeCache(result.homeDir)
  await runDevInstall(result)
  return result
}

async function writeRuntimeCache(homeDir: string): Promise<void> {
  for (const skill of MODULE_SKILLS) {
    const directory = join(homeDir, '.deweyou/agents/assets/skills', skill)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `# ${skill}\n`)
  }
  const rulesDirectory = join(homeDir, '.deweyou/agents/assets/rules')
  await mkdir(rulesDirectory, { recursive: true })
  await writeFile(join(rulesDirectory, 'code-style.md'), '# code-style\n')
  await writeFile(join(rulesDirectory, 'engineering-principles.md'), '# engineering-principles\n')
  const ddevDirectory = join(homeDir, '.deweyou/agents/assets/skills/ddev')
  await mkdir(ddevDirectory, { recursive: true })
  await writeFile(join(ddevDirectory, 'runtime.json'), JSON.stringify({
    schema_version: 1,
    runtime_schema: 1,
    event_schema: 1,
    minimum_cli_version: '1.3.0',
    required_cli_capabilities: [
      'agent:update',
      'cli:update',
      'ddev:event-schema@1',
      'ddev:runtime-schema@1',
      'ddev:task-sessions',
    ],
    module_skills: MODULE_SKILLS,
    required_rules: ['code-style', 'engineering-principles'],
    session_files: ['session.json', 'task.md', 'events.jsonl', 'summary.md'],
  }))
}
