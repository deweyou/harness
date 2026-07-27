import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import { indexBrain } from '../src/cli/brain-index.ts'
import { recallBrain } from '../src/cli/brain-recall.ts'
import { initBrain } from '../src/cli/brain.ts'

describe('brain index governance and recovery edges', () => {
  it('derives stale and rejected states, replaces ids, and removes vanished files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-index-edge-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const claimPath = join(repoPath, 'claims', 'mutable.md')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(claimPath, claim('claim-old', 'Old claim', 'Old indexed body.'))
    await writeFile(
      join(repoPath, 'observations', 'observation-a.json'),
      `${JSON.stringify({
        schema_version: 1,
        observation_id: 'observation-a',
        title: 'Rejected observation',
        classification: 'private',
        scopes: ['personal'],
        status: 'active',
        provisional: true,
        content: 'Rejected draft body.',
      })}\n`,
    )
    await writeFile(
      join(repoPath, 'resolutions', 'jobs', 'status-job.json'),
      `${JSON.stringify({
        schema_version: 1,
        resolution_id: 'resolution-status',
        classification: 'private',
        scopes: ['personal'],
        status: 'active',
        operations: [
          null,
          { value: 'ignored' },
          { op: 'MARK_STALE', claim_ids: ['claim-old', 4] },
          {
            op: 'REJECT_OBSERVATION',
            observation_ids: ['observation-a', false],
          },
        ],
      })}\n`,
    )
    await writeFile(
      join(repoPath, 'decisions', 'ignored.json'),
      `${JSON.stringify({
        schema_version: 1,
        decision_id: 'decision-ignored',
        decision_type: 'artifact-status',
        target_ids: ['claim-old'],
        target_status: 'superseded',
        reason: 'Invalid user status is ignored.',
        classification: 'private',
        scopes: ['personal'],
        status: 'active',
      })}\n`,
    )

    await indexBrain({ homeDir })
    const stale = await recallBrain({
      homeDir,
      query: 'Old indexed body',
      allowedScopes: ['personal'],
      clearance: 'private',
    })
    assert.equal(stale.entries.find((entry) => entry.id === 'claim-old')?.status, 'stale')
    assert.ok(stale.warnings.some((warning) => warning.includes('claim-old')))
    const rejected = await recallBrain({
      homeDir,
      query: 'Rejected draft body',
      allowedScopes: ['personal'],
      clearance: 'private',
      includeArchived: true,
    })
    assert.ok(rejected.entries.every((entry) => entry.id !== 'observation-a'))

    await writeFile(claimPath, claim('claim-new', 'New claim', 'Replacement body.'))
    const replaced = await indexBrain({ homeDir })
    assert.ok(replaced.indexed > 0)
    assert.deepEqual(
      (
        await recallBrain({
          homeDir,
          query: 'Replacement body',
          allowedScopes: ['personal'],
          clearance: 'private',
        })
      ).entries.map((entry) => entry.id),
      ['claim-new'],
    )
    await rm(claimPath)
    assert.ok((await indexBrain({ homeDir })).removed > 0)
  })

  it('rolls back malformed artifacts and can rebuild after correction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-index-invalid-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const badPath = join(repoPath, 'observations', 'bad.json')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(badPath, '[]\n')
    await assert.rejects(indexBrain({ homeDir }), /must be an object/)
    await writeFile(badPath, '{"classification":"private","scopes":["personal"]}\n')
    await assert.rejects(indexBrain({ homeDir }), /artifact id is missing/)
    await rm(badPath)
    await rm(join(repoPath, 'brain.yaml'))
    await writeFile(join(repoPath, 'observations', 'ignored.txt'), 'ignored')
    await writeFile(
      join(repoPath, 'devices', 'generic.yaml'),
      'id: generic-artifact\nclassification: private\nscopes: [personal]\n',
    )
    assert.ok((await indexBrain({ homeDir })).indexed > 0)
  })
})

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
---

${body}
`
}
