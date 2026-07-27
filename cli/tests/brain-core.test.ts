import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import {
  captureBrainEvent,
  initBrain,
  loadBrainConfig,
} from '../src/cli/brain.ts'
import { indexBrain } from '../src/cli/brain-index.ts'
import { recallBrain } from '../src/cli/brain-recall.ts'
import {
  parseBrainMarkdown,
  validateClassificationTransition,
} from '../src/cli/brain-schema.ts'

const execFileAsync = promisify(execFile)

describe('brain core', () => {
  it('initializes private local state and a portable knowledge repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-init-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const result = await initBrain({
      homeDir,
      repoPath,
      deviceId: 'macbook-a',
      now: new Date('2026-07-27T08:00:00.000Z'),
    })

    assert.equal(result.config.knowledge_repo, repoPath)
    assert.equal(result.config.device_id, 'macbook-a')
    assert.equal(result.config.sync.encryption, 'none')
    assert.equal((await stat(join(homeDir, '.deweyou/brain/config.yaml'))).mode & 0o777, 0o600)
    assert.match(await readFile(join(repoPath, 'AGENTS.md'), 'utf8'), /Context Hub/)
    assert.match(await readFile(join(repoPath, 'brain.yaml'), 'utf8'), /default_classification: private/)
    assert.match(
      await readFile(join(repoPath, 'wiki/domains/personal/purpose.md'), 'utf8'),
      /classification: private/,
    )
    assert.match(await readFile(join(repoPath, '.gitignore'), 'utf8'), /brain\.sqlite/)
    const markdownFiles = (await readdir(repoPath, {
      recursive: true,
      withFileTypes: true,
    }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(entry.parentPath, entry.name))
    assert.ok(markdownFiles.length > 0)
    for (const markdownPath of markdownFiles) {
      const markdown = await readFile(markdownPath, 'utf8')
      assert.match(markdown, /^---\n[\s\S]*?\nclassification: (public|private|confidential|restricted)\n/)
      assert.match(markdown, /^---\n[\s\S]*?\nscope:\n(?:  - .+\n)+/)
    }

    const loaded = await loadBrainConfig({ homeDir })
    assert.deepEqual(loaded, result.config)
  })

  it('clones an existing remote knowledge ledger before adding missing templates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-clone-'))
    const homeDir = join(root, 'home')
    const seedPath = join(root, 'seed')
    const remotePath = join(root, 'remote.git')
    const repoPath = join(root, 'knowledge')
    await execFileAsync('git', ['init', '-b', 'main', seedPath])
    await writeFile(join(seedPath, 'existing.md'), 'existing knowledge\n')
    await execFileAsync('git', [
      '-C',
      seedPath,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'add',
      'existing.md',
    ])
    await execFileAsync('git', [
      '-C',
      seedPath,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'seed',
    ])
    await execFileAsync('git', ['clone', '--bare', seedPath, remotePath])

    await initBrain({
      homeDir,
      repoPath,
      deviceId: 'macbook-a',
      remote: remotePath,
    })

    assert.equal(await readFile(join(repoPath, 'existing.md'), 'utf8'), 'existing knowledge\n')
    assert.match(await readFile(join(repoPath, 'AGENTS.md'), 'utf8'), /Context Hub/)
  })

  it('validates remote binding and can plan with an inferred device id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-remote-binding-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const remoteA = join(root, 'remote-a.git')
    const remoteB = join(root, 'remote-b.git')
    await execFileAsync('git', ['init', '--bare', remoteA])
    await execFileAsync('git', ['init', '--bare', remoteB])
    const plan = await initBrain({
      homeDir,
      repoPath,
      dryRun: true,
    })
    assert.ok(plan.config.device_id.length > 0)
    await initBrain({
      homeDir,
      repoPath,
      deviceId: 'device-a',
      remote: remoteA,
    })
    await assert.rejects(
      initBrain({
        homeDir,
        repoPath,
        deviceId: 'device-a',
        remote: remoteB,
      }),
      /origin already points/,
    )
    await assert.rejects(
      initBrain({
        homeDir: join(root, 'other-home'),
        repoPath: join(root, 'other-repo'),
        deviceId: 'device-b',
        remote: join(root, 'missing.git'),
      }),
      /Unable to inspect Brain remote/,
    )
  })

  it('captures immutable device events and normalized session sources without network work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-capture-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'studio-mac' })

    const result = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'session-end',
      sessionId: 'session-1',
      cwd: '/work/project',
      scopes: ['personal', 'repo/project'],
      classification: 'private',
      payload: {
        transcript: [
          { role: 'user', content: 'Keep a local-first personal knowledge base.' },
          { role: 'assistant', content: 'Use Git for durable records.' },
        ],
      },
      now: new Date('2026-07-27T09:10:11.000Z'),
      idFactory: () => '01-event',
    })

    assert.equal(result.status, 'captured')
    assert.match(result.eventPath ?? '', /events\/studio-mac\/2026\/07\/01-event\.json$/)
    assert.match(result.sourcePath ?? '', /sources\/sessions\/codex\/2026\/07\//)
    const event = JSON.parse(await readFile(result.eventPath!, 'utf8'))
    assert.deepEqual(event.scopes, ['device/studio-mac'])
    assert.equal(event.classification, 'private')
    assert.equal(event.source_id, 'source_01-event')
    assert.equal(event.payload.transcript, undefined)
    assert.equal(event.payload.transcript_ref, 'source_01-event')
    assert.deepEqual(event.payload.intended_scopes, ['personal', 'repo/project'])
    assert.ok(result.jobPath)
  })

  it('refuses to overwrite an immutable event id with different content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-event-collision-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const first = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      payload: { summary: 'Original immutable content.' },
      now: new Date('2026-07-27T10:00:00.000Z'),
      idFactory: () => 'same-id',
    })
    await assert.rejects(
      captureBrainEvent({
        homeDir,
        agent: 'codex',
        eventType: 'stop',
        payload: { summary: 'Conflicting replacement content.' },
        now: new Date('2026-07-27T10:00:00.000Z'),
        idFactory: () => 'same-id',
      }),
      /Immutable Brain artifact already exists/,
    )
    assert.match(
      await readFile(first.eventPath!, 'utf8'),
      /Original immutable content/,
    )
  })

  it('quarantines secret-like capture payloads instead of writing them to Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-secret-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })

    const result = await captureBrainEvent({
      homeDir,
      agent: 'claude',
      eventType: 'stop',
      payload: {
        transcript: [
          ['Use token ghp', '_123456789012345678901234567890123456'].join(''),
          ['sk', '-123456789012345678901234567890'].join(''),
          ['xoxb', '-123456789012345678901234567890'].join(''),
          ['AKIA', '1234567890123456'].join(''),
          '-----BEGIN PRIVATE KEY-----',
        ].join('\n'),
      },
      idFactory: () => 'secret-event',
    })

    assert.equal(result.status, 'quarantined')
    assert.equal(result.eventPath, null)
    const quarantine = await readFile(result.quarantinePath!, 'utf8')
    assert.match(quarantine, /github-token/)
    assert.match(quarantine, /openai-key/)
    assert.match(quarantine, /slack-token/)
    assert.match(quarantine, /aws-access-key/)
    assert.match(quarantine, /private-key/)
  })

  it('scans transcript files before copying them into the knowledge repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-transcript-secret-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const transcriptPath = join(root, 'session.jsonl')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(
      transcriptPath,
      '{"role":"user","content":"api_key=123456789012345678901234"}\n',
    )

    const result = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      payload: { transcript_path: transcriptPath },
      idFactory: () => 'transcript-secret',
    })

    assert.equal(result.status, 'quarantined')
    assert.equal(result.sourcePath, null)
    assert.match(
      await readFile(result.quarantinePath!, 'utf8'),
      /credential-assignment/,
    )
  })

  it('copies safe transcript files into device-scoped source records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-transcript-safe-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const transcriptPath = join(root, 'session.jsonl')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(transcriptPath, '{"role":"user","content":"safe memory"}\n')

    const result = await captureBrainEvent({
      homeDir,
      agent: 'trae',
      eventType: 'stop',
      payload: { transcript_path: transcriptPath, cwd: '/tmp/project' },
      idFactory: () => 'safe-transcript',
    })

    assert.equal(result.status, 'captured')
    const source = JSON.parse(await readFile(result.sourcePath!, 'utf8'))
    assert.equal(source.content.includes('safe memory'), true)
    assert.deepEqual(source.scopes, ['device/macbook-a'])
  })

  it('validates frontmatter and never permits automatic classification downgrade', () => {
    const parsed = parseBrainMarkdown({
      path: 'claims/claim-1.md',
      contents: `---
id: claim-1
type: claim
classification: confidential
scope:
  - personal
status: active
title: Investment policy
---

# Investment policy

Prefer diversified funds.
`,
      defaults: {
        classification: 'private',
        scopes: ['personal'],
      },
    })

    assert.equal(parsed.classification, 'confidential')
    assert.deepEqual(parsed.scopes, ['personal'])
    assert.throws(
      () => validateClassificationTransition('confidential', 'public', 'model'),
      /may not lower classification/,
    )
    assert.doesNotThrow(
      () => validateClassificationTransition('private', 'confidential', 'model'),
    )
    assert.doesNotThrow(
      () => validateClassificationTransition('confidential', 'public', 'user'),
    )
    assert.throws(
      () =>
        parseBrainMarkdown({
          path: 'claims/invalid.md',
          contents: `---
id: invalid
type: claim
classification: invisible
scope: [personal]
---
bad
`,
          defaults: { classification: 'private', scopes: ['personal'] },
        }),
      /Invalid classification/,
    )
  })

  it('indexes locally and enforces clearance plus scope before assembling context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-recall-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await assert.rejects(
      recallBrain({
        homeDir,
        query: 'missing index',
      }),
      /index is missing/,
    )

    await writeFile(
      join(repoPath, 'claims/public-note.md'),
      claim({
        id: 'public-note',
        title: 'Reading note',
        classification: 'public',
        scope: 'domain/reading',
        body: 'Distributed systems favor immutable event logs.',
      }),
    )
    await writeFile(
      join(repoPath, 'claims/private-note.md'),
      claim({
        id: 'private-note',
        title: 'Personal architecture',
        classification: 'private',
        scope: 'personal',
        body: 'The personal brain uses a local SQLite index.',
      }),
    )
    await writeFile(
      join(repoPath, 'claims/finance-note.md'),
      claim({
        id: 'finance-note',
        title: 'Finance allocation',
        classification: 'confidential',
        scope: 'domain/finance',
        body: 'The confidential portfolio allocation uses index funds.',
      }),
    )

    const indexed = await indexBrain({ homeDir })
    assert.ok(indexed.indexed >= 3)
    assert.equal(indexed.databasePath.startsWith(repoPath), false)

    const personal = await recallBrain({
      homeDir,
      query: 'personal brain SQLite',
      clearance: 'private',
      allowedScopes: ['personal'],
      tokenBudget: 400,
    })
    assert.ok(personal.entries.some((entry) => entry.id === 'private-note'))
    assert.ok(personal.entries.every((entry) => entry.id !== 'finance-note'))
    assert.equal(personal.levels.l2.length, 1)

    const publicWiki = await recallBrain({
      homeDir,
      query: 'immutable event logs',
      clearance: 'public',
      allowedScopes: ['domain/reading'],
      tokenBudget: 400,
    })
    assert.deepEqual(publicWiki.entries.map((entry) => entry.id), ['public-note'])

    const denied = await recallBrain({
      homeDir,
      query: 'portfolio allocation index funds',
      clearance: 'private',
      allowedScopes: ['domain/finance'],
      tokenBudget: 400,
    })
    assert.equal(denied.entries.length, 0)
    assert.doesNotMatch(JSON.stringify(denied.entries), /portfolio allocation/)

    const noScopes = await recallBrain({
      homeDir,
      query: '',
      clearance: 'restricted',
      allowedScopes: [],
    })
    assert.equal(noScopes.entries.length, 0)
    const tooSmall = await recallBrain({
      homeDir,
      query: 'personal architecture SQLite',
      clearance: 'private',
      allowedScopes: ['personal'],
      tokenBudget: 1,
    })
    assert.equal(tooSmall.estimated_tokens, 0)
  })
})

function claim({
  id,
  title,
  classification,
  scope,
  body,
}: {
  id: string
  title: string
  classification: string
  scope: string
  body: string
}): string {
  return `---
id: ${id}
type: claim
title: ${title}
classification: ${classification}
scope:
  - ${scope}
status: active
authority: user
confidence: 0.9
updated_at: 2026-07-27T00:00:00.000Z
---

# ${title}

${body}
`
}
