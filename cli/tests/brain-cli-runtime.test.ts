import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import {
  runBrainCapture,
  runBrainApply,
  runBrainBootstrap,
  runBrainExport,
  runBrainHookCommand,
  runBrainImport,
  runBrainIndex,
  runBrainInit,
  runBrainMaintain,
  runBrainRecall,
  runBrainScheduleCommand,
  runBrainState,
  runBrainStatus,
  runBrainSync,
  runBrainWorker,
} from '../src/cli/brain-cli.ts'
import type { BrainInitPrompt } from '../src/cli/brain-cli.ts'

describe('brain CLI runtime commands', () => {
  it('initializes interactively without discovering or importing history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-cli-interactive-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const sessionRoot = join(homeDir, '.codex', 'sessions', '2026', '07', '27')
    await mkdir(sessionRoot, { recursive: true })
    await writeFile(
      join(sessionRoot, 'session.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-07-27T01:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'interactive-session' },
        }),
        JSON.stringify({
          timestamp: '2026-07-27T01:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Import this session.' },
        }),
      ].join('\n'),
    )
    const prompt: BrainInitPrompt = async (input) => {
      assert.equal('discovery' in input, false)
      return {
        repo: repoPath,
        device: 'interactive-device',
        remote: undefined,
        branch: 'main',
      }
    }

    const initialized = await silenceLogs(() =>
      runBrainInit({ homeDir }, { promptForBrainInit: prompt }),
    )

    assert.equal(initialized.config.device_id, 'interactive-device')
    assert.equal('historyImport' in initialized, false)
    assert.equal('hookInstalls' in initialized, false)
  })

  it('runs the local Brain lifecycle through CLI wrappers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-cli-runtime-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const importPath = join(root, 'history')
    const exportPath = join(root, 'projection')
    await mkdir(importPath, { recursive: true })
    await writeFile(join(importPath, 'session.jsonl'), '{"message":"historical idea"}\n')
    const captureFile = join(root, 'capture.json')
    await writeFile(captureFile, '{"summary":"Captured from a file."}')

    await silenceLogs(async () => {
      const plan = await runBrainInit({
        homeDir,
        repo: repoPath,
        device: 'macbook-a',
        dryRun: true,
      })
      assert.equal(plan.dryRun, true)
      await runBrainInit({ homeDir, repo: repoPath, device: 'macbook-a' })
      const capture = await runBrainCapture({
        homeDir,
        agent: 'codex',
        event: 'stop',
        scope: 'personal,domain/reading',
        classification: 'private',
        data: '{"summary":"Remember the reading queue."}',
      })
      assert.equal(capture.status, 'captured')
      assert.equal(
        (
          await runBrainCapture({
            homeDir,
            agent: 'claude',
            event: 'stop',
            dataFile: captureFile,
            quiet: true,
          })
        ).status,
        'captured',
      )
      const imported = await runBrainImport({
        homeDir,
        agent: 'hermes',
        path: importPath,
        classification: 'private',
      })
      assert.equal(imported.captured, 1)
      await writeFile(
        join(repoPath, 'claims', 'reading.md'),
        `---
id: reading-cli
type: claim
title: Reading queue
classification: public
scope: [personal]
status: active
authority: user
confidence: 1
---

Keep a short reading queue.
`,
      )
      assert.ok((await runBrainIndex({ homeDir })).indexed > 0)
      const markdown = await runBrainRecall({
        homeDir,
        query: 'short reading queue',
        scope: 'personal',
        clearance: 'public',
        budget: 200,
      })
      assert.deepEqual(markdown.entries.map((entry) => entry.id), ['reading-cli'])
      const json = await runBrainRecall({
        homeDir,
        query: 'short reading queue',
        scope: 'personal',
        clearance: 'public',
        format: 'json',
      })
      assert.equal(json.entries.length, 1)
      assert.equal(
        (
          await runBrainRecall({
            homeDir,
            query: 'does-not-exist-anywhere',
            format: 'json',
          })
        ).entries.length,
        0,
      )
      const exported = await runBrainExport({
        homeDir,
        output: exportPath,
        scope: 'personal',
        clearance: 'public',
        format: 'knowledge',
      })
      assert.ok(exported.paths.includes('claims/reading.md'))
      assert.equal(
        (
          await runBrainExport({
            homeDir,
            output: join(root, 'projection-plan'),
            dryRun: true,
          })
        ).clearance,
        'public',
      )
      const state = await runBrainState({
        homeDir,
        id: 'reading-cli',
        status: 'archived',
        reason: 'Test lifecycle.',
      })
      assert.equal(state.previousStatus, 'active')
      assert.equal((await runBrainMaintain({ homeDir })).pending, 3)
      assert.equal((await runBrainSync({ homeDir })).status, 'local-only')
      assert.ok('derived' in await runBrainWorker({ homeDir, noPush: true }))
      assert.ok('sync' in await runBrainWorker({ homeDir }))
      const status = await runBrainStatus({ homeDir })
      assert.equal(status.ok, true)
      assert.equal(status.database.exists, true)
      assert.equal(
        (await runBrainScheduleCommand('status', { homeDir })).label,
        'com.deweyou.brain.worker',
      )
      if (platform() === 'darwin') {
        assert.equal(
          (
            await runBrainScheduleCommand('install', {
              homeDir,
              dryRun: true,
            })
          ).detail,
          'planned',
        )
        assert.equal(
          (
            await runBrainScheduleCommand('uninstall', {
              homeDir,
              dryRun: true,
            })
          ).detail,
          'planned removal',
        )
      }
    })
  })

  it('runs hook wrappers and validates CLI input errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-cli-hooks-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const dataFile = join(root, 'hook.json')
    await silenceLogs(() =>
      runBrainInit({ homeDir, repo: repoPath, device: 'macbook-a' }),
    )
    await writeFile(dataFile, '{"cwd":"/tmp/project"}')

    await silenceLogs(async () => {
      const installed = await runBrainHookCommand('install', {
        homeDir,
        agent: 'codex',
      })
      assert.equal('statuses' in installed, true)
      const status = await runBrainHookCommand('status', {
        homeDir,
        agent: 'codex',
      })
      assert.equal(Array.isArray(status), true)
      assert.match(
        JSON.stringify(await runBrainHookCommand('run', {
          homeDir,
          agent: 'codex',
          event: 'Stop',
          dataFile,
        })),
        /Agent Memory Maintenance/,
      )
      assert.match(
        JSON.stringify(await runBrainHookCommand('run', {
          homeDir,
          agent: 'codex',
          event: 'Stop',
          data: '{"summary":"inline hook data"}',
        })),
        /Agent Memory Maintenance/,
      )
      const removed = await runBrainHookCommand('uninstall', {
        homeDir,
        agent: 'codex',
      })
      assert.equal('statuses' in removed, true)
    })

    await assert.rejects(runBrainInit({ homeDir }), /requires --repo/)
    await assert.rejects(runBrainBootstrap({ homeDir }), /requires one --agent/)
    await assert.rejects(
      runBrainBootstrap({ homeDir, agent: 'all' }),
      /requires one --agent/,
    )
    await assert.rejects(
      runBrainBootstrap({ homeDir, agent: 'unknown' }),
      /must be one of/,
    )
    await assert.rejects(
      runBrainMaintain({ homeDir, agent: 'unknown' }),
      /must be one of/,
    )
    await assert.rejects(
      runBrainApply({ homeDir, data: 'not-json' }),
      /valid proposal JSON/,
    )
    await assert.rejects(
      runBrainApply({ homeDir, data: '{}', dataFile }),
      /cannot be used together/,
    )
    await assert.rejects(runBrainCapture({ homeDir }), /requires --agent/)
    await assert.rejects(runBrainImport({ homeDir }), /requires --agent/)
    await assert.rejects(
      runBrainImport({
        homeDir,
        discover: true,
        path: dataFile,
      }),
      /cannot combine/,
    )
    await assert.rejects(
      runBrainImport({
        homeDir,
        agent: 'codex',
        path: dataFile,
        dryRun: true,
      }),
      /requires --discover/,
    )
    await assert.rejects(
      runBrainImport({
        homeDir,
        agent: 'all',
        path: dataFile,
      }),
      /requires --discover/,
    )
    await assert.rejects(runBrainRecall({ homeDir }), /requires --query/)
    await assert.rejects(runBrainExport({ homeDir }), /requires --output/)
    await assert.rejects(
      runBrainExport({ homeDir, output: join(root, 'bad'), format: 'xml' }),
      /wiki or knowledge/,
    )
    await assert.rejects(runBrainState({ homeDir }), /requires --id/)
    await assert.rejects(
      runBrainState({
        homeDir,
        id: 'x',
        status: 'superseded',
        reason: 'bad',
      }),
      /must be one of/,
    )
    await assert.rejects(
      runBrainRecall({ homeDir, query: 'x', budget: 0 }),
      /positive integer/,
    )
    await assert.rejects(
      runBrainCapture({
        homeDir,
        agent: 'codex',
        event: 'stop',
        data: '{}',
        dataFile,
      }),
      /cannot be used together/,
    )
  })
})

async function silenceLogs<T>(work: () => Promise<T>): Promise<T> {
  const original = console.log
  console.log = () => {}
  try {
    return await work()
  } finally {
    console.log = original
  }
}
