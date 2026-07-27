import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import {
  parseArgs,
  parseBrainHookArgs,
  parseBrainScheduleArgs,
} from '../src/cli/args.ts'
import { main } from '../src/cli/main.ts'

describe('brain CLI routing', () => {
  it('parses Brain command flags', () => {
    assert.deepEqual(
      parseArgs([
        'brain',
        'init',
        '--repo',
        '/tmp/brain',
        '--device',
        'macbook-a',
        '--remote',
        'git@example.com:brain.git',
      ]),
      {
        topic: 'brain',
        command: 'init',
        flags: {
          repo: '/tmp/brain',
          device: 'macbook-a',
          remote: 'git@example.com:brain.git',
        },
      },
    )
    assert.deepEqual(
      parseArgs(['brain', 'bootstrap', '--agent', 'codex']),
      {
        topic: 'brain',
        command: 'bootstrap',
        flags: { agent: 'codex' },
      },
    )
    assert.deepEqual(
      parseArgs(['brain', 'apply', '--data-file', '/tmp/proposal.json']),
      {
        topic: 'brain',
        command: 'apply',
        flags: { dataFile: '/tmp/proposal.json' },
      },
    )
    assert.deepEqual(
      parseArgs([
        'brain',
        'recall',
        '--query',
        'investment policy',
        '--scope',
        'personal,domain/finance',
        '--clearance',
        'confidential',
        '--budget',
        '1200',
        '--include-archived',
      ]),
      {
        topic: 'brain',
        command: 'recall',
        flags: {
          query: 'investment policy',
          scope: 'personal,domain/finance',
          clearance: 'confidential',
          budget: '1200',
          includeArchived: true,
        },
      },
    )
  })

  it('parses nested hook commands and rejects missing runtime identity', () => {
    assert.deepEqual(
      parseBrainHookArgs(['install', '--agent', 'all', '--dry-run']),
      {
        command: 'install',
        flags: { agent: 'all', dryRun: true },
      },
    )
    assert.deepEqual(
      parseBrainHookArgs([
        'run',
        '--agent',
        'codex',
        '--event',
        'SessionStart',
      ]),
      {
        command: 'run',
        flags: { agent: 'codex', event: 'SessionStart' },
      },
    )
    assert.throws(
      () => parseBrainHookArgs(['run', '--agent', 'all', '--event', 'Stop']),
      /requires one --agent/,
    )
    assert.deepEqual(parseBrainHookArgs(['status', '--agent', 'hermes']), {
      command: 'status',
      flags: { agent: 'hermes' },
    })
    assert.deepEqual(
      parseBrainHookArgs([
        'uninstall',
        '--agent',
        'trae',
        '--repo',
        '/tmp/project',
        '--dry-run',
        '--force',
      ]),
      {
        command: 'uninstall',
        flags: {
          agent: 'trae',
          repo: '/tmp/project',
          dryRun: true,
          force: true,
        },
      },
    )
    assert.deepEqual(
      parseBrainHookArgs([
        'run',
        '--agent',
        'codex',
        '--event',
        'Stop',
        '--data',
        '{}',
      ]),
      {
        command: 'run',
        flags: { agent: 'codex', event: 'Stop', data: '{}' },
      },
    )
    assert.deepEqual(
      parseBrainHookArgs([
        'run',
        '--agent',
        'claude',
        '--event',
        'Stop',
        '--data-file',
        '/tmp/hook.json',
      ]),
      {
        command: 'run',
        flags: {
          agent: 'claude',
          event: 'Stop',
          dataFile: '/tmp/hook.json',
        },
      },
    )
  })

  it('rejects malformed nested hook and schedule arguments', () => {
    for (const argv of [[], ['unknown']]) {
      assert.throws(() => parseBrainHookArgs(argv), /Unknown brain hook command/)
      assert.throws(
        () => parseBrainScheduleArgs(argv),
        /Unknown brain schedule command/,
      )
    }
    assert.throws(
      () => parseBrainHookArgs(['status', 'unexpected']),
      /Unexpected argument/,
    )
    assert.throws(
      () => parseBrainHookArgs(['status', '--unknown']),
      /Unknown flag/,
    )
    assert.throws(
      () => parseBrainHookArgs(['status', '--event', 'Stop']),
      /not valid/,
    )
    assert.throws(
      () => parseBrainHookArgs(['status', '--agent']),
      /Missing value/,
    )
    assert.throws(
      () => parseBrainHookArgs(['run', '--agent', 'codex']),
      /requires one --agent/,
    )
    assert.throws(
      () =>
        parseBrainHookArgs([
          'run',
          '--agent',
          'codex',
          '--event',
          'stop',
          '--data',
          '{}',
          '--data-file',
          '/tmp/hook.json',
        ]),
      /cannot combine/,
    )
    assert.throws(
      () => parseBrainScheduleArgs(['status', 'unexpected']),
      /Unexpected argument/,
    )
    assert.throws(
      () => parseBrainScheduleArgs(['status', '--unknown']),
      /Unknown flag/,
    )
    assert.throws(
      () => parseBrainScheduleArgs(['status', '--interval', '300']),
      /not valid/,
    )
    assert.throws(
      () => parseBrainScheduleArgs(['install', '--interval']),
      /Missing value/,
    )
    assert.deepEqual(parseBrainScheduleArgs(['status']), {
      command: 'status',
      flags: {},
    })
    assert.deepEqual(parseBrainScheduleArgs(['uninstall', '--dry-run']), {
      command: 'uninstall',
      flags: { dryRun: true },
    })
  })

  it('parses import, export, and scheduled worker commands', () => {
    assert.deepEqual(
      parseArgs([
        'brain',
        'import',
        '--discover',
        '--agent',
        'all',
        '--dry-run',
      ]),
      {
        topic: 'brain',
        command: 'import',
        flags: {
          discover: true,
          agent: 'all',
          dryRun: true,
        },
      },
    )
    assert.deepEqual(
      parseArgs([
        'brain',
        'import',
        '--agent',
        'hermes',
        '--path',
        '/tmp/sessions',
        '--classification',
        'private',
      ]),
      {
        topic: 'brain',
        command: 'import',
        flags: {
          agent: 'hermes',
          path: '/tmp/sessions',
          classification: 'private',
        },
      },
    )
    assert.deepEqual(
      parseArgs([
        'brain',
        'export',
        '--output',
        '/tmp/wiki',
        '--clearance',
        'public',
        '--dry-run',
      ]),
      {
        topic: 'brain',
        command: 'export',
        flags: {
          output: '/tmp/wiki',
          clearance: 'public',
          dryRun: true,
        },
      },
    )
    assert.deepEqual(
      parseBrainScheduleArgs(['install', '--interval', '300', '--dry-run']),
      {
        command: 'install',
        flags: { interval: '300', dryRun: true },
      },
    )
    assert.deepEqual(
      parseArgs([
        'brain',
        'state',
        '--id',
        'claim-1',
        '--status',
        'archived',
        '--reason',
        'No longer relevant',
      ]),
      {
        topic: 'brain',
        command: 'state',
        flags: {
          id: 'claim-1',
          status: 'archived',
          reason: 'No longer relevant',
        },
      },
    )
  })

  it('renders Brain help without touching runtime state', async () => {
    const messages: string[] = []
    const original = console.log
    console.log = (message) => messages.push(String(message))
    try {
      await main(['brain', '--help'])
      await main(['brain', 'hook', '--help'])
      await main(['brain', 'schedule', '--help'])
      await main(['brain', 'recall', '--help'])
      await main(['brain', 'hook', 'run', '--help'])
      await main(['brain', 'schedule', 'install', '--help'])
      await main(['brain', 'schedule', 'status', '--help'])
      await main(['brain', 'schedule', 'uninstall', '--help'])
      for (const command of [
        'init',
        'bootstrap',
        'capture',
        'import',
        'export',
        'state',
        'maintain',
        'apply',
        'status',
        'unknown',
      ]) {
        await main(['brain', command, '--help'])
      }
    } finally {
      console.log = original
    }
    assert.match(messages.join('\n'), /brain init/)
    assert.match(messages.join('\n'), /brain hook install/)
    assert.match(messages.join('\n'), /brain schedule install/)
    assert.match(messages.join('\n'), /--clearance/)
  })

  it('routes the public Brain CLI through a temporary knowledge repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-public-cli-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const importPath = join(root, 'history')
    const exportPath = join(root, 'export')
    const codexSessionPath = join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '07',
      '27',
    )
    await mkdir(importPath, { recursive: true })
    await mkdir(codexSessionPath, { recursive: true })
    await writeFile(join(importPath, 'session.jsonl'), '{"message":"history"}\n')
    await writeFile(
      join(codexSessionPath, 'session.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'public-cli-discovery' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Preview native history.',
          },
        }),
      ].join('\n'),
    )
    const previousHome = process.env.HOME
    process.env.HOME = homeDir
    try {
      await silenceLogs(async () => {
        await main([
          'brain',
          'init',
          '--repo',
          repoPath,
          '--device',
          'cli-device',
        ])
        await main(['brain', 'bootstrap', '--agent', 'codex'])
        await main(['brain', 'status'])
        await main([
          'brain',
          'capture',
          '--agent',
          'codex',
          '--event',
          'stop',
          '--data',
          '{"summary":"public route"}',
        ])
        await main([
          'brain',
          'import',
          '--agent',
          'hermes',
          '--path',
          importPath,
        ])
        await main(['brain', 'import', '--discover', '--dry-run'])
        await writeFile(
          join(repoPath, 'claims', 'public-route.md'),
          `---
id: public-route
type: claim
title: Public route
classification: public
scope:
  - personal
status: active
authority: user
confidence: 1
---

The public Brain CLI routes every command.
`,
        )
        await main(['brain', 'index'])
        await main([
          'brain',
          'recall',
          '--query',
          'public Brain CLI',
          '--clearance',
          'public',
        ])
        await main([
          'brain',
          'export',
          '--output',
          exportPath,
          '--clearance',
          'public',
        ])
        await main([
          'brain',
          'state',
          '--id',
          'public-route',
          '--status',
          'stale',
          '--reason',
          'Public routing test.',
        ])
        await main(['brain', 'maintain'])
        await main(['brain', 'sync'])
        await main(['brain', 'worker', '--no-push'])
        await main(['brain', 'hook', 'status', '--agent', 'codex'])
        await main([
          'brain',
          'hook',
          'install',
          '--agent',
          'codex',
          '--dry-run',
        ])
        await main(['brain', 'schedule', 'status'])
        if (platform() === 'darwin') {
          await main([
            'brain',
            'schedule',
            'install',
            '--interval',
            '300',
            '--dry-run',
          ])
        }
        await assert.rejects(main(['brain', 'unknown']))
      })
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
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
