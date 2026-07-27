import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'

import type { BrainInitPromptInput } from '../src/cli/brain-types.ts'

describe('brain interactive setup prompts', () => {
  it('collects initialization values and selected history imports', async () => {
    const calls = mockClack({
      textValues: ['~/brain', 'macbook-a', 'git@example.com:brain.git', 'main'],
      multiselectValues: [['codex'], ['codex', 'hermes']],
      confirmValues: [true, true],
    })
    const { promptForBrainInit } = await importPromptModule()

    assert.deepEqual(await promptForBrainInit(promptInput()), {
      repo: '/tmp/home/brain',
      device: 'macbook-a',
      remote: 'git@example.com:brain.git',
      branch: 'main',
      importAgents: ['codex'],
      hookAgents: ['codex', 'hermes'],
      installSchedule: true,
    })
    assert.deepEqual(calls.intro, ['Deweyou Brain Setup'])
    assert.equal(calls.notes.length, 1)
    assert.match(String(calls.notes[0][0]), /device scope/)
  })

  it('supports no discovered history and rejects a declined setup', async () => {
    const calls = mockClack({
      textValues: ['/tmp/brain', 'macbook-a', '', 'main'],
      multiselectValues: [[]],
      confirmValues: [false],
    })
    const { promptForBrainInit } = await importPromptModule()

    await assert.rejects(
      promptForBrainInit({
        ...promptInput(),
        discovery: {
          agents: ['codex', 'hermes'],
          sources: [],
          files: 0,
          records: 0,
          source_bytes: 0,
          warnings: [],
        },
        supportsSchedule: false,
      }),
      /cancelled/,
    )
    assert.deepEqual(calls.cancels, ['Deweyou Brain setup cancelled.'])
  })

  it('handles prompt cancellation before writing state', async () => {
    const cancelled = Symbol('cancelled')
    const calls = mockClack({
      textValues: [cancelled],
      cancelValue: cancelled,
    })
    const { promptForBrainInit } = await importPromptModule()

    await assert.rejects(promptForBrainInit(promptInput()), /cancelled/)
    assert.equal(calls.cancels.length, 1)
  })
})

function promptInput(): BrainInitPromptInput {
  return {
    homeDir: '/tmp/home',
    defaultRepo: '/tmp/home/Documents/personal-brain',
    defaultDevice: 'macbook-a',
    discovery: {
      agents: ['codex', 'hermes'],
      sources: [
        {
          agent: 'codex',
          kind: 'codex-jsonl',
          path: '/tmp/home/.codex/sessions',
          files: 2,
          records: 2,
          source_bytes: 2048,
        },
      ],
      files: 2,
      records: 2,
      source_bytes: 2048,
      warnings: [],
    },
    supportsSchedule: true,
  }
}

function mockClack({
  textValues = [],
  multiselectValues = [],
  confirmValues = [true],
  cancelValue,
}: {
  textValues?: unknown[]
  multiselectValues?: unknown[][]
  confirmValues?: boolean[]
  cancelValue?: unknown
} = {}) {
  const calls: {
    intro: unknown[]
    notes: unknown[][]
    cancels: unknown[]
  } = {
    intro: [],
    notes: [],
    cancels: [],
  }
  vi.resetModules()
  vi.doMock('@clack/prompts', () => ({
    intro(message: unknown) {
      calls.intro.push(message)
    },
    note(message: unknown, title: unknown) {
      calls.notes.push([message, title])
    },
    cancel(message: unknown) {
      calls.cancels.push(message)
    },
    text: vi.fn(async () => textValues.shift()),
    multiselect: vi.fn(async () => multiselectValues.shift() ?? []),
    confirm: vi.fn(async () => confirmValues.shift() ?? true),
    isCancel(value: unknown) {
      return value === cancelValue
    },
  }))
  return calls
}

async function importPromptModule() {
  return import('../src/cli/brain-prompts.ts')
}
