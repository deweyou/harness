import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import { recordArtifactStateDecision } from '../src/cli/brain-lifecycle.ts'
import { recallBrain } from '../src/cli/brain-recall.ts'
import { initBrain } from '../src/cli/brain.ts'

describe('brain artifact lifecycle', () => {
  it('uses immutable decisions for soft deletion and restoration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-lifecycle-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })
    await writeFile(
      join(repoPath, 'claims', 'preference.md'),
      `---
id: preference
type: claim
title: Editor preference
classification: private
scope: [personal]
status: active
authority: user
confidence: 1
updated_at: 2026-07-27T00:00:00.000Z
---

Prefer modal editing.
`,
    )

    const deleted = await recordArtifactStateDecision({
      homeDir,
      artifactId: 'preference',
      targetStatus: 'deleted',
      reason: 'Forget this outdated preference.',
      now: new Date('2026-07-27T01:00:00.000Z'),
    })
    assert.equal(deleted.previousStatus, 'active')
    assert.equal(
      (
        await recallBrain({
          homeDir,
          query: 'modal editing',
          allowedScopes: ['personal'],
          clearance: 'private',
        })
      ).entries.length,
      0,
    )

    const restored = await recordArtifactStateDecision({
      homeDir,
      artifactId: 'preference',
      targetStatus: 'active',
      reason: 'Restore after explicit review.',
      now: new Date('2026-07-27T02:00:00.000Z'),
    })
    assert.equal(restored.previousStatus, 'deleted')
    assert.deepEqual(
      (
        await recallBrain({
          homeDir,
          query: 'modal editing',
          allowedScopes: ['personal'],
          clearance: 'private',
        })
      ).entries.map((entry) => entry.id),
      ['preference'],
    )
    await recordArtifactStateDecision({
      homeDir,
      artifactId: 'preference',
      targetStatus: 'archived',
      reason: 'Keep only for history.',
      now: new Date('2026-07-27T03:00:00.000Z'),
    })
    assert.equal(
      (
        await recallBrain({
          homeDir,
          query: 'modal editing',
          allowedScopes: ['personal'],
          clearance: 'private',
        })
      ).entries.length,
      0,
    )
    assert.deepEqual(
      (
        await recallBrain({
          homeDir,
          query: 'modal editing',
          allowedScopes: ['personal'],
          clearance: 'private',
          includeArchived: true,
        })
      ).entries.map((entry) => entry.id),
      ['preference'],
    )
    await assert.rejects(
      recordArtifactStateDecision({
        homeDir,
        artifactId: '',
        targetStatus: 'stale',
        reason: 'bad',
      }),
      /requires an artifact id/,
    )
    await assert.rejects(
      recordArtifactStateDecision({
        homeDir,
        artifactId: 'preference',
        targetStatus: 'stale',
        reason: '',
      }),
      /requires a reason/,
    )
    await assert.rejects(
      recordArtifactStateDecision({
        homeDir,
        artifactId: 'missing',
        targetStatus: 'stale',
        reason: 'missing',
      }),
      /not found/,
    )
    await assert.rejects(
      recordArtifactStateDecision({
        homeDir,
        artifactId: restored.decisionId,
        targetStatus: 'stale',
        reason: 'invalid target',
      }),
      /cannot target another decision/,
    )
  })
})
