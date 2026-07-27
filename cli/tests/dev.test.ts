import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import {
  runDevClean,
  runDevDemo,
  runDevDoctor,
  runDevRecord,
  runDevSummary,
  runDevInstall,
  runDevUninstall,
  runDevStatus,
  closeServer,
  startDemoServer,
} from '../src/cli/dev.ts'
import {
  runDevSessionStart,
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

describe('dev commands', () => {
  it('prints the install plan without writing files in dry-run mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-dry-run-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)

    const result = await runDevInstall({ homeDir, repoRoot, dryRun: true })

    assert.equal(result.dryRun, true)
    assert.equal(result.exclude, 'not needed: global state only')
    assert.equal(
      result.moduleSkills['problem-framing'],
      join(homeDir, '.deweyou/agents/assets/skills/problem-framing/SKILL.md'),
    )
    await assert.rejects(() => stat(join(homeDir, '.deweyou/dev')), {
      code: 'ENOENT',
    })
  })

  it('installs runtime and global per-repo DDev state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-install-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)

    const result = await runDevInstall({ homeDir, repoRoot })

    assert.equal(result.dryRun, false)
    assert.equal(result.runtimeRoot, join(homeDir, '.deweyou/dev'))
    assert.equal(result.repoStateRoot, expectedRepoStateRoot(homeDir, repoRoot))
    const config = JSON.parse(await readFile(join(homeDir, '.deweyou/dev/config.json'), 'utf8'))
    const repoConfig = JSON.parse(await readFile(join(result.repoStateRoot, 'config.json'), 'utf8'))
    assert.equal(config.version, '0.4.0')
    assert.equal(config.activation, 'manual')
    assert.equal(config.passiveHooks, false)
    assert.equal(config.stateLocation, 'global')
    assert.equal(config.stateRoot, join(homeDir, '.deweyou/dev/repos'))
    assert.equal(config.moduleSkillRoot, join(homeDir, '.deweyou/agents/assets/skills'))
    assert.equal(
      config.moduleSkills['spec-driven-coding'],
      join(homeDir, '.deweyou/agents/assets/skills/spec-driven-coding/SKILL.md'),
    )
    assert.equal(config.moduleRefreshCommand, 'deweyou-cli update --agents-only')
    assert.equal(repoConfig.activation, 'manual')
    assert.equal(repoConfig.passiveHooks, false)
    assert.equal(repoConfig.entrySkill, 'ddev')
    assert.equal(repoConfig.moduleSkillResolution, 'global-dewey-cache')
    assert.equal(repoConfig.repoRoot, repoRoot)
    assert.equal(result.sessionPath, null)
    await assert.rejects(() => stat(join(result.repoStateRoot, 'sessions')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, '.deweyou/dev')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(homeDir, '.deweyou/dev/hooks')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(homeDir, '.codex/hooks.json')), {
      code: 'ENOENT',
    })
  })

  it('keeps repository clean, upgrades config, and removes only old DDev passive hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-git-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const configPath = join(homeDir, '.deweyou/dev/config.json')
    await mkdir(repoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)
    await execFileAsync('git', ['init'], { cwd: repoRoot })
    await mkdir(join(homeDir, '.deweyou/dev'), { recursive: true })
    await writeFile(configPath, '{"version":"custom","hooks":{"old":true}}\n')
    await mkdir(join(homeDir, '.codex'), { recursive: true })
    await writeFile(
      join(homeDir, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: `node "${join(homeDir, '.deweyou/dev/hooks/session-start.mjs')}"` },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'echo keep-me' },
              ],
            },
          ],
        },
      }),
    )

    const originalExitCode = process.exitCode
    process.exitCode = undefined
    const beforeInstallDoctor = await runDevDoctor({ homeDir, repoRoot })
    process.exitCode = originalExitCode
    const first = await runDevInstall({ homeDir, repoRoot })
    const second = await runDevInstall({ homeDir, repoRoot })
    const afterInstallDoctor = await runDevDoctor({ homeDir, repoRoot })

    assert.equal(beforeInstallDoctor.ok, false)
    assert.equal(
      beforeInstallDoctor.checks.some((check) =>
        check.message.includes('global repo DDev state is not created yet'),
      ),
      true,
    )
    assert.equal(first.exclude, 'not needed: global state only')
    assert.equal(second.exclude, 'not needed: global state only')
    assert.match(first.codexHooks, /removed 1 DDev passive hook/)
    assert.equal(second.codexHooks, 'not present')
    assert.equal(
      afterInstallDoctor.checks.some((check) =>
        check.message.includes('legacy repo-local DDev state is absent'),
      ),
      true,
    )
    const exclude = await readFile(join(repoRoot, '.git/info/exclude'), 'utf8')
    assert.doesNotMatch(exclude, /\.deweyou\/dev\//)
    const hooks = JSON.parse(await readFile(join(homeDir, '.codex/hooks.json'), 'utf8'))
    assert.equal(JSON.stringify(hooks).includes('echo keep-me'), true)
    assert.equal(JSON.stringify(hooks).includes('.deweyou/dev/hooks/session-start.mjs'), false)
    assert.equal(JSON.stringify(hooks).includes('.deweyou/dev/hooks/user-prompt-submit.mjs'), false)
    assert.equal(JSON.stringify(hooks).includes('.deweyou/dev/hooks/stop.mjs'), false)
    await stat(join(homeDir, '.codex/hooks.json.bak'))
    const upgraded = JSON.parse(await readFile(configPath, 'utf8'))
    assert.equal(upgraded.version, '0.4.0')
    assert.equal(upgraded.activation, 'manual')
    assert.equal(upgraded.passiveHooks, false)
    assert.equal('hooks' in upgraded, false)
    const upgradedRepoConfig = JSON.parse(await readFile(join(first.repoStateRoot, 'config.json'), 'utf8'))
    assert.equal(upgradedRepoConfig.activation, 'manual')
    assert.equal(upgradedRepoConfig.passiveHooks, false)
    assert.equal(upgradedRepoConfig.repoRoot, repoRoot)
    assert.equal('hooks' in upgradedRepoConfig, false)
  })

  it('leaves malformed hooks untouched and only removes old DDev passive hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-hooks-config-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)
    await mkdir(join(homeDir, '.codex'), { recursive: true })
    await writeFile(join(homeDir, '.codex/hooks.json'), '{ not json')

    const originalExitCode = process.exitCode
    process.exitCode = undefined
    const doctor = await runDevDoctor({ homeDir, repoRoot })
    process.exitCode = originalExitCode
    const recovered = await runDevInstall({ homeDir, repoRoot })
    assert.equal(doctor.checks.some((check) => check.message.includes('DDev passive hooks are absent')), true)
    assert.equal(recovered.codexHooks, 'skipped: no readable Codex hooks file')
    assert.equal(await readFile(join(homeDir, '.codex/hooks.json'), 'utf8'), '{ not json')

    await writeFile(
      join(homeDir, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            'odd-block',
            {
              hooks: [
                { type: 'command', command: `node "${join(homeDir, '.deweyou/dev/hooks/session-start.mjs')}"` },
                { type: 'command', command: 'node ~/.deweyou/dev/hooks/stop.mjs' },
                { type: 'command', command: 'node /tmp/external-harness/stop.mjs' },
                { type: 'command', command: 'echo keep-session' },
                { type: 'noop' },
              ],
            },
          ],
        },
      }),
    )

    const migrated = await runDevInstall({ homeDir, repoRoot })
    const hooks = JSON.parse(await readFile(join(homeDir, '.codex/hooks.json'), 'utf8'))
    const serialized = JSON.stringify(hooks)

    assert.match(migrated.codexHooks, /removed 2 DDev passive hook/)
    assert.equal(hooks.hooks.SessionStart.includes('odd-block'), true)
    assert.equal(serialized.includes('echo keep-session'), true)
    assert.equal(serialized.includes('type":"noop'), true)
    assert.equal(serialized.includes('/tmp/external-harness/stop.mjs'), true)
    assert.equal(serialized.includes('.deweyou/dev/hooks/session-start.mjs'), false)
    assert.equal(serialized.includes('.deweyou/dev/hooks/stop.mjs'), false)
  })

  it('reports detached git sessions with a stable label', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-detached-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await execFileAsync('git', ['init'], { cwd: repoRoot })
    await writeModuleSkillCache(homeDir)
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoRoot,
    })
    await execFileAsync('git', ['config', 'user.name', 'Test User'], {
      cwd: repoRoot,
    })
    await writeFile(join(repoRoot, 'README.md'), '# Demo\n')
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoRoot })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoRoot })
    const attachedStatus = await runDevStatus({ homeDir, repoRoot })
    await execFileAsync('git', ['checkout', '--detach'], { cwd: repoRoot })

    const status = await runDevStatus({ homeDir, repoRoot })

    assert.notEqual(attachedStatus.branch, 'unknown')
    assert.notEqual(attachedStatus.branch, 'detached')
    assert.equal(status.branch, 'detached')
    assert.equal(status.sessionPath.endsWith('detached'), true)
  })

  it('preserves existing git exclude content without adding repo-local state ignores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-exclude-prefix-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const excludePath = join(repoRoot, '.git/info/exclude')
    await mkdir(repoRoot, { recursive: true })
    await execFileAsync('git', ['init'], { cwd: repoRoot })
    await writeModuleSkillCache(homeDir)
    await writeFile(excludePath, 'existing-rule')

    const result = await runDevInstall({ homeDir, repoRoot })

    assert.equal(result.exclude, 'not needed: global state only')
    assert.equal(
      await readFile(excludePath, 'utf8'),
      'existing-rule',
    )
  })

  it('reports status and doctor checks without requiring an existing session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-status-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)
    await runDevInstall({ homeDir, repoRoot })
    await writeModuleSkillCache(homeDir)

    const status = await runDevStatus({ homeDir, repoRoot, branch: 'feature/demo' })
    const originalExitCode = process.exitCode
    process.exitCode = undefined
    const doctor = await runDevDoctor({ homeDir, repoRoot })
    process.exitCode = originalExitCode

    assert.equal(status.branch, 'feature/demo')
    assert.equal(status.runtimeExists, true)
    assert.equal(status.repoStateExists, true)
    assert.equal(status.sessionExists, false)
    assert.equal(status.sessionPath.endsWith('feature__demo'), true)
    assert.equal(doctor.ok, true)
    assert.equal(doctor.checks.every((check) => check.status !== 'warn'), true)
  })

  it('reports missing runtime as a doctor failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-doctor-missing-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const originalExitCode = process.exitCode
    await mkdir(repoRoot, { recursive: true })

    try {
      process.exitCode = undefined
      const result = await runDevDoctor({ homeDir, repoRoot })

      assert.equal(result.ok, false)
      assert.equal(result.checks.some((check) => check.status === 'fail'), true)
      assert.equal(process.exitCode, 1)
    } finally {
      process.exitCode = originalExitCode
    }
  })

  it('reports missing global module skills as a doctor failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-module-cache-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)
    await runDevInstall({ homeDir, repoRoot })
    await rm(join(homeDir, '.deweyou/agents/assets/skills/problem-framing'), {
      recursive: true,
      force: true,
    })

    const originalExitCode = process.exitCode
    try {
      process.exitCode = undefined
      const missing = await runDevDoctor({ homeDir, repoRoot })
      assert.equal(missing.ok, false)
      assert.equal(
        missing.checks.some((check) =>
          check.message.includes('global DDev module skills are missing'),
        ),
        true,
      )

      process.exitCode = undefined
      await mkdir(
        join(homeDir, '.deweyou/agents/assets/skills/problem-framing'),
        { recursive: true },
      )
      await writeFile(
        join(homeDir, '.deweyou/agents/assets/skills/problem-framing/SKILL.md'),
        '# problem-framing\n',
      )
      await rm(join(homeDir, '.deweyou/agents/assets/rules/code-style.md'))
      process.exitCode = undefined
      const missingRule = await runDevDoctor({ homeDir, repoRoot })
      assert.equal(missingRule.ok, false)
      assert.equal(
        missingRule.checks.some((check) =>
          check.message.includes('global DDev required rules are missing'),
        ),
        true,
      )

      await writeFile(
        join(homeDir, '.deweyou/agents/assets/rules/code-style.md'),
        '# code-style\n',
      )
      process.exitCode = undefined
      const healthy = await runDevDoctor({ homeDir, repoRoot })
      assert.equal(healthy.ok, true)
      assert.equal(
        healthy.checks.some((check) =>
          check.message.includes('global DDev module skills are available'),
        ),
        true,
      )
    } finally {
      process.exitCode = originalExitCode
    }
  })

  it('uses an unknown branch label outside git repositories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-unknown-branch-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })

    const status = await runDevStatus({ homeDir, repoRoot })

    assert.equal(status.branch, 'unknown')
    assert.equal(status.sessionPath.endsWith('unknown'), true)
  })

  it('cleans one branch session or all global per-repo DDev state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-clean-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const session = join(expectedRepoStateRoot(homeDir, repoRoot), 'sessions/feature__demo')
    await mkdir(session, { recursive: true })
    await writeFile(join(session, 'task.md'), '# Task\n')

    const dryRun = await runDevClean({
      homeDir,
      repoRoot,
      branch: 'feature/demo',
      dryRun: true,
    })
    const removedSession = await runDevClean({
      homeDir,
      repoRoot,
      branch: 'feature/demo',
      force: true,
    })

    assert.equal(dryRun.removed, false)
    assert.equal(removedSession.removed, true)
    await assert.rejects(() => stat(session), { code: 'ENOENT' })

    await mkdir(session, { recursive: true })
    const removedAll = await runDevClean({ homeDir, repoRoot, all: true, force: true })
    assert.equal(removedAll.removed, true)
    await assert.rejects(() => stat(join(expectedRepoStateRoot(homeDir, repoRoot), 'sessions')), {
      code: 'ENOENT',
    })
  })

  it('reports no-op clean when the target does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-clean-missing-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })

    const result = await runDevClean({
      homeDir,
      repoRoot,
      branch: 'missing',
      force: true,
    })

    assert.equal(result.removed, false)
    assert.equal(result.dryRun, false)
  })

  it('records validated protocol events and summarizes the branch session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-events-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await startDdevTask(homeDir, repoRoot, 'Protocol events')

    const baseFlags = { homeDir, repoRoot }
    await runDevRecord({
      ...baseFlags,
      kind: 'requirement',
      data: JSON.stringify({
        status: 'confirmed',
        acceptance_source: 'user',
        unresolved_decisions: [],
      }),
    })
    await runDevRecord({
      ...baseFlags,
      kind: 'node',
      data: JSON.stringify({
        node_id: 'implement',
        node_type: 'implementation',
        status: 'running',
      }),
    })
    const evidence = await runDevRecord({
      ...baseFlags,
      kind: 'evidence',
      data: JSON.stringify({
        evidence_id: 'test-1',
        claim_id: 'cli-records-events',
        evidence_type: 'command',
        status: 'failed',
        summary: 'Targeted test failed.',
        command: 'npm test',
        exit_code: 1,
      }),
    })
    const node = await runDevRecord({
      ...baseFlags,
      kind: 'node',
      data: JSON.stringify({
        node_id: 'implement',
        node_type: 'implementation',
        status: 'failed',
        evidence_ids: ['test-1'],
      }),
    })
    await runDevRecord({
      ...baseFlags,
      kind: 'failure',
      data: JSON.stringify({
        failure_id: 'failure-1',
        node_id: 'implement',
        failure_class: 'implementation',
        summary: 'The implementation violated the event contract.',
        evidence_ids: ['test-1'],
        restart_from: 'implement',
        retryable: true,
      }),
    })
    await runDevRecord({
      ...baseFlags,
      kind: 'delivery',
      data: JSON.stringify({
        delivery_id: 'delivery-1',
        status: 'blocked',
        summary: 'Protocol evidence blocks handoff.',
        evidence_ids: ['test-1'],
      }),
    })
    await runDevRecord({
      ...baseFlags,
      kind: 'review',
      data: JSON.stringify({
        review_id: 'review-1',
        scope: 'implementation',
        verdict: 'changes_requested',
        findings: ['Fix the event contract.'],
        evidence_ids: ['test-1'],
        restart_from: 'implement',
      }),
    })
    await runDevRecord({
      ...baseFlags,
      kind: 'recovery',
      data: JSON.stringify({
        recovery_id: 'recovery-1',
        source_event_id: node.event.event_id,
        restart_from: 'implement',
        reason: 'The failure is isolated to implementation.',
        status: 'planned',
      }),
    })

    const result = await runDevSummary({ ...baseFlags, format: 'json' })
    const events = (await readFile(result.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse)
    const summaryMarkdown = await readFile(result.summaryPath, 'utf8')

    assert.equal(events.length, 8)
    assert.equal(events[0].schema_version, 1)
    assert.equal(events[0].session_id.startsWith('protocol-events-'), true)
    assert.equal(events.some((event) => event.event_id === evidence.event.event_id), true)
    assert.equal(result.summary.event_count, 8)
    assert.deepEqual(result.summary.counts, {
      delivery: 1,
      evidence: 1,
      failure: 1,
      node: 2,
      recovery: 1,
      requirement: 1,
      review: 1,
    })
    assert.equal(result.summary.requirement?.status, 'confirmed')
    assert.equal(result.summary.nodes[0].status, 'failed')
    assert.equal(result.summary.claims[0].status, 'failed')
    assert.equal(result.summary.failures[0].restart_from, 'implement')
    assert.deepEqual(result.summary.failures[0].evidence_ids, ['test-1'])
    assert.equal(result.summary.reviews[0].verdict, 'changes_requested')
    assert.deepEqual(result.summary.reviews[0].findings, ['Fix the event contract.'])
    assert.equal(result.summary.recoveries[0].status, 'planned')
    assert.equal(result.summary.deliveries[0].status, 'blocked')
    assert.deepEqual(result.summary.deliveries[0].evidence_ids, ['test-1'])
    assert.match(summaryMarkdown, /# DDev Session Summary/)
    assert.match(summaryMarkdown, /Restart from `implement`/)
    assert.match(summaryMarkdown, /Review `review-1` requests changes/)
    assert.match(summaryMarkdown, /`delivery-1`: `blocked`/)
    assert.match(summaryMarkdown, /Finding: Fix the event contract/)
    assert.match(summaryMarkdown, /Node `implement` is failed/)
  })

  it('rejects invalid event payloads without appending them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-events-invalid-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })

    await assert.rejects(
      () => runDevRecord({
        homeDir,
        repoRoot,
        branch: 'main',
        kind: 'node',
        data: '{"node_id":"implement","status":"done"}',
      }),
      /node_type/,
    )

    await assert.rejects(
      () => stat(join(expectedRepoStateRoot(homeDir, repoRoot), 'sessions/main')),
      { code: 'ENOENT' },
    )
  })

  it('reports malformed persisted events with their line number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-events-malformed-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    const session = await startDdevTask(homeDir, repoRoot, 'Malformed events')
    await writeFile(join(session.sessionPath, 'events.jsonl'), '{not-json}\n')

    await assert.rejects(
      () => runDevSummary({ homeDir, repoRoot, format: 'markdown' }),
      /Invalid DDev event at line 1/,
    )
  })

  it('rejects events persisted under the wrong branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-events-branch-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    const session = await startDdevTask(homeDir, repoRoot, 'Wrong branch')
    const recorded = await runDevRecord({
      homeDir,
      repoRoot,
      kind: 'node',
      data: JSON.stringify({
        node_id: 'verify',
        node_type: 'verification',
        status: 'completed',
      }),
    })
    recorded.event.branch = 'feature/right'
    await writeFile(
      join(session.sessionPath, 'events.jsonl'),
      `${JSON.stringify(recorded.event)}\n`,
    )

    await assert.rejects(
      () => runDevSummary({ homeDir, repoRoot }),
      /belongs to branch feature\/right, expected unknown/,
    )
  })

  it('creates branch-session HTML demo files without starting a server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-demo-files-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await startDdevTask(homeDir, repoRoot, 'Demo files')

    const dryRun = await runDevDemo({
      homeDir,
      repoRoot,
      dryRun: true,
    })
    const result = await runDevDemo({
      homeDir,
      repoRoot,
      noServer: true,
    })

    assert.equal(dryRun.dryRun, true)
    assert.equal(dryRun.served, false)
    assert.equal(result.served, false)
    assert.match(result.demoRoot, /sessions\/demo-files-.*\/demo$/)
    assert.match(result.demoRoot, /\.deweyou\/dev\/repos\//)
    assert.match(await readFile(result.indexPath, 'utf8'), /DDev branch unknown/)
    await stat(join(result.demoRoot, '../task.md'))
    await assert.rejects(() => stat(join(result.demoRoot, '../brainstorm.md')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, '.deweyou/dev')), {
      code: 'ENOENT',
    })
  })

  it('can start the HTML demo server and return the local URL', async () => {
    if (!(await canBindDemoServer('127.0.0.1'))) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'ddev-demo-server-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await startDdevTask(homeDir, repoRoot, 'Demo server')

    const result = await runDevDemo({
      homeDir,
      repoRoot,
      port: 0,
      once: true,
    })

    assert.equal(result.served, true)
    assert.match(result.url ?? '', /^http:\/\/127\.0\.0\.1:\d+\/$/)
    await stat(result.indexPath)
  })

  it('keeps the HTML demo server running until it is closed', async () => {
    if (!(await canBindDemoServer('127.0.0.1'))) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'ddev-demo-running-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await startDdevTask(homeDir, repoRoot, 'Running demo')
    const originalLog = console.log
    const logs: string[] = []
    let serverHandle: any

    console.log = (...values: unknown[]) => {
      logs.push(values.map(String).join(' '))
    }

    try {
      const serving = runDevDemo({ homeDir, repoRoot, port: 0 })
      const url = await waitForLoggedUrl(logs)
      const port = Number(new URL(url).port)
      serverHandle = findActiveServer(port)

      assert.ok(serverHandle)
      await closeActiveServer(serverHandle)
      const result = await serving

      assert.equal(result.served, true)
      assert.equal(result.url, url)
    } finally {
      console.log = originalLog
      if (serverHandle?.listening) {
        await closeActiveServer(serverHandle)
      }
    }
  })

  it('serves static demo files with safe paths and content types', async () => {
    if (!(await canBindDemoServer('127.0.0.1'))) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'ddev-demo-static-'))
    const demoRoot = join(root, 'demo')
    await mkdir(join(demoRoot, 'nested'), { recursive: true })
    await writeFile(join(root, 'secret.txt'), 'secret')
    await writeFile(join(demoRoot, 'index.html'), '<h1>Demo</h1>')
    await writeFile(join(demoRoot, 'style.css'), 'body{}')
    await writeFile(join(demoRoot, 'app.js'), 'console.log("demo")')
    await writeFile(join(demoRoot, 'data.json'), '{}')
    await writeFile(join(demoRoot, 'mark.svg'), '<svg></svg>')
    await writeFile(join(demoRoot, 'pixel.png'), 'png')
    await writeFile(join(demoRoot, 'photo.jpg'), 'jpg')
    await writeFile(join(demoRoot, 'file.bin'), 'bin')
    const server = await startDemoServer(demoRoot, '127.0.0.1', 0)
    const address = server.address()
    assert.equal(typeof address, 'object')
    const baseUrl = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`

    try {
      const html = await fetch(`${baseUrl}/`)
      const css = await fetch(`${baseUrl}/style.css`)
      const js = await fetch(`${baseUrl}/app.js`)
      const json = await fetch(`${baseUrl}/data.json`)
      const svg = await fetch(`${baseUrl}/mark.svg`)
      const png = await fetch(`${baseUrl}/pixel.png`)
      const jpg = await fetch(`${baseUrl}/photo.jpg`)
      const bin = await fetch(`${baseUrl}/file.bin`)
      const missing = await fetch(`${baseUrl}/missing.html`)
      const directory = await fetch(`${baseUrl}/nested`)
      const forbidden = await fetch(`${baseUrl}/%2e%2e%2fsecret.txt`)
      const serverError = await fetch(`${baseUrl}/${'a'.repeat(5000)}`)

      assert.equal(html.status, 200)
      assert.match(html.headers.get('content-type') ?? '', /text\/html/)
      assert.match(await html.text(), /Demo/)
      assert.match(css.headers.get('content-type') ?? '', /text\/css/)
      assert.match(js.headers.get('content-type') ?? '', /text\/javascript/)
      assert.match(json.headers.get('content-type') ?? '', /application\/json/)
      assert.match(svg.headers.get('content-type') ?? '', /image\/svg\+xml/)
      assert.match(png.headers.get('content-type') ?? '', /image\/png/)
      assert.match(jpg.headers.get('content-type') ?? '', /image\/jpeg/)
      assert.match(bin.headers.get('content-type') ?? '', /application\/octet-stream/)
      assert.equal(missing.status, 404)
      assert.equal(directory.status, 404)
      assert.equal(forbidden.status, 403)
      assert.equal(serverError.status, 500)
    } finally {
      await closeServer(server)
    }
  })

  it('rejects invalid demo ports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-demo-port-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })

    await assert.rejects(
      () => runDevDemo({ homeDir, repoRoot, port: '-1' }),
      /Invalid port: -1/,
    )
  })

  it('recovers malformed DDev config and skips non-object Codex hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-config-recover-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const repoStateRoot = expectedRepoStateRoot(homeDir, repoRoot)
    await mkdir(join(homeDir, '.deweyou/dev'), { recursive: true })
    await mkdir(join(homeDir, '.codex'), { recursive: true })
    await mkdir(repoStateRoot, { recursive: true })
    await writeFile(join(homeDir, '.deweyou/dev/config.json'), '{ not json')
    await writeFile(join(repoStateRoot, 'config.json'), '{ not json')
    await writeFile(join(homeDir, '.codex/hooks.json'), '[]')
    await writeModuleSkillCache(homeDir)

    const result = await runDevInstall({ homeDir, repoRoot })

    assert.equal(result.exclude, 'not needed: global state only')
    assert.equal(result.codexHooks, 'skipped: Codex hooks file is not an object')
    const config = JSON.parse(await readFile(join(homeDir, '.deweyou/dev/config.json'), 'utf8'))
    const repoConfig = JSON.parse(await readFile(join(repoStateRoot, 'config.json'), 'utf8'))
    assert.equal(config.activation, 'manual')
    assert.equal(repoConfig.activation, 'manual')
  })

  it('recovers non-object DDev config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-config-array-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const repoStateRoot = expectedRepoStateRoot(homeDir, repoRoot)
    await mkdir(join(homeDir, '.deweyou/dev'), { recursive: true })
    await mkdir(repoStateRoot, { recursive: true })
    await writeFile(join(homeDir, '.deweyou/dev/config.json'), '[]')
    await writeFile(join(repoStateRoot, 'config.json'), '[]')
    await writeModuleSkillCache(homeDir)

    await runDevInstall({ homeDir, repoRoot })

    const config = JSON.parse(await readFile(join(homeDir, '.deweyou/dev/config.json'), 'utf8'))
    const repoConfig = JSON.parse(await readFile(join(repoStateRoot, 'config.json'), 'utf8'))
    assert.equal(config.activation, 'manual')
    assert.equal(repoConfig.activation, 'manual')
  })

  it('reports no-op uninstall outside git without existing DDev files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-uninstall-missing-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })

    const result = await runDevUninstall({ homeDir, repoRoot })

    assert.equal(result.runtimeRemoved, false)
    assert.equal(result.repoStateRemoved, false)
    assert.equal(result.exclude, 'skipped: not a git repository')
    assert.equal(result.codexHooks, 'skipped: no readable Codex hooks file')
  })

  it('removes an unused runtime even when the repo state container is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-uninstall-no-repos-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await mkdir(join(homeDir, '.deweyou/dev'), { recursive: true })

    const result = await runDevUninstall({ homeDir, repoRoot })

    assert.equal(result.runtimeRemoved, true)
    assert.equal(result.repoStateRemoved, false)
    await assert.rejects(() => stat(join(homeDir, '.deweyou/dev')), { code: 'ENOENT' })
  })

  it('surfaces invalid repo state containers during uninstall', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-uninstall-bad-repos-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await mkdir(join(homeDir, '.deweyou/dev'), { recursive: true })
    await writeFile(join(homeDir, '.deweyou/dev/repos'), 'not-a-directory')

    await assert.rejects(() => runDevUninstall({ homeDir, repoRoot }))
  })

  it('uninstalls runtime, global per-repo state, legacy repo state, excludes, and old DDev passive hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-uninstall-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await execFileAsync('git', ['init'], { cwd: repoRoot })
    await writeModuleSkillCache(homeDir)
    await runDevInstall({ homeDir, repoRoot })
    await mkdir(join(repoRoot, '.deweyou/dev'), { recursive: true })
    await writeFile(join(repoRoot, '.deweyou/dev/legacy.md'), 'legacy')
    await writeFile(join(repoRoot, '.git/info/exclude'), '.deweyou/dev/\n')
    await mkdir(join(homeDir, '.codex'), { recursive: true })
    await writeFile(
      join(homeDir, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: `node "${join(homeDir, '.deweyou/dev/hooks/session-start.mjs')}"` },
                { type: 'command', command: 'echo keep-me' },
              ],
            },
          ],
        },
      }),
    )

    const dryRun = await runDevUninstall({ homeDir, repoRoot, dryRun: true })
    const result = await runDevUninstall({ homeDir, repoRoot })

    assert.equal(dryRun.runtimeRemoved, false)
    assert.equal(result.runtimeRemoved, true)
    assert.equal(result.repoStateRemoved, true)
    assert.equal(result.exclude, 'removed')
    assert.match(result.codexHooks, /removed 1 DDev passive hook/)
    await assert.rejects(() => stat(join(homeDir, '.deweyou/dev')), { code: 'ENOENT' })
    await assert.rejects(() => stat(join(repoRoot, '.deweyou/dev')), { code: 'ENOENT' })
    const exclude = await readFile(join(repoRoot, '.git/info/exclude'), 'utf8')
    assert.doesNotMatch(exclude, /\.deweyou\/dev\//)
    const hooks = JSON.parse(await readFile(join(homeDir, '.codex/hooks.json'), 'utf8'))
    assert.equal(JSON.stringify(hooks).includes('.deweyou/dev/hooks/session-start.mjs'), false)
    assert.equal(JSON.stringify(hooks).includes('echo keep-me'), true)
  })

  it('keeps the global runtime when another repository still has DDev state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ddev-uninstall-other-repo-'))
    const homeDir = join(root, 'home')
    const repoRoot = join(root, 'repo')
    const otherRepoRoot = join(root, 'other-repo')
    await mkdir(repoRoot, { recursive: true })
    await mkdir(otherRepoRoot, { recursive: true })
    await writeModuleSkillCache(homeDir)
    await runDevInstall({ homeDir, repoRoot })
    await runDevInstall({ homeDir, repoRoot: otherRepoRoot })

    const repoStateRoot = expectedRepoStateRoot(homeDir, repoRoot)
    const otherRepoStateRoot = expectedRepoStateRoot(homeDir, otherRepoRoot)
    const result = await runDevUninstall({ homeDir, repoRoot })

    assert.equal(result.runtimeRemoved, false)
    assert.equal(result.repoStateRemoved, true)
    await assert.rejects(() => stat(repoStateRoot), { code: 'ENOENT' })
    await stat(join(homeDir, '.deweyou/dev'))
    await stat(otherRepoStateRoot)
  })
})

async function writeModuleSkillCache(homeDir: string): Promise<void> {
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
  await writeFile(
    join(ddevDirectory, 'runtime.json'),
    JSON.stringify({
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
    }),
  )
}

async function startDdevTask(homeDir: string, repoRoot: string, title: string) {
  await writeModuleSkillCache(homeDir)
  await runDevInstall({ homeDir, repoRoot })
  return runDevSessionStart({ homeDir, repoRoot, title })
}

function expectedRepoStateRoot(homeDir: string, repoRoot: string): string {
  const name = basename(repoRoot).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'
  const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 10)
  return join(homeDir, '.deweyou/dev/repos', `${name}-${hash}`)
}

async function waitForLoggedUrl(logs: string[]): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const urlLine = logs.find((line) => line.startsWith('URL: '))
    if (urlLine) return urlLine.slice('URL: '.length)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for demo URL')
}

function findActiveServer(port: number): any {
  const getActiveHandles = (process as any)._getActiveHandles as () => any[]
  return getActiveHandles().find((handle) => {
    if (typeof handle?.address !== 'function' || typeof handle?.close !== 'function') {
      return false
    }
    const address = handle.address()
    return typeof address === 'object' && address?.port === port
  })
}

async function closeActiveServer(server: any): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function canBindDemoServer(host: string): Promise<boolean> {
  const server = createServer(() => {})
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      server.once('error', onError)
      server.listen(0, host, () => {
        server.off('error', onError)
        resolve()
      })
    })
    return true
  } catch (_error) {
    return false
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') {
            resolve()
            return
          }
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}
