import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'

import { captureBrainEvent, initBrain } from '../src/cli/brain.ts'
import { syncBrain } from '../src/cli/brain-git.ts'
import { applyResolutionProposal } from '../src/cli/brain-governance.ts'
import { compileWiki } from '../src/cli/brain-wiki.ts'

const execFileAsync = promisify(execFile)

describe('brain Git transport', () => {
  it('converges append-only device namespaces and never syncs local indexes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-git-'))
    const remote = join(root, 'brain.git')
    await git(root, ['init', '--bare', '--initial-branch=main', remote])

    const homeA = join(root, 'home-a')
    const repoA = join(root, 'repo-a')
    await initBrain({
      homeDir: homeA,
      repoPath: repoA,
      deviceId: 'device-a',
      remote,
    })
    const eventA = await captureBrainEvent({
      homeDir: homeA,
      agent: 'codex',
      eventType: 'stop',
      payload: { summary: 'Device A learned an immutable event rule.' },
      idFactory: () => 'event-a',
    })
    await syncBrain({ homeDir: homeA, now: new Date('2026-07-27T10:00:00.000Z') })

    const homeB = join(root, 'home-b')
    const repoB = join(root, 'repo-b')
    await git(root, ['clone', remote, repoB])
    await initBrain({
      homeDir: homeB,
      repoPath: repoB,
      deviceId: 'device-b',
    })
    const eventB = await captureBrainEvent({
      homeDir: homeB,
      agent: 'hermes',
      eventType: 'agent-end',
      payload: { summary: 'Device B learned a memory provider rule.' },
      idFactory: () => 'event-b',
    })
    const pushed = await syncBrain({
      homeDir: homeB,
      now: new Date('2026-07-27T11:00:00.000Z'),
    })
    assert.equal(pushed.status, 'pushed')

    const checkout = join(root, 'checkout')
    await git(root, ['clone', remote, checkout])
    assert.match(await readFile(join(checkout, relativeEvent(eventA.eventPath!)), 'utf8'), /device-a/)
    assert.match(await readFile(join(checkout, relativeEvent(eventB.eventPath!)), 'utf8'), /device-b/)
    const tracked = await git(checkout, ['ls-files'])
    assert.doesNotMatch(tracked, /brain\.sqlite/)
    assert.doesNotMatch(tracked, /context-packs|quarantine|queue/)

    const again = await syncBrain({ homeDir: homeB })
    assert.equal(again.status, 'up-to-date')
    assert.equal(again.commitsCreated, 0)
  })

  it('regenerates generated Wiki conflicts while preserving both claim ledgers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-wiki-conflict-'))
    const remote = join(root, 'brain.git')
    await git(root, ['init', '--bare', '--initial-branch=main', remote])
    const homeA = join(root, 'home-a')
    const repoA = join(root, 'repo-a')
    await initBrain({
      homeDir: homeA,
      repoPath: repoA,
      deviceId: 'device-a',
      remote,
    })
    await syncBrain({ homeDir: homeA })

    const homeB = join(root, 'home-b')
    const repoB = join(root, 'repo-b')
    await git(root, ['clone', remote, repoB])
    await initBrain({ homeDir: homeB, repoPath: repoB, deviceId: 'device-b' })

    await writeFile(
      join(repoA, 'claims', 'claim-a.md'),
      claim('claim-a', 'Device A fact', 'Fact from device A.'),
    )
    await compileWiki({ homeDir: homeA })
    await syncBrain({ homeDir: homeA })

    await writeFile(
      join(repoB, 'claims', 'claim-b.md'),
      claim('claim-b', 'Device B fact', 'Fact from device B.'),
    )
    await compileWiki({ homeDir: homeB })
    const result = await syncBrain({ homeDir: homeB })
    assert.equal(result.status, 'pushed')

    const checkout = join(root, 'checkout-wiki')
    await git(root, ['clone', remote, checkout])
    const wiki = await readFile(join(checkout, 'wiki/domains/personal/index.md'), 'utf8')
    assert.match(wiki, /Device A fact/)
    assert.match(wiki, /Device B fact/)
  })

  it('refuses to stage secret-like durable content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-git-secret-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      join(repoPath, 'claims', 'leak.md'),
      claim(
        'leak',
        'Leaked token',
        `Never publish ${['ghp', '_123456789012345678901234567890123456'].join('')}.
Never publish ${['sk', '-123456789012345678901234567890'].join('')}.
-----BEGIN PRIVATE KEY-----`,
      ),
    )

    await assert.rejects(syncBrain({ homeDir }), /refused staged secret-like content/)
    assert.equal(await git(repoPath, ['diff', '--cached', '--name-only']), '')
  })

  it('aborts and reports canonical ledger conflicts without discarding local work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-canonical-conflict-'))
    const remote = join(root, 'brain.git')
    await git(root, ['init', '--bare', '--initial-branch=main', remote])
    const homeA = join(root, 'home-a')
    const repoA = join(root, 'repo-a')
    await initBrain({
      homeDir: homeA,
      repoPath: repoA,
      deviceId: 'device-a',
      remote,
    })
    await syncBrain({ homeDir: homeA })
    const homeB = join(root, 'home-b')
    const repoB = join(root, 'repo-b')
    await git(root, ['clone', remote, repoB])
    await initBrain({ homeDir: homeB, repoPath: repoB, deviceId: 'device-b' })

    await writeFile(
      join(repoA, 'claims', 'shared.md'),
      claim('shared', 'Shared A', 'Canonical content from A.'),
    )
    await writeFile(
      join(repoB, 'claims', 'shared.md'),
      claim('shared', 'Shared B', 'Canonical content from B.'),
    )
    await syncBrain({ homeDir: homeA })
    await assert.rejects(
      syncBrain({ homeDir: homeB }),
      /canonical conflicts: claims\/shared\.md/,
    )
    assert.match(await readFile(join(repoB, 'claims', 'shared.md'), 'utf8'), /Shared B/)
    assert.doesNotMatch(await git(repoB, ['status', '--porcelain=v2', '--branch']), /rebase/)
  })

  it('retries a push race after another device advances the remote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-push-race-'))
    const remote = join(root, 'brain.git')
    await git(root, ['init', '--bare', '--initial-branch=main', remote])
    const homeA = join(root, 'home-a')
    const repoA = join(root, 'repo-a')
    await initBrain({
      homeDir: homeA,
      repoPath: repoA,
      deviceId: 'device-a',
      remote,
    })
    await syncBrain({ homeDir: homeA })

    const homeB = join(root, 'home-b')
    const repoB = join(root, 'repo-b')
    const homeC = join(root, 'home-c')
    const repoC = join(root, 'repo-c')
    await git(root, ['clone', remote, repoB])
    await git(root, ['clone', remote, repoC])
    await initBrain({ homeDir: homeB, repoPath: repoB, deviceId: 'device-b' })
    await initBrain({ homeDir: homeC, repoPath: repoC, deviceId: 'device-c' })
    await captureBrainEvent({
      homeDir: homeB,
      agent: 'codex',
      eventType: 'stop',
      payload: { summary: 'Device B races.' },
      idFactory: () => 'race-b',
    })
    await captureBrainEvent({
      homeDir: homeC,
      agent: 'claude',
      eventType: 'stop',
      payload: { summary: 'Device C wins first.' },
      idFactory: () => 'race-c',
    })

    const result = await syncBrain({
      homeDir: homeB,
      beforePush: async (attempt) => {
        if (attempt === 0) await syncBrain({ homeDir: homeC })
      },
    })
    assert.equal(result.status, 'pushed')
    assert.equal(result.retries, 1)
  })

  it('deterministically selects one canonical proposal for a concurrent job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-resolution-race-'))
    const remote = join(root, 'brain.git')
    await git(root, ['init', '--bare', '--initial-branch=main', remote])
    const homeA = join(root, 'home-a')
    const repoA = join(root, 'repo-a')
    await initBrain({
      homeDir: homeA,
      repoPath: repoA,
      deviceId: 'device-a',
      remote,
    })
    await syncBrain({ homeDir: homeA })

    const homeB = join(root, 'home-b')
    const repoB = join(root, 'repo-b')
    await git(root, ['clone', remote, repoB])
    await initBrain({ homeDir: homeB, repoPath: repoB, deviceId: 'device-b' })

    await applyResolutionProposal({
      homeDir: homeA,
      proposal: concurrentProposal(
        'device-a',
        'Device A resolution',
        'The deterministic winner is device A.',
      ),
    })
    await applyResolutionProposal({
      homeDir: homeB,
      proposal: concurrentProposal(
        'device-b',
        'Device B resolution',
        'The losing proposal stays as evidence.',
      ),
    })
    await compileWiki({ homeDir: homeA })
    await compileWiki({ homeDir: homeB })
    await syncBrain({ homeDir: homeA })
    const result = await syncBrain({ homeDir: homeB })
    assert.equal(result.status, 'pushed')

    const checkout = join(root, 'resolution-checkout')
    await git(root, ['clone', remote, checkout])
    const resolution = JSON.parse(
      await readFile(
        join(checkout, 'resolutions/jobs/job-concurrent.json'),
        'utf8',
      ),
    )
    assert.equal(
      resolution.selected_proposal,
      'resolutions/proposals/job-concurrent/device-a.json',
    )
    const proposalPaths = await git(checkout, [
      'ls-files',
      'resolutions/proposals/job-concurrent',
    ])
    assert.match(proposalPaths, /device-a\.json/)
    assert.match(proposalPaths, /device-b\.json/)
    const wiki = await readFile(
      join(checkout, 'wiki/domains/personal/index.md'),
      'utf8',
    )
    assert.match(wiki, /Device A resolution/)
    assert.doesNotMatch(wiki, /Device B resolution/)
  })

  it('rejects a configured path that is no longer a Git work tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-not-git-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await rm(join(repoPath, '.git'), { recursive: true })
    await assert.rejects(syncBrain({ homeDir }), /not a Git work tree/)
  })
})

function relativeEvent(path: string): string {
  return path.slice(path.indexOf('/events/') + 1)
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args])
  return stdout.trim()
}

function claim(id: string, title: string, body: string): string {
  return `---
id: ${id}
type: claim
title: ${title}
classification: private
scope: [personal]
status: active
authority: user
confidence: 1
updated_at: 2026-07-27T00:00:00.000Z
---

${body}
`
}

function concurrentProposal(
  deviceId: string,
  title: string,
  body: string,
) {
  return {
    schema_version: 1 as const,
    job_id: 'job-concurrent',
    device_id: deviceId,
    created_at: '2026-07-27T12:00:00.000Z',
    policy_version: 'v1',
    provider: 'test',
    model: 'test',
    prompt_version: 'v1',
    confidence: 0.9,
    input_ids: ['event-concurrent'],
    input_classification: 'private' as const,
    evidence_refs: ['event-concurrent'],
    operations: [
      {
        op: 'ADD_CLAIM' as const,
        claim: {
          title,
          body,
          classification: 'private' as const,
          scopes: ['personal'],
          authority: 'model',
          confidence: 0.9,
        },
      },
    ],
  }
}
