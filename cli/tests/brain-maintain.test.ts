import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import yaml from 'js-yaml'

import { brainPaths } from '../src/cli/brain-config.ts'
import {
  applyBrainMaintenanceProposal,
  maintainBrain,
  prepareBrainMaintenance,
} from '../src/cli/brain-maintain.ts'
import { captureBrainEvent, initBrain } from '../src/cli/brain.ts'
import type { ResolutionProposal } from '../src/cli/brain-types.ts'

describe('brain agent-driven maintenance', () => {
  it('materializes observations without invoking a model provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-none-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      payload: { summary: 'Use deterministic jobs.' },
      idFactory: () => 'pending-event',
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    assert.deepEqual(await maintainBrain({ homeDir }), {
      processed: 0,
      observed: 1,
      resolved: 0,
      pending: 1,
    })
    assert.match(
      await readFile(
        join(
          repoPath,
          'observations/device-a/2026/07',
          'observation_fda11b94d57fb3cf0d191a4d.json',
        ),
        'utf8',
      ),
      /Use deterministic jobs/,
    )
  })

  it('filters pending jobs by active agent and session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-filter-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      sessionId: 'session-a',
      idFactory: () => 'codex-a',
    })
    await captureBrainEvent({
      homeDir,
      agent: 'hermes',
      eventType: 'agent-end',
      sessionId: 'session-b',
      idFactory: () => 'hermes-b',
    })

    const prepared = await prepareBrainMaintenance({
      homeDir,
      agent: 'codex',
      sessionId: 'session-a',
    })
    assert.equal(prepared.pending, 1)
    assert.equal(prepared.jobs[0].agent, 'codex')
    assert.match(prepared.prompt, /current agent model/)
    assert.equal((await readdir(brainPaths(homeDir).queueRoot)).length, 2)
  })

  it('ignores legacy command-provider configuration in deterministic preparation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-legacy-'))
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
      agent: 'hermes',
      eventType: 'agent-end',
      idFactory: () => 'legacy-provider',
    })

    assert.equal((await prepareBrainMaintenance({ homeDir })).pending, 1)
    await assert.rejects(readFile(markerPath, 'utf8'), /ENOENT/)
  })

  it('rejects non-agent or mismatched proposals without removing the job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-apply-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const captured = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      idFactory: () => 'apply-event',
    })
    const prepared = await prepareBrainMaintenance({ homeDir })
    const proposal = proposalFor({
      jobId: prepared.jobs[0].job_id,
      eventId: captured.event!.event_id,
      observationId: prepared.jobs[0].observation_id,
    })

    await assert.rejects(
      applyBrainMaintenanceProposal({
        homeDir,
        proposal: { ...proposal, provider: 'command' },
      }),
      /provider must be agent-hook/,
    )
    await assert.rejects(
      applyBrainMaintenanceProposal({
        homeDir,
        proposal: { ...proposal, device_id: 'other-device' },
      }),
      /does not match pending job/,
    )
    for (const mismatch of [
      { ...proposal, policy_version: 'v2' },
      { ...proposal, input_classification: 'confidential' as const },
      { ...proposal, input_ids: ['event_other'] },
      { ...proposal, evidence_refs: ['event_other'] },
    ]) {
      await assert.rejects(
        applyBrainMaintenanceProposal({ homeDir, proposal: mismatch }),
        /does not match pending job/,
      )
    }
    await assert.rejects(
      applyBrainMaintenanceProposal({
        homeDir,
        proposal: { ...proposal, job_id: 'missing-job' },
      }),
      /is not pending/,
    )
    await assert.rejects(
      applyBrainMaintenanceProposal({
        homeDir,
        proposal: { ...proposal, job_id: 'valid:but-not-a-filename' },
      }),
      /job id is invalid/,
    )
    assert.equal((await readdir(brainPaths(homeDir).queueRoot)).length, 1)
  })

  it('skips unrelated queue entries and handles a missing queue directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-edge-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      join(brainPaths(homeDir).queueRoot, 'ignored.json'),
      '{"kind":"other"}\n',
    )
    await writeFile(
      join(brainPaths(homeDir).queueRoot, 'ignored.txt'),
      'not a queue record\n',
    )

    assert.deepEqual(await maintainBrain({ homeDir }), {
      processed: 0,
      observed: 0,
      resolved: 0,
      pending: 0,
    })
    await rm(brainPaths(homeDir).queueRoot, { recursive: true })
    assert.deepEqual(await maintainBrain({ homeDir }), {
      processed: 0,
      observed: 0,
      resolved: 0,
      pending: 0,
    })
  })

  it('surfaces malformed maintenance queue entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-malformed-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const queueRoot = brainPaths(homeDir).queueRoot

    await writeFile(join(queueRoot, 'invalid.json'), 'not-json')
    await assert.rejects(prepareBrainMaintenance({ homeDir }), /Unexpected token/)
    await rm(join(queueRoot, 'invalid.json'))
    await writeFile(
      join(queueRoot, 'missing-id.json'),
      JSON.stringify({ kind: 'maintain-event', event_path: 'missing.json' }),
    )
    await assert.rejects(
      prepareBrainMaintenance({ homeDir }),
      /ENOENT/,
    )
  })

  it('rejects missing job identity and unexpected queue filesystem errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-invalid-job-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    const captured = await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      idFactory: () => 'invalid-job',
    })
    const job = JSON.parse(await readFile(captured.jobPath!, 'utf8')) as {
      job_id?: string
    }

    delete job.job_id
    await writeFile(captured.jobPath!, JSON.stringify(job))
    await assert.rejects(prepareBrainMaintenance({ homeDir }), /job\.job_id/)
    job.job_id = ''
    await writeFile(captured.jobPath!, JSON.stringify(job))
    await assert.rejects(prepareBrainMaintenance({ homeDir }), /job\.job_id/)

    const queueRoot = brainPaths(homeDir).queueRoot
    await rm(queueRoot, { recursive: true })
    await writeFile(queueRoot, 'not a directory')
    await assert.rejects(prepareBrainMaintenance({ homeDir }), /ENOTDIR/)
  })
})

function proposalFor({
  jobId,
  eventId,
  observationId,
}: {
  jobId: string
  eventId: string
  observationId: string
}): ResolutionProposal {
  return {
    schema_version: 1,
    job_id: jobId,
    device_id: 'device-a',
    created_at: '2026-07-27T00:01:00.000Z',
    policy_version: 'v1',
    provider: 'agent-hook',
    model: 'current-agent-model',
    prompt_version: 'agent-maintenance-v1',
    confidence: 0.9,
    input_ids: [eventId],
    input_classification: 'private',
    evidence_refs: [eventId],
    operations: [
      {
        op: 'REJECT_OBSERVATION',
        observation_ids: [observationId],
        reason: 'No durable memory.',
      },
    ],
  }
}
