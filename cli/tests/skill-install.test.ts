import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { buildSkillsAddCommand } from '../src/cli/skill-install.ts'

describe('buildSkillsAddCommand', () => {
  it('builds a project skills add command for selected tools', () => {
    assert.deepEqual(
      buildSkillsAddCommand({
        cwd: '/repo',
        source: 'deweyou/agents',
        skills: ['repo-memory', 'git-delivery'],
        tools: ['codex', 'claude'],
        scope: 'project',
        mode: 'link',
      }),
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
          'claude-code',
          '--yes',
        ],
      },
    )
  })

  it('maps global copy installs to skills CLI flags', () => {
    assert.deepEqual(
      buildSkillsAddCommand({
        cwd: '/repo',
        source: 'deweyou/agents',
        skills: ['repo-memory'],
        tools: ['codex'],
        scope: 'global',
        mode: 'copy',
      }),
      {
        command: 'npx',
        args: [
          '-y',
          'skills@latest',
          'add',
          'deweyou/agents',
          '--skill',
          'repo-memory',
          '--agent',
          'codex',
          '--yes',
          '-g',
          '--copy',
        ],
      },
    )
  })
})
