import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'

import type { BrainInitPromptInput } from '../src/cli/brain-types.ts'

describe('brain interactive setup prompts', () => {
  it('collects only repository attachment values', async () => {
    const calls = mockClack({
      textValues: ['~/brain', 'macbook-a', 'git@example.com:brain.git', 'main'],
      confirmValues: [true],
    })
    const { promptForBrainInit } = await importPromptModule()

    assert.deepEqual(await promptForBrainInit(promptInput()), {
      repo: '/tmp/home/brain',
      device: 'macbook-a',
      remote: 'git@example.com:brain.git',
      branch: 'main',
    })
    assert.deepEqual(calls.intro, ['Deweyou Brain Setup'])
    assert.equal(calls.notes.length, 1)
    assert.match(String(calls.notes[0][0]), /Existing repository content will be preserved/)
  })

  it('rejects a declined setup without asking about history or workers', async () => {
    const calls = mockClack({
      textValues: ['/tmp/brain', 'macbook-a', '', 'main'],
      confirmValues: [false],
    })
    const { promptForBrainInit } = await importPromptModule()

    await assert.rejects(
      promptForBrainInit(promptInput()),
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
  }
}

function mockClack({
  textValues = [],
  confirmValues = [true],
  cancelValue,
}: {
  textValues?: unknown[]
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
