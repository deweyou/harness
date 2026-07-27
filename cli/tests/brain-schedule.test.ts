import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import {
  installBrainSchedule,
  scheduleStatus,
  uninstallBrainSchedule,
  withBrainWorkerLock,
} from '../src/cli/brain-schedule.ts'

describe('brain scheduled worker', () => {
  it('reports unsupported platforms without mutating state', async () => {
    if (platform() === 'darwin') return
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-schedule-'))
    const status = await scheduleStatus(root, false)
    assert.equal(status.supported, false)
    await assert.rejects(
      installBrainSchedule({ homeDir: root, activate: false }),
      /macOS launchd/,
    )
  })

  it('writes a reversible launchd job without invoking launchctl in tests', async () => {
    if (platform() !== 'darwin') return
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-schedule-'))
    const command = ['/usr/local/bin/deweyou-cli', 'brain', 'worker']
    const plan = await installBrainSchedule({
      homeDir: root,
      dryRun: true,
    })
    assert.equal(plan.detail, 'planned')
    await assert.rejects(
      installBrainSchedule({
        homeDir: root,
        intervalSeconds: 30,
        activate: false,
      }),
      /60-86400/,
    )
    const installed = await installBrainSchedule({
      homeDir: root,
      intervalSeconds: 180,
      command,
      activate: false,
    })
    assert.equal(installed.installed, true)
    assert.equal(installed.active, false)
    assert.equal(installed.intervalSeconds, 180)
    assert.match(await readFile(installed.path, 'utf8'), /StartInterval/)
    assert.match(await readFile(installed.path, 'utf8'), /deweyou-cli/)
    assert.equal((await scheduleStatus(root, true)).active, false)
    await writeFile(
      join(root, '.deweyou', 'brain', 'schedule.json'),
      '{"interval_seconds":"bad","command":[3]}\n',
    )
    assert.deepEqual((await scheduleStatus(root, false)).command, [])

    const removalPlan = await uninstallBrainSchedule({
      homeDir: root,
      dryRun: true,
      activate: false,
    })
    assert.equal(removalPlan.detail, 'planned removal')
    const removed = await uninstallBrainSchedule({
      homeDir: root,
      activate: false,
    })
    assert.equal(removed.installed, false)
  })

  it('prevents overlapping workers and releases the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-lock-'))
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const acquired = new Promise<void>((resolve) => {
      entered = resolve
    })
    const first = withBrainWorkerLock(root, async () => {
      entered()
      await waiting
      return 'done'
    })
    await acquired
    const second = await withBrainWorkerLock(root, async () => 'unexpected')
    assert.deepEqual(second, { skipped: true, reason: 'worker already running' })
    release()
    assert.equal(await first, 'done')
    assert.equal(await withBrainWorkerLock(root, async () => 'next'), 'next')

    const staleLock = join(root, '.deweyou', 'brain', 'locks', 'worker')
    await mkdir(staleLock, { recursive: true })
    const stale = new Date(Date.now() - 31 * 60 * 1000)
    await utimes(staleLock, stale, stale)
    assert.equal(await withBrainWorkerLock(root, async () => 'recovered'), 'recovered')
  })
})
