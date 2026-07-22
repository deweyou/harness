import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { defaultRunner, runUnifiedUpdate } from '../src/cli/update.ts'

describe('runUnifiedUpdate', () => {
  it('updates the global CLI before refreshing assets with the updated binary', async () => {
    const calls = []
    const result = await runUnifiedUpdate({}, {
      env: { DEWEYOU_AGENTS_SOURCE: '/tmp/agents-source' },
      platform: 'darwin',
      runner: async (file, args, options) => {
        calls.push({ file, args, env: options?.env })
        if (args[0] === '--version') return { stdout: '1.3.0\n', stderr: '' }
        if (args[0] === 'agent') {
          return {
            stdout: 'Updated Dewey agent assets from abc123\n',
            stderr: '',
          }
        }
        return { stdout: '', stderr: '' }
      },
      logger: () => {},
    })

    assert.deepEqual(calls.map(({ file, args }) => ({ file, args })), [
      {
        file: 'npm',
        args: ['install', '--global', 'deweyou-cli@latest'],
      },
      {
        file: 'deweyou-cli',
        args: ['--version'],
      },
      {
        file: 'deweyou-cli',
        args: ['agent', 'update'],
      },
    ])
    assert.equal(calls[2].env.DEWEYOU_AGENTS_SOURCE, '/tmp/agents-source')
    assert.deepEqual(result, {
      cli: { status: 'updated', version: '1.3.0' },
      agents: { status: 'updated', source: 'abc123' },
    })
  })

  it('supports CLI-only and agents-only updates', async () => {
    const cliCalls = []
    await runUnifiedUpdate({ cliOnly: true }, {
      runner: async (file, args) => {
        cliCalls.push({ file, args })
        return {
          stdout: args[0] === '--version' ? '1.3.0\n' : '',
          stderr: '',
        }
      },
      logger: () => {},
    })
    assert.deepEqual(cliCalls.map(({ args }) => args), [
      ['install', '--global', 'deweyou-cli@latest'],
      ['--version'],
    ])

    const agentCalls = []
    const result = await runUnifiedUpdate({ agentsOnly: true }, {
      runner: async (file, args) => {
        agentCalls.push({ file, args })
        return {
          stdout: args[0] === '--version'
            ? '1.2.0\n'
            : 'Updated Dewey agent assets from local files\n',
          stderr: '',
        }
      },
      logger: () => {},
    })
    assert.deepEqual(agentCalls.map(({ args }) => args), [
      ['--version'],
      ['agent', 'update'],
    ])
    assert.equal(result.cli.status, 'unchanged')
    assert.equal(result.agents.source, 'local files')
  })

  it('prints but does not execute update steps during a dry run', async () => {
    const calls = []
    const messages = []

    const result = await runUnifiedUpdate({ dryRun: true }, {
      runner: async (...args) => {
        calls.push(args)
        return { stdout: '', stderr: '' }
      },
      logger: (message) => messages.push(message),
    })

    assert.deepEqual(calls, [])
    assert.deepEqual(result, {
      cli: { status: 'planned', version: null },
      agents: { status: 'planned', source: null },
    })
    assert.match(messages.join('\n'), /npm install --global deweyou-cli@latest/)
    assert.match(messages.join('\n'), /deweyou-cli agent update/)
  })

  it('uses Windows command shims and reports skipped dry-run stages', async () => {
    const messages = []
    const result = await runUnifiedUpdate({ dryRun: true, agentsOnly: true }, {
      platform: 'win32',
      logger: (message) => messages.push(message),
    })

    assert.deepEqual(result, {
      cli: { status: 'unchanged', version: null },
      agents: { status: 'planned', source: null },
    })
    assert.deepEqual(messages, ['Would run: deweyou-cli.cmd agent update'])
  })

  it('runs subprocesses through the default command runner', async () => {
    const result = await defaultRunner(process.execPath, [
      '-e',
      'process.stdout.write("runner-ok")',
    ])

    assert.equal(result.stdout, 'runner-ok')
    assert.equal(result.stderr, '')
  })

  it('stops before the asset update when the CLI update fails', async () => {
    const calls = []

    await assert.rejects(
      () => runUnifiedUpdate({}, {
        runner: async (file, args) => {
          calls.push({ file, args })
          throw new Error('registry unavailable')
        },
        logger: () => {},
      }),
      /CLI update failed: registry unavailable/,
    )
    assert.equal(calls.length, 1)
  })

  it('reports partial success when asset refresh fails after the CLI update', async () => {
    let callCount = 0

    await assert.rejects(
      () => runUnifiedUpdate({}, {
        runner: async (_file, args) => {
          callCount += 1
          if (args[0] === '--version') return { stdout: '1.3.0\n', stderr: '' }
          if (args[0] === 'agent') throw new Error('source unavailable')
          return { stdout: '', stderr: '' }
        },
        logger: () => {},
      }),
      /CLI 1.3.0 was updated, but agent assets failed to update: source unavailable/,
    )
    assert.equal(callCount, 3)
  })

  it('reports version verification failures after updating or skipping the CLI', async () => {
    for (const agentsOnly of [false, true]) {
      let calls = 0
      await assert.rejects(
        () => runUnifiedUpdate({ agentsOnly }, {
          runner: async (_file, args) => {
            calls += 1
            if (args[0] === '--version') throw 'version unavailable'
            return { stdout: '', stderr: '' }
          },
          logger: () => {},
        }),
        agentsOnly
          ? /left unchanged, but its version could not be verified: version unavailable/
          : /updated, but its version could not be verified: version unavailable/,
      )
      assert.equal(calls, agentsOnly ? 1 : 2)
    }
  })

  it('accepts update output without a recognizable asset source', async () => {
    const messages = []
    const result = await runUnifiedUpdate({ agentsOnly: true }, {
      runner: async (_file, args) => ({
        stdout: args[0] === '--version' ? '\n' : 'Assets refreshed\n',
        stderr: '',
      }),
      logger: (message) => messages.push(message),
    })

    assert.equal(result.cli.version, '')
    assert.equal(result.agents.source, null)
    assert.deepEqual(messages, ['CLI: unchanged', 'Agent assets: updated'])
  })
})
