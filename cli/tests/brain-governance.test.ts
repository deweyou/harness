import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import { initBrain } from '../src/cli/brain.ts'
import {
  applyResolutionProposal,
  validateResolutionProposal,
} from '../src/cli/brain-governance.ts'
import { indexBrain } from '../src/cli/brain-index.ts'
import { recallBrain } from '../src/cli/brain-recall.ts'
import { compileWiki } from '../src/cli/brain-wiki.ts'

describe('brain governance', () => {
  it('accepts only structured operations and rejects model downgrades', () => {
    assert.throws(
      () =>
        validateResolutionProposal({
          schema_version: 1,
          job_id: 'job-1',
          device_id: 'device-a',
          created_at: '2026-07-27T00:00:00.000Z',
          policy_version: 'v1',
          provider: 'test',
          model: 'test',
          prompt_version: 'v1',
          confidence: 0.9,
          input_ids: ['observation-1'],
          input_classification: 'confidential',
          evidence_refs: ['source-1'],
          operations: [
            {
              op: 'ADD_CLAIM',
              claim: {
                title: 'Unsafe downgrade',
                body: 'Derived from confidential input.',
                classification: 'public',
                scopes: ['personal'],
                authority: 'model',
                confidence: 0.9,
              },
            },
          ],
        }),
      /may not lower classification/,
    )

    assert.throws(
      () =>
        validateResolutionProposal({
          schema_version: 1,
          job_id: 'job-2',
          device_id: 'device-a',
          created_at: '2026-07-27T00:00:00.000Z',
          policy_version: 'v1',
          provider: 'test',
          model: 'test',
          prompt_version: 'v1',
          confidence: 0.9,
          input_ids: ['observation-1'],
          input_classification: 'private',
          evidence_refs: ['source-1'],
          operations: [{ op: 'EDIT_WIKI', body: 'free-form edit' }],
        } as never),
      /Unsupported resolution operation/,
    )

    const base = {
      schema_version: 1 as const,
      job_id: 'job-valid-ops',
      device_id: 'device-a',
      created_at: '2026-07-27T00:00:00.000Z',
      policy_version: 'v1',
      provider: 'test',
      model: 'test',
      prompt_version: 'v1',
      confidence: 0.9,
      input_ids: ['observation-1'],
      input_classification: 'private' as const,
      evidence_refs: ['source-1'],
    }
    assert.doesNotThrow(() =>
      validateResolutionProposal({
        ...base,
        operations: [
          { op: 'SPLIT_SCOPE', scopes: ['personal'] },
          { op: 'LINK_ENTITIES', entities: ['entity-a'] },
          {
            op: 'REQUEST_HUMAN_DECISION',
            reason: 'Conflicting user statements.',
          },
        ],
      }),
    )
    for (const [operation, pattern] of [
      [{ op: 'ADD_CLAIM' }, /requires claim/],
      [
        {
          op: 'MERGE_CLAIMS',
          claim: {
            title: 'Merged',
            body: 'Body',
            classification: 'private',
            scopes: ['personal'],
            authority: 'model',
            confidence: 0.8,
          },
        },
        /requires claim and claim_ids/,
      ],
      [{ op: 'MARK_STALE' }, /requires claim_ids/],
      [{ op: 'REJECT_OBSERVATION' }, /requires observation_ids/],
      [{ op: 'REQUEST_HUMAN_DECISION' }, /requires reason/],
    ] as const) {
      assert.throws(
        () =>
          validateResolutionProposal({
            ...base,
            job_id: `job-${String(operation.op).toLowerCase()}`,
            operations: [operation] as never,
          }),
        pattern,
      )
    }
  })

  it('applies immutable proposals idempotently and compiles classified Wiki pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-governance-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })

    const proposal = {
      schema_version: 1 as const,
      job_id: 'job-finance-1',
      device_id: 'device-a',
      created_at: '2026-07-27T10:00:00.000Z',
      policy_version: 'v1',
      provider: 'test-provider',
      model: 'test-model',
      prompt_version: 'v1',
      confidence: 0.92,
      input_ids: ['event-1'],
      input_classification: 'confidential' as const,
      evidence_refs: ['source-1'],
      operations: [
        {
          op: 'ADD_CLAIM' as const,
          claim: {
            title: 'Investment principle',
            body: 'Prefer diversified index funds for long-term allocation.',
            classification: 'confidential' as const,
            scopes: ['personal', 'domain/finance'],
            authority: 'user',
            confidence: 0.92,
          },
        },
      ],
    }

    const first = await applyResolutionProposal({ homeDir, proposal })
    const second = await applyResolutionProposal({ homeDir, proposal })
    assert.equal(first.resolutionPath, second.resolutionPath)
    assert.equal(first.claimPaths.length, 1)
    assert.equal(await stat(first.claimPaths[0]).then(() => true), true)
    assert.match(await readFile(first.claimPaths[0], 'utf8'), /classification: confidential/)

    const compiled = await compileWiki({ homeDir })
    assert.ok(compiled.pages.some((path) => path.endsWith('wiki/domains/finance/index.md')))
    const financePage = await readFile(
      join(repoPath, 'wiki/domains/finance/index.md'),
      'utf8',
    )
    assert.match(financePage, /classification: confidential/)
    assert.match(financePage, /Investment principle/)
    assert.match(financePage, /Prefer diversified index funds/)

    await indexBrain({ homeDir })
    const visible = await recallBrain({
      homeDir,
      query: 'diversified index funds',
      clearance: 'confidential',
      allowedScopes: ['domain/finance'],
    })
    assert.ok(visible.entries.some((entry) => entry.type === 'claim'))
    const hidden = await recallBrain({
      homeDir,
      query: 'diversified index funds',
      clearance: 'private',
      allowedScopes: ['domain/finance'],
    })
    assert.equal(hidden.entries.length, 0)
  })

  it('keeps supersession in resolutions and derives effective status in the local index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-status-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })

    const added = await applyResolutionProposal({
      homeDir,
      proposal: {
        schema_version: 1,
        job_id: 'job-old',
        device_id: 'device-a',
        created_at: '2026-07-27T09:00:00.000Z',
        policy_version: 'v1',
        provider: 'test',
        model: 'test',
        prompt_version: 'v1',
        confidence: 0.8,
        input_ids: ['event-old'],
        input_classification: 'private',
        evidence_refs: ['source-old'],
        operations: [
          {
            op: 'ADD_CLAIM',
            claim: {
              id: 'claim-old',
              title: 'Old device path',
              body: 'The repository is at an obsolete location.',
              classification: 'private',
              scopes: ['device/device-a'],
              authority: 'observed',
              confidence: 0.8,
            },
          },
        ],
      },
    })
    assert.equal(added.claimIds[0], 'claim-old')

    await applyResolutionProposal({
      homeDir,
      proposal: {
        schema_version: 1,
        job_id: 'job-new',
        device_id: 'device-a',
        created_at: '2026-07-27T10:00:00.000Z',
        policy_version: 'v1',
        provider: 'test',
        model: 'test',
        prompt_version: 'v1',
        confidence: 0.95,
        input_ids: ['event-new', 'claim-old'],
        input_classification: 'private',
        evidence_refs: ['source-new'],
        operations: [
          {
            op: 'SUPERSEDE_CLAIM',
            claim_ids: ['claim-old'],
            claim: {
              id: 'claim-new',
              title: 'Current device path',
              body: 'The repository is now at the current location.',
              classification: 'private',
              scopes: ['device/device-a'],
              authority: 'observed',
              confidence: 0.95,
            },
          },
        ],
      },
    })

    await indexBrain({ homeDir })
    const old = await recallBrain({
      homeDir,
      query: 'obsolete location',
      clearance: 'private',
      allowedScopes: ['device/device-a'],
    })
    assert.ok(old.entries.every((entry) => entry.id !== 'claim-old'))
    const current = await recallBrain({
      homeDir,
      query: 'current location',
      clearance: 'private',
      allowedScopes: ['device/device-a'],
    })
    assert.ok(current.entries.some((entry) => entry.id === 'claim-new'))
  })

  it('rejects policy drift and conflicting canonical proposals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-resolution-conflict-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const proposal = {
      schema_version: 1 as const,
      job_id: 'job-conflict',
      device_id: 'device-a',
      created_at: '2026-07-27T00:00:00.000Z',
      policy_version: 'v1',
      provider: 'test',
      model: 'test',
      prompt_version: 'v1',
      confidence: 0.9,
      input_ids: ['event-1'],
      input_classification: 'private' as const,
      evidence_refs: ['event-1'],
      operations: [
        {
          op: 'ADD_CLAIM' as const,
          claim: {
            id: 'claim-conflict',
            title: 'First',
            body: 'First body.',
            classification: 'private' as const,
            scopes: ['personal'],
            authority: 'model',
            confidence: 0.9,
          },
        },
      ],
    }
    await applyResolutionProposal({ homeDir, proposal })
    await assert.rejects(
      applyResolutionProposal({
        homeDir,
        proposal: {
          ...proposal,
          device_id: 'device-b',
          operations: [
            {
              ...proposal.operations[0],
              claim: { ...proposal.operations[0].claim, id: 'claim-other' },
            },
          ],
        },
      }),
      /different canonical resolution/,
    )
    await assert.rejects(
      applyResolutionProposal({
        homeDir,
        proposal: {
          ...proposal,
          job_id: 'job-policy-drift',
          policy_version: 'v2',
        },
      }),
      /does not match configured/,
    )

    for (const invalid of [
      { ...proposal, schema_version: 2 },
      { ...proposal, job_id: 'bad id' },
      { ...proposal, operations: [] },
      { ...proposal, confidence: 2 },
      { ...proposal, input_ids: [3] },
    ]) {
      assert.throws(
        () => validateResolutionProposal(invalid as never),
      )
    }

    await applyResolutionProposal({
      homeDir,
      proposal: {
        ...proposal,
        job_id: 'job-no-claim',
        device_id: 'device-a',
        operations: [{ op: 'SPLIT_SCOPE', scopes: ['project/demo'] }],
      },
    })
    assert.equal(
      JSON.parse(
        await readFile(
          join(repoPath, 'resolutions/jobs/job-no-claim.json'),
          'utf8',
        ),
      ).scopes[0],
      'project/demo',
    )
  })
})
