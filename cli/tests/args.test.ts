import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { parseArgs, parseDevSessionArgs, parseUpdateArgs } from '../src/cli/args.ts'
import { main } from '../src/cli/main.ts'

describe('parseArgs', () => {
  it('parses root update flags', () => {
    assert.deepEqual(parseUpdateArgs(['--dry-run']), {
      dryRun: true,
    })
    assert.deepEqual(parseUpdateArgs(['--cli-only']), {
      cliOnly: true,
    })
    assert.deepEqual(parseUpdateArgs(['--agents-only']), {
      agentsOnly: true,
    })
  })

  it('parses explicit task session commands', () => {
    assert.deepEqual(
      parseDevSessionArgs(['start', '--title', 'Implement update flow']),
      { command: 'start', flags: { title: 'Implement update flow' } },
    )
    assert.deepEqual(
      parseDevSessionArgs(['clean', '--id', 'task-1', '--force']),
      { command: 'clean', flags: { id: 'task-1', force: true } },
    )
    assert.throws(
      () => parseDevSessionArgs(['clean', '--id', 'task-1', '--all']),
      /cannot be used together/,
    )
    assert.deepEqual(
      parseDevSessionArgs(['clean', '--all', '--dry-run']),
      { command: 'clean', flags: { all: true, dryRun: true } },
    )
  })

  it('rejects malformed task session arguments', () => {
    assert.throws(() => parseDevSessionArgs([]), /missing/)
    assert.throws(() => parseDevSessionArgs(['unknown']), /unknown/)
    assert.throws(() => parseDevSessionArgs(['list', 'extra']), /Unexpected argument/)
    assert.throws(() => parseDevSessionArgs(['list', '--unknown']), /Unknown flag/)
    assert.throws(() => parseDevSessionArgs(['list', '--id', 'task-1']), /not valid/)
    assert.throws(() => parseDevSessionArgs(['start', '--title']), /Missing value/)
    assert.throws(() => parseDevSessionArgs(['status', '--id', '--force']), /Missing value/)
  })

  it('rejects incompatible root update flags', () => {
    assert.throws(
      () => parseUpdateArgs(['--cli-only', '--agents-only']),
      /cannot be used together/,
    )
    assert.throws(
      () => parseUpdateArgs(['--yes']),
      /Unknown flag: --yes/,
    )
    assert.throws(() => parseUpdateArgs(['latest']), /Unexpected argument/)
  })

  it('parses agent init flags', () => {
    assert.deepEqual(
      parseArgs(['agent', 'init', '--all', '--mode', 'link', '--yes']),
      {
        topic: 'agent',
        command: 'init',
        flags: {
          all: true,
          mode: 'link',
          yes: true,
        },
      },
    )
  })

  it('parses the global init shortcut', () => {
    assert.deepEqual(
      parseArgs(['agent', 'init', '--global', '--skills', 'repo-memory', '--yes']),
      {
        topic: 'agent',
        command: 'init',
        flags: {
          global: true,
          skills: ['repo-memory'],
          yes: true,
        },
      },
    )
  })

  it('parses comma-separated asset lists', () => {
    assert.deepEqual(
      parseArgs([
        'agent',
        'init',
        '--skills',
        'code-knowledge,deweyou-design',
        '--rules',
        'code-style',
      ]),
      {
        topic: 'agent',
        command: 'init',
        flags: {
          skills: ['code-knowledge', 'deweyou-design'],
          rules: ['code-style'],
        },
      },
    )
  })

  it('parses a selected design contract', () => {
    assert.deepEqual(
      parseArgs(['agent', 'init', '--design', 'dewey-interface']),
      {
        topic: 'agent',
        command: 'init',
        flags: {
          design: 'dewey-interface',
        },
      },
    )
  })

  it('parses scope, tools, and rule wiring for agent init', () => {
    assert.deepEqual(
      parseArgs([
        'agent',
        'init',
        '--scope',
        'global',
        '--tools',
        'codex,claude',
        '--rule-wiring',
        'inline',
        '--rules',
        'code-style',
        '--yes',
      ]),
      {
        topic: 'agent',
        command: 'init',
        flags: {
          scope: 'global',
          tools: ['codex', 'claude'],
          ruleWiring: 'inline',
          rules: ['code-style'],
          yes: true,
        },
      },
    )
  })

  it('defaults context format to markdown', () => {
    assert.deepEqual(
      parseArgs(['agent', 'context']),
      {
        topic: 'agent',
        command: 'context',
        flags: {
          format: 'markdown',
        },
      },
    )
  })

  it('parses dev command flags', () => {
    assert.deepEqual(
      parseArgs(['dev', 'install', '--dry-run']),
      {
        topic: 'dev',
        command: 'install',
        flags: {
          dryRun: true,
        },
      },
    )

    assert.deepEqual(
      parseArgs(['dev', 'clean', '--branch', 'feature/demo']),
      {
        topic: 'dev',
        command: 'clean',
        flags: {
          branch: 'feature/demo',
        },
      },
    )

    assert.deepEqual(
      parseArgs(['dev', 'clean', '--all', '--dry-run']),
      {
        topic: 'dev',
        command: 'clean',
        flags: {
          all: true,
          dryRun: true,
        },
      },
    )

    assert.deepEqual(
      parseArgs([
        'dev',
        'demo',
        '--branch',
        'feature/demo',
        '--host',
        '0.0.0.0',
        '--port',
        '0',
        '--no-server',
      ]),
      {
        topic: 'dev',
        command: 'demo',
        flags: {
          branch: 'feature/demo',
          host: '0.0.0.0',
          port: '0',
          noServer: true,
        },
      },
    )

    assert.deepEqual(
      parseArgs(['dev', 'uninstall', '--dry-run']),
      {
        topic: 'dev',
        command: 'uninstall',
        flags: {
          dryRun: true,
        },
      },
    )

    assert.deepEqual(
      parseArgs([
        'dev',
        'record',
        '--branch',
        'feature/demo',
        '--kind',
        'node',
        '--data',
        '{"node_id":"implement","node_type":"implementation","status":"completed"}',
      ]),
      {
        topic: 'dev',
        command: 'record',
        flags: {
          branch: 'feature/demo',
          kind: 'node',
          data: '{"node_id":"implement","node_type":"implementation","status":"completed"}',
        },
      },
    )

    assert.deepEqual(
      parseArgs(['dev', 'summary', '--branch', 'feature/demo', '--format', 'json']),
      {
        topic: 'dev',
        command: 'summary',
        flags: {
          branch: 'feature/demo',
          format: 'json',
        },
      },
    )
  })

  it('rejects context flags that belong to init', () => {
    assert.throws(
      () => parseArgs(['agent', 'context', '--all']),
      /Flag --all is not valid for agent context/,
    )

    assert.throws(
      () => parseArgs(['agent', 'context', '--scope', 'global']),
      /Flag --scope is not valid for agent context/,
    )
  })

  it('rejects dev flags on the wrong dev commands', () => {
    assert.throws(
      () => parseArgs(['dev', 'status', '--dry-run']),
      /Flag --dry-run is not valid for dev status/,
    )

    assert.throws(
      () => parseArgs(['dev', 'doctor', '--branch', 'main']),
      /Flag --branch is not valid for dev doctor/,
    )

    assert.throws(
      () => parseArgs(['dev', 'clean', '--legacy']),
      /Unknown flag: --legacy/,
    )

    assert.throws(
      () => parseArgs(['dev', 'record', '--format', 'json']),
      /Flag --format is not valid for dev record/,
    )
  })

  it('rejects update and doctor flags', () => {
    assert.throws(
      () => parseArgs(['agent', 'update', '--yes']),
      /Flag --yes is not valid for agent update/,
    )

    assert.throws(
      () => parseArgs(['agent', 'doctor', '--format', 'json']),
      /Flag --format is not valid for agent doctor/,
    )
  })

  it('rejects malformed flag arguments', () => {
    assert.throws(
      () => parseArgs(['agent', 'init', 'all']),
      /Unexpected argument: all/,
    )

    assert.throws(
      () => parseArgs(['agent', 'init', '--unknown']),
      /Unknown flag: --unknown/,
    )

    assert.throws(
      () => parseArgs(['agent', 'init', '--mode']),
      /Missing value for --mode/,
    )

    assert.throws(
      () => parseArgs(['agent', 'init', '--mode', '--yes']),
      /Missing value for --mode/,
    )

    assert.throws(
      () => parseArgs(['agent', 'init', '--tools']),
      /Missing value for --tools/,
    )

    assert.throws(
      () => parseArgs(['agent', undefined, '--all']),
      /Flag --all is not valid for agent undefined/,
    )

    assert.throws(
      () => parseArgs(['agent', 'unknown', '--all']),
      /Flag --all is not valid for agent unknown/,
    )
  })
})

describe('main', () => {
  it('rejects invalid topics with usage exit code', async () => {
    const output = await captureLog(async () => {
      await assert.rejects(
        () => main(['nope']),
        (error) => error.exitCode === 2,
      )
    })

    assert.match(output, /Usage:/)
  })

  it('rejects invalid agent commands with usage exit code', async () => {
    const output = await captureLog(async () => {
      await assert.rejects(
        () => main(['agent', 'nope']),
        (error) => error.exitCode === 2,
      )
    })

    assert.match(output, /Usage:/)
  })

  it('prints top-level help for -h and --help', async () => {
    const shortOutput = await captureLog(() => main(['-h']))
    const longOutput = await captureLog(() => main(['--help']))

    assert.match(shortOutput, /Usage:/)
    assert.match(shortOutput, /deweyou-cli agent <command>/)
    assert.match(shortOutput, /deweyou-cli dev <command>/)
    assert.match(shortOutput, /deweyou-cli update/)
    assert.equal(longOutput, shortOutput)
  })

  it('prints root update help', async () => {
    const output = await captureLog(() => main(['update', '-h']))

    assert.match(output, /deweyou-cli update \[--dry-run\]/)
    assert.match(output, /--cli-only/)
    assert.match(output, /--agents-only/)
  })

  it('prints top-level help for unknown help topics', async () => {
    const output = await captureLog(() => main(['nope', '-h']))

    assert.match(output, /Usage:/)
    assert.match(output, /deweyou-cli agent <command>/)
  })

  it('prints agent help for nested -h', async () => {
    const output = await captureLog(() => main(['agent', '-h']))

    assert.match(output, /Usage:/)
    assert.match(output, /deweyou-cli agent init/)
    assert.match(output, /deweyou-cli agent doctor/)
    assert.doesNotMatch(output, /deweyou-cli agent skills/)
  })

  it('prints command help for nested command -h', async () => {
    const output = await captureLog(() => main(['agent', 'init', '-h']))

    assert.match(output, /Usage:/)
    assert.match(output, /deweyou-cli agent init \[--all\]/)
    assert.match(output, /--rule-wiring reference\|inline/)
  })

  it('prints command help for every agent command', async () => {
    const contextOutput = await captureLog(() => main(['agent', 'context', '-h']))
    const updateOutput = await captureLog(() => main(['agent', 'update', '-h']))
    const doctorOutput = await captureLog(() => main(['agent', 'doctor', '-h']))

    assert.match(contextOutput, /deweyou-cli agent context \[--format markdown\|json\]/)
    assert.match(updateOutput, /deweyou-cli agent update/)
    assert.match(doctorOutput, /deweyou-cli agent doctor/)
  })

  it('prints dev help and command help', async () => {
    const devOutput = await captureLog(() => main(['dev', '-h']))
    const installOutput = await captureLog(() => main(['dev', 'install', '-h']))
    const cleanOutput = await captureLog(() => main(['dev', 'clean', '-h']))
    const statusOutput = await captureLog(() => main(['dev', 'status', '-h']))
    const doctorOutput = await captureLog(() => main(['dev', 'doctor', '-h']))
    const demoOutput = await captureLog(() => main(['dev', 'demo', '-h']))
    const uninstallOutput = await captureLog(() => main(['dev', 'uninstall', '-h']))
    const unknownOutput = await captureLog(() => main(['dev', 'unknown', '-h']))

    assert.match(devOutput, /deweyou-cli dev install \[--dry-run\]/)
    assert.match(devOutput, /deweyou-cli dev session start/)
    assert.match(devOutput, /deweyou-cli dev clean/)
    assert.match(devOutput, /deweyou-cli dev demo/)
    assert.match(devOutput, /deweyou-cli dev uninstall/)
    assert.match(installOutput, /deweyou-cli dev install \[--dry-run\]/)
    assert.match(cleanOutput, /--branch name/)
    assert.doesNotMatch(cleanOutput, /--legacy/)
    assert.match(statusOutput, /deweyou-cli dev status/)
    assert.match(doctorOutput, /deweyou-cli dev doctor/)
    assert.match(demoOutput, /--no-server/)
    assert.match(demoOutput, /--port port/)
    assert.match(uninstallOutput, /deweyou-cli dev uninstall \[--dry-run\]/)
    assert.match(unknownOutput, /deweyou-cli dev <command> -h/)
  })

  it('prints task session help', async () => {
    const output = await captureLog(() => main(['dev', 'session', '-h']))
    const clean = await captureLog(() => main(['dev', 'session', 'clean', '-h']))

    assert.match(output, /dev session start --title/)
    assert.match(output, /dev session archive/)
    assert.match(clean, /--force/)
  })

  it('prints scoped help for unknown nested help targets', async () => {
    const output = await captureLog(() => main(['agent', 'nope', '-h']))

    assert.match(output, /deweyou-cli agent init/)
    assert.match(output, /deweyou-cli agent <command> -h/)
  })

  it('prints the CLI version for -v and --version', async () => {
    const shortOutput = await captureLog(() => main(['-v']))
    const longOutput = await captureLog(() => main(['--version']))

    assert.match(shortOutput, /^\d+\.\d+\.\d+$/)
    assert.equal(longOutput, shortOutput)
  })
})

async function captureLog(callback) {
  const originalLog = console.log
  const messages = []

  console.log = (message) => {
    messages.push(message)
  }

  try {
    await callback()
  } finally {
    console.log = originalLog
  }

  return messages.join('\n')
}
