import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { parseArgs } from '../src/cli/args.ts'
import { main } from '../src/cli/main.ts'

describe('parseArgs', () => {
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
    assert.equal(longOutput, shortOutput)
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

  it('prints scoped help for unknown nested help targets', async () => {
    const output = await captureLog(() => main(['agent', 'nope', '-h']))

    assert.match(output, /deweyou-cli agent init/)
    assert.match(output, /deweyou-cli agent <command> -h/)
  })

  it('prints the CLI version for -v and --version', async () => {
    const shortOutput = await captureLog(() => main(['-v']))
    const longOutput = await captureLog(() => main(['--version']))

    assert.match(shortOutput, /^0\.\d+\.\d+$/)
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
