import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  buildAgentSyncCommand,
  buildAgentUpgradeCommand,
  buildSkillsCommand,
} from '../src/cli/skills.ts'

describe('buildSkillsCommand', () => {
  it('maps Dewey project skill add flags to the skills CLI', () => {
    assert.deepEqual(
      buildSkillsCommand([
        'add',
        'deweyou/agents',
        '--skills',
        'repo-memory,git-delivery',
        '--tools',
        'codex,claude',
        '--yes',
      ]),
      {
        command: 'npx',
        args: [
          '-y',
          'skills@latest',
          'add',
          'deweyou/agents',
          '--skill',
          'repo-memory',
          'git-delivery',
          '--agent',
          'codex',
          'claude',
          '--yes',
        ],
      },
    )
  })

  it('maps global update aliases to skills update -g', () => {
    assert.deepEqual(
      buildSkillsCommand(['update', 'repo-memory', '--global', '--yes']),
      {
        command: 'npx',
        args: [
          '-y',
          'skills@latest',
          'update',
          'repo-memory',
          '-g',
          '--yes',
        ],
      },
    )
  })

  it('maps project sync to experimental_install', () => {
    assert.deepEqual(buildSkillsCommand(['sync', '--yes']), {
      command: 'npx',
      args: ['-y', 'skills@latest', 'experimental_install', '--yes'],
    })
  })

  it('maps Dewey sync and upgrade aliases', () => {
    assert.deepEqual(buildAgentSyncCommand(['--yes']), {
      command: 'npx',
      args: ['-y', 'skills@latest', 'experimental_install', '--yes'],
    })
    assert.deepEqual(buildAgentUpgradeCommand(['repo-memory', '--scope', 'project']), {
      command: 'npx',
      args: ['-y', 'skills@latest', 'update', 'repo-memory', '-p'],
    })
  })

  it('maps all tools to the skills wildcard agent', () => {
    assert.deepEqual(
      buildSkillsCommand([
        'list',
        '--tools',
        'all',
        '--scope',
        'global',
        '--json',
      ]),
      {
        command: 'npx',
        args: [
          '-y',
          'skills@latest',
          'list',
          '--agent',
          '*',
          '-g',
          '--json',
        ],
      },
    )
  })

  it('treats project scope as the default for list and remove', () => {
    assert.deepEqual(
      buildSkillsCommand(['list', '--scope', 'project']),
      {
        command: 'npx',
        args: ['-y', 'skills@latest', 'list'],
      },
    )
    assert.deepEqual(
      buildSkillsCommand(['remove', 'repo-memory', '--scope', 'project']),
      {
        command: 'npx',
        args: ['-y', 'skills@latest', 'remove', 'repo-memory'],
      },
    )
  })

  it('rejects unsupported wrapper flags', () => {
    assert.throws(
      () => buildSkillsCommand(['add', 'deweyou/agents', '--rules', 'code-style']),
      /Flag --rules is not valid for agent skills add/,
    )
  })

  it('rejects malformed skills wrapper arguments', () => {
    assert.throws(
      () => buildSkillsCommand([]),
      /Unknown agent skills command: \(missing\)/,
    )
    assert.throws(
      () => buildSkillsCommand(['add']),
      /agent skills add requires a source/,
    )
    assert.throws(
      () => buildSkillsCommand(['add', 'deweyou/agents', 'extra']),
      /Unexpected argument: extra/,
    )
    assert.throws(
      () => buildSkillsCommand(['update', '--scope', 'workspace']),
      /Invalid scope: workspace/,
    )
    assert.throws(
      () => buildSkillsCommand(['list', '--tools']),
      /Missing value for --tools/,
    )
  })
})
