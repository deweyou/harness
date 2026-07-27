import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'

import yaml from 'js-yaml'

import { renderBrainBootstrapPrompt } from '../src/cli/brain-bootstrap.ts'
import { runBrainWorker } from '../src/cli/brain-cli.ts'
import { brainPaths } from '../src/cli/brain-config.ts'
import {
  applyBrainMaintenanceProposal,
  prepareBrainMaintenance,
} from '../src/cli/brain-maintain.ts'
import type { ResolutionProposal } from '../src/cli/brain-types.ts'
import { captureBrainEvent, initBrain } from '../src/cli/brain.ts'

const execFileAsync = promisify(execFile)

describe('agent-driven Brain lifecycle', () => {
  it('fast-forwards an existing clean repository before adding missing files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-attach-'))
    const seed = join(root, 'seed')
    const remote = join(root, 'brain.git')
    const repoPath = join(root, 'knowledge')
    const homeDir = join(root, 'home')

    await git(['init', '-b', 'main', seed])
    await writeFile(join(seed, 'existing.md'), 'existing knowledge\n')
    await commitAll(seed, 'initial')
    await git(['clone', '--bare', seed, remote])
    await git(['clone', '--branch', 'main', remote, repoPath])

    await writeFile(join(seed, 'remote-note.md'), 'arrived before init\n')
    await commitAll(seed, 'remote update')
    await git(['-C', seed, 'remote', 'add', 'origin', remote])
    await git(['-C', seed, 'push', 'origin', 'main'])

    const result = await initBrain({
      homeDir,
      repoPath,
      deviceId: 'device-a',
      remote,
      branch: 'main',
    })

    assert.equal(
      await readFile(join(repoPath, 'remote-note.md'), 'utf8'),
      'arrived before init\n',
    )
    assert.equal(
      await readFile(join(repoPath, 'existing.md'), 'utf8'),
      'existing knowledge\n',
    )
    assert.equal(result.gitSync, 'fast-forwarded')
    assert.match(await readFile(join(repoPath, 'brain.yaml'), 'utf8'), /schema_version/)
  })

  it('preserves an existing non-Git knowledge directory when the remote is empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-empty-remote-'))
    const remote = join(root, 'brain.git')
    const repoPath = join(root, 'knowledge')
    const homeDir = join(root, 'home')
    await git(['init', '--bare', remote])
    await mkdir(repoPath, { recursive: true })
    await writeFile(join(repoPath, 'existing.md'), 'local knowledge\n')

    const result = await initBrain({
      homeDir,
      repoPath,
      deviceId: 'device-a',
      remote,
      branch: 'main',
    })

    assert.equal(result.gitSync, 'remote-empty')
    assert.equal(await readFile(join(repoPath, 'existing.md'), 'utf8'), 'local knowledge\n')
    assert.equal((await stat(join(repoPath, '.git'))).isDirectory(), true)
  })

  it('leaves a dirty repository untouched instead of pulling or scaffolding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-dirty-'))
    const seed = join(root, 'seed')
    const remote = join(root, 'brain.git')
    const repoPath = join(root, 'knowledge')
    const homeDir = join(root, 'home')

    await git(['init', '-b', 'main', seed])
    await writeFile(join(seed, 'existing.md'), 'tracked\n')
    await commitAll(seed, 'initial')
    await git(['clone', '--bare', seed, remote])
    await git(['clone', '--branch', 'main', remote, repoPath])
    await writeFile(join(repoPath, 'local-draft.md'), 'do not touch\n')

    await assert.rejects(
      initBrain({
        homeDir,
        repoPath,
        deviceId: 'device-a',
        remote,
        branch: 'main',
      }),
      /uncommitted changes/,
    )
    await assert.rejects(access(join(repoPath, 'brain.yaml')))
    await assert.rejects(access(brainPaths(homeDir).configPath))
    assert.equal(await readFile(join(repoPath, 'local-draft.md'), 'utf8'), 'do not touch\n')
  })

  it('refuses a checkout on the wrong branch before writing runtime state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-wrong-branch-'))
    const seed = join(root, 'seed')
    const remote = join(root, 'brain.git')
    const repoPath = join(root, 'knowledge')
    const homeDir = join(root, 'home')
    await git(['init', '-b', 'main', seed])
    await writeFile(join(seed, 'existing.md'), 'tracked\n')
    await commitAll(seed, 'initial')
    await git(['clone', '--bare', seed, remote])
    await git(['clone', '--branch', 'main', remote, repoPath])
    await git(['-C', repoPath, 'switch', '-c', 'feature'])

    await assert.rejects(
      initBrain({
        homeDir,
        repoPath,
        deviceId: 'device-a',
        remote,
        branch: 'main',
      }),
      /on branch feature, expected main/,
    )
    await assert.rejects(access(join(repoPath, 'brain.yaml')))
    await assert.rejects(access(brainPaths(homeDir).configPath))
  })

  it('refuses diverged history instead of rebasing or overwriting either side', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-diverged-'))
    const seed = join(root, 'seed')
    const remote = join(root, 'brain.git')
    const repoPath = join(root, 'knowledge')
    const homeDir = join(root, 'home')
    await git(['init', '-b', 'main', seed])
    await writeFile(join(seed, 'existing.md'), 'tracked\n')
    await commitAll(seed, 'initial')
    await git(['clone', '--bare', seed, remote])
    await git(['clone', '--branch', 'main', remote, repoPath])

    await writeFile(join(repoPath, 'local.md'), 'local commit\n')
    await commitAll(repoPath, 'local update')
    await writeFile(join(seed, 'remote.md'), 'remote commit\n')
    await commitAll(seed, 'remote update')
    await git(['-C', seed, 'remote', 'add', 'origin', remote])
    await git(['-C', seed, 'push', 'origin', 'main'])

    await assert.rejects(
      initBrain({
        homeDir,
        repoPath,
        deviceId: 'device-a',
        remote,
        branch: 'main',
      }),
      /has diverged/,
    )
    assert.equal(await readFile(join(repoPath, 'local.md'), 'utf8'), 'local commit\n')
    await assert.rejects(access(join(repoPath, 'brain.yaml')))
    await assert.rejects(access(brainPaths(homeDir).configPath))
  })

  it('prints a read-only agent bootstrap prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-bootstrap-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const before = await readdir(repoPath, { recursive: true })

    const prompt = await renderBrainBootstrapPrompt({
      homeDir,
      agent: 'codex',
    })

    assert.match(prompt, /Codex/)
    assert.match(prompt, /current model/)
    assert.match(prompt, /Do not bulk-import/)
    assert.match(prompt, /brain hook install --agent codex/)
    assert.match(prompt, /brain maintain --agent codex/)
    assert.deepEqual(await readdir(repoPath, { recursive: true }), before)
  })

  it('renders every supported agent bootstrap and rejects unknown agents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-bootstrap-agents-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })

    for (const agent of ['codex', 'claude', 'hermes', 'openclaw', 'trae'] as const) {
      const prompt = await renderBrainBootstrapPrompt({ homeDir, agent })
      assert.match(prompt, new RegExp(`brain hook install --agent ${agent}`))
      assert.match(prompt, /brain sync/)
    }
    await assert.rejects(
      renderBrainBootstrapPrompt({ homeDir, agent: 'unknown' }),
      /must be one of/,
    )
  })

  it('keeps raw transcripts local and commits only a source manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-local-source-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })

    const captured = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      sessionId: 'session-a',
      payload: {
        transcript: 'This full transcript must remain on this device.',
      },
      idFactory: () => 'local-source',
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    const manifest = await readFile(captured.sourcePath!, 'utf8')
    assert.doesNotMatch(manifest, /full transcript/)
    assert.match(manifest, /content_hash/)
    assert.match(captured.localSourcePath!, /\.deweyou\/brain\/raw-sources/)
    assert.match(
      await readFile(captured.localSourcePath!, 'utf8'),
      /full transcript/,
    )
    const prepared = await prepareBrainMaintenance({ homeDir, agent: 'codex' })
    assert.equal(prepared.jobs[0].local_source_path, captured.localSourcePath)
    assert.match(prepared.prompt, /local_source_path/)
  })

  it('moves prompt-shaped hook content out of Git events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-local-prompt-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })

    const captured = await captureBrainEvent({
      homeDir,
      agent: 'openclaw',
      eventType: 'before-prompt-build',
      payload: {
        prompt: 'Private prompt body stays on this device.',
        extra: { user_message: 'Nested user message also stays local.' },
        summary: 'Prompt captured locally.',
      },
      idFactory: () => 'local-prompt',
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    const event = await readFile(captured.eventPath!, 'utf8')
    assert.doesNotMatch(event, /Private prompt body/)
    assert.doesNotMatch(event, /Nested user message/)
    assert.match(event, /Prompt captured locally/)
    assert.match(
      await readFile(captured.localSourcePath!, 'utf8'),
      /Private prompt body/,
    )
  })

  it('prepares an agent prompt and applies only a matching pending proposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-agent-apply-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const captured = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      sessionId: 'session-a',
      payload: { summary: 'Prefer model work inside the active agent turn.' },
      idFactory: () => 'agent-event',
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    const prepared = await prepareBrainMaintenance({
      homeDir,
      agent: 'codex',
      sessionId: 'session-a',
    })
    assert.equal(prepared.pending, 1)
    assert.match(prepared.prompt, /current agent model/)
    assert.match(prepared.prompt, /ADD_CLAIM/)
    assert.equal(prepared.jobs[0].local_source_path, null)
    const job = prepared.jobs[0]
    const proposal: ResolutionProposal = {
      schema_version: 1,
      job_id: job.job_id,
      device_id: 'device-a',
      created_at: '2026-07-27T00:01:00.000Z',
      policy_version: 'v1',
      provider: 'agent-hook',
      model: 'current-agent-model',
      prompt_version: 'agent-maintenance-v1',
      confidence: 0.95,
      input_ids: [captured.event!.event_id],
      input_classification: 'private',
      evidence_refs: [captured.event!.event_id],
      operations: [
        {
          op: 'ADD_CLAIM',
          observation_ids: [job.observation_id],
          claim: {
            id: 'claim-agent-lifecycle',
            title: 'Agent-driven maintenance',
            body: 'Semantic maintenance runs inside the active agent turn.',
            classification: 'private',
            scopes: ['personal'],
            authority: 'model',
            confidence: 0.95,
          },
        },
      ],
    }

    const applied = await applyBrainMaintenanceProposal({
      homeDir,
      proposal,
    })
    assert.deepEqual(applied.claimIds, ['claim-agent-lifecycle'])
    assert.match(
      await readFile(join(repoPath, 'claims', 'claim-agent-lifecycle.md'), 'utf8'),
      /active agent turn/,
    )
    assert.equal((await readdir(brainPaths(homeDir).queueRoot)).length, 0)
  })

  it('never invokes the configured model command from the background worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-worker-no-model-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const markerPath = join(root, 'provider-ran')
    const providerPath = join(root, 'provider.mjs')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      providerPath,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(markerPath)}, "ran");`,
    )
    const configPath = brainPaths(homeDir).configPath
    const config = yaml.load(await readFile(configPath, 'utf8')) as {
      compiler: { provider: string; command: string[] }
    }
    config.compiler.provider = 'command'
    config.compiler.command = [process.execPath, providerPath]
    await writeFile(configPath, yaml.dump(config))
    await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      payload: { summary: 'Leave this for an agent hook.' },
      idFactory: () => 'worker-event',
    })

    const result = await silenceLogs(() =>
      runBrainWorker({ homeDir, noPush: true }),
    )

    assert.equal('derived' in result, true)
    await assert.rejects(access(markerPath))
    assert.equal((await readdir(brainPaths(homeDir).queueRoot)).length, 1)
    assert.equal((await stat(brainPaths(homeDir).databasePath)).isFile(), true)
  })
})

async function git(args: string[]): Promise<void> {
  await execFileAsync('git', args)
}

async function commitAll(repo: string, message: string): Promise<void> {
  await execFileAsync('git', ['-C', repo, 'add', '.'])
  await execFileAsync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    message,
  ])
}

async function silenceLogs<T>(work: () => Promise<T>): Promise<T> {
  const original = console.log
  console.log = () => {}
  try {
    return await work()
  } finally {
    console.log = original
  }
}
