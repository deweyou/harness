import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import { exportBrainProjection } from '../src/cli/brain-export.ts'
import { importBrainHistory } from '../src/cli/brain-import.ts'
import { initBrain } from '../src/cli/brain.ts'
import { brainPaths } from '../src/cli/brain-config.ts'
import { compileWiki } from '../src/cli/brain-wiki.ts'

describe('brain historical import and filtered export', () => {
  it('imports supported historical files deterministically and quarantines secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-import-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const historyPath = join(root, 'history')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(join(root, 'ignored.csv'), 'not imported')
    await mkdir(historyPath, { recursive: true })
    await writeFile(
      join(historyPath, 'safe.jsonl'),
      '{"role":"user","content":"remember local-first notes"}\n',
    )
    await writeFile(
      join(historyPath, 'secret.txt'),
      'password=123456789012345678901234',
    )

    const first = await importBrainHistory({
      homeDir,
      agent: 'hermes',
      path: historyPath,
      scopes: ['personal'],
      now: new Date('2026-07-27T00:00:00.000Z'),
    })
    const second = await importBrainHistory({
      homeDir,
      agent: 'hermes',
      path: historyPath,
      scopes: ['personal'],
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    assert.deepEqual(first, {
      files: 2,
      records: 2,
      captured: 1,
      deduplicated: 0,
      quarantined: 1,
      skipped: 0,
    })
    assert.deepEqual(second, {
      files: 2,
      records: 2,
      captured: 0,
      deduplicated: 1,
      quarantined: 1,
      skipped: 0,
    })
    const eventFiles = await readdir(
      join(repoPath, 'events', 'macbook-a', '2026', '07'),
    )
    assert.equal(eventFiles.length, 1)
    assert.match(
      await readFile(
        join(repoPath, 'events', 'macbook-a', '2026', '07', eventFiles[0]),
        'utf8',
      ),
      /historical-import/,
    )
    await assert.rejects(
      importBrainHistory({
        homeDir,
        agent: 'invalid',
        path: historyPath,
      }),
      /must be one of/,
    )
  })

  it('skips unsupported, empty, and oversized import files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-import-skip-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const historyPath = join(root, 'history')
    await mkdir(historyPath, { recursive: true })
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(join(historyPath, 'empty.txt'), '')
    await writeFile(join(historyPath, 'ignored.csv'), 'ignored')
    const largePath = join(historyPath, 'large.jsonl')
    await writeFile(largePath, '')
    await truncate(largePath, 101 * 1024 * 1024)

    assert.deepEqual(
      await importBrainHistory({
        homeDir,
        agent: 'codex',
        path: historyPath,
      }),
      {
        files: 2,
        records: 2,
        captured: 0,
        deduplicated: 0,
        quarantined: 0,
        skipped: 2,
      },
    )
    assert.equal(
      (
        await importBrainHistory({
          homeDir,
          agent: 'codex',
          path: join(historyPath, 'ignored.csv'),
        })
      ).files,
      0,
    )
  })

  it('chunks UTF-8 history without splitting multibyte characters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-import-utf8-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const historyPath = join(root, 'history.txt')
    const content = Buffer.concat([
      Buffer.alloc(8 * 1024 * 1024 - 1, 'a'),
      Buffer.from('你好，跨设备记忆。'),
    ])
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(historyPath, content)

    const result = await importBrainHistory({
      homeDir,
      agent: 'hermes',
      path: historyPath,
      now: new Date('2026-07-27T00:00:00.000Z'),
    })
    assert.equal(result.captured, 2)
    const sourceRoot = join(
      brainPaths(homeDir).rawSourcesRoot,
      'sessions',
      'hermes',
    )
    const sourceFiles = (
      await readdir(sourceRoot, { recursive: true, withFileTypes: true })
    )
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
    const sourceContents = await Promise.all(
      sourceFiles.map(async (path) =>
        JSON.parse(await readFile(path, 'utf8')).content as string
      ),
    )
    const reconstructed = sourceContents
      .sort((left, right) => right.length - left.length)
      .join('')
    assert.equal(reconstructed, content.toString('utf8'))
    assert.doesNotMatch(reconstructed, /\uFFFD/)
  })

  it('exports only active artifacts allowed by clearance and scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-export-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const outputDir = join(root, 'published')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(
      join(repoPath, 'claims', 'reading.md'),
      claim('reading', 'Reading', 'public', 'domain/reading', 'Public reading idea.'),
    )
    await writeFile(
      join(repoPath, 'claims', 'finance.md'),
      claim(
        'finance',
        'Finance',
        'confidential',
        'domain/finance',
        'Private allocation.',
      ),
    )
    await compileWiki({ homeDir })

    const planned = await exportBrainProjection({
      homeDir,
      outputDir,
      clearance: 'public',
      allowedScopes: ['domain/reading'],
      dryRun: true,
    })
    assert.equal(planned.dryRun, true)
    const result = await exportBrainProjection({
      homeDir,
      outputDir,
      clearance: 'public',
      allowedScopes: ['domain/reading'],
      format: 'knowledge',
    })

    assert.ok(result.paths.includes('claims/reading.md'))
    assert.ok(result.paths.every((path) => !path.includes('finance')))
    assert.doesNotMatch(
      await readFile(join(outputDir, '.deweyou-brain-export.json'), 'utf8'),
      /Private allocation/,
    )
    const projectionAgents = await readFile(
      join(outputDir, 'AGENTS.md'),
      'utf8',
    )
    assert.match(projectionAgents, /^---\n/)
    assert.match(projectionAgents, /classification: public/)
    assert.match(projectionAgents, /generated/)
    const replaced = await exportBrainProjection({
      homeDir,
      outputDir,
      clearance: 'public',
      allowedScopes: [],
    })
    assert.equal(replaced.exported, 0)
    assert.match(
      await readFile(join(outputDir, 'AGENTS.md'), 'utf8'),
      /scope:\n  - system\/empty-projection/,
    )
    await assert.rejects(
      exportBrainProjection({
        homeDir,
        outputDir: join(repoPath, 'published'),
        clearance: 'public',
      }),
      /outside the canonical/,
    )
    const unmanaged = join(root, 'unmanaged')
    await mkdir(unmanaged)
    await assert.rejects(
      exportBrainProjection({
        homeDir,
        outputDir: unmanaged,
        clearance: 'public',
      }),
      /unmanaged directory/,
    )
  })
})

function claim(
  id: string,
  title: string,
  classification: string,
  scope: string,
  body: string,
): string {
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
