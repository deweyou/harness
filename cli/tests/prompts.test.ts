import { describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'

describe('promptForInit', () => {
  it('selects all assets after prompting for scope, tools, mode, and asset scope', async () => {
    const calls = mockClack({
      selectValues: ['project', 'both', 'copy', 'all', 'reference'],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
    })

    assert.deepEqual(result, {
      mode: 'copy',
      scope: 'project',
      tools: ['codex', 'claude'],
      ruleWiring: 'reference',
      selected: {
        skills: ['demo'],
        rules: ['demo-rule'],
      },
    })
    assert.deepEqual(calls.intro, ['Dewey Agent Setup'])
    assert.deepEqual(calls.note[0], ['/repo', 'Repository'])
  })

  it('prompts for project scope, tools, rule wiring, assets, and confirmation', async () => {
    const calls = mockClack({
      selectValues: ['project', 'both', 'rules', 'reference'],
      multiselectValues: [['demo-rule']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
      mode: 'link',
    })

    assert.deepEqual(result, {
      mode: 'link',
      scope: 'project',
      tools: ['codex', 'claude'],
      ruleWiring: 'reference',
      selected: { skills: [], rules: ['demo-rule'] },
    })
    assert.match(calls.note.at(-1)[0], /AGENTS\.md/)
    assert.match(calls.note.at(-1)[0], /CLAUDE\.md/)
  })

  it('previews AGENTS.md and CLAUDE.md for Claude-only project installs', async () => {
    const calls = mockClack({
      selectValues: ['project', 'claude', 'rules', 'reference'],
      multiselectValues: [['demo-rule']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
      mode: 'link',
    })

    assert.match(calls.note.at(-1)[0], /AGENTS\.md/)
    assert.match(calls.note.at(-1)[0], /CLAUDE\.md/)
  })

  it('omits CLAUDE.md from Claude-only project preview when no rules are selected', async () => {
    const calls = mockClack({
      selectValues: ['project', 'claude', 'skills'],
      multiselectValues: [['demo']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
      mode: 'link',
    })

    assert.match(calls.note.at(-1)[0], /AGENTS\.md/)
    assert.match(calls.note.at(-1)[0], /\.agents\/skills\/<skill>\/SKILL\.md/)
    assert.doesNotMatch(calls.note.at(-1)[0], /CLAUDE\.md/)
  })

  it('supports global setup for skills and rules and previews global files', async () => {
    const calls = mockClack({
      selectValues: ['global', 'both', 'all', 'reference'],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
    })

    assert.deepEqual(result, {
      mode: 'pointer',
      scope: 'global',
      tools: ['codex', 'claude'],
      ruleWiring: 'reference',
      selected: { skills: ['demo'], rules: ['demo-rule'] },
    })
    assert.match(calls.note.at(-1)[0], /~\/\.codex\/AGENTS\.md/)
    assert.match(calls.note.at(-1)[0], /~\/\.claude\/CLAUDE\.md/)
    assert.match(calls.note.at(-1)[0], /~\/\.agents\/skills\/<skill>/)
    assert.match(calls.note.at(-1)[0], /~\/\.claude\/skills\/<skill>/)
    assert.match(calls.note.at(-1)[0], /~\/\.deweyou\/agents\/global-manifest\.json/)
  })

  it('supports global skills-only setup without rule wiring prompts', async () => {
    const calls = mockClack({
      selectValues: ['global', 'codex', 'skills'],
      multiselectValues: [['demo']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
    })

    assert.deepEqual(result, {
      mode: 'pointer',
      scope: 'global',
      tools: ['codex'],
      ruleWiring: 'reference',
      selected: { skills: ['demo'], rules: [] },
    })
    assert.doesNotMatch(calls.note.at(-1)[0], /~\/\.codex\/AGENTS\.md/)
    assert.match(calls.note.at(-1)[0], /~\/\.agents\/skills\/<skill>/)
    assert.doesNotMatch(calls.note.at(-1)[0], /~\/\.claude\/skills\/<skill>/)
  })

  it('uses provided mode and prompts for custom skill and rule selections', async () => {
    mockClack({
      selectValues: ['project', 'both', 'custom', 'reference'],
      multiselectValues: [['demo'], ['demo-rule']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
      mode: 'pointer',
    })

    assert.deepEqual(result, {
      mode: 'pointer',
      scope: 'project',
      tools: ['codex', 'claude'],
      ruleWiring: 'reference',
      selected: {
        skills: ['demo'],
        rules: ['demo-rule'],
      },
    })
  })

  it('prompts for a design contract during custom project setup', async () => {
    const calls = mockClack({
      selectValues: ['project', 'both', 'custom', 'dewey-interface', 'reference'],
      multiselectValues: [['demo'], ['demo-rule']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture({ designs: true }),
      repoRoot: '/repo',
      mode: 'copy',
    })

    assert.deepEqual(result, {
      mode: 'copy',
      scope: 'project',
      tools: ['codex', 'claude'],
      ruleWiring: 'reference',
      selected: {
        skills: ['demo'],
        rules: ['demo-rule'],
        design: 'dewey-interface',
      },
    })
    assert.match(calls.note.at(-1)[0], /DESIGN\.md/)
  })

  it('supports design-only project setup without rule wiring prompts', async () => {
    const calls = mockClack({
      selectValues: ['project', 'codex', 'design', 'dewey-interface'],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture({ designs: true }),
      repoRoot: '/repo',
      mode: 'link',
    })

    assert.deepEqual(result, {
      mode: 'link',
      scope: 'project',
      tools: ['codex'],
      ruleWiring: 'reference',
      selected: {
        skills: [],
        rules: [],
        design: 'dewey-interface',
      },
    })
    assert.match(calls.note.at(-1)[0], /DESIGN\.md/)
  })

  it('allows skipping design selection when design contracts are available', async () => {
    const calls = mockClack({
      selectValues: ['project', 'codex', 'design', ''],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture({ designs: true }),
      repoRoot: '/repo',
      mode: 'link',
    })

    assert.deepEqual(result, {
      mode: 'link',
      scope: 'project',
      tools: ['codex'],
      ruleWiring: 'reference',
      selected: {
        skills: [],
        rules: [],
      },
    })
    assert.doesNotMatch(calls.note.at(-1)[0], /DESIGN\.md/)
  })

  it('normalizes provided all-tool selections', async () => {
    mockClack({
      selectValues: ['project', 'skills'],
      multiselectValues: [['demo']],
      confirmValue: true,
    })
    const { promptForInit } = await importPromptModule()

    const result = await promptForInit({
      registry: registryFixture(),
      repoRoot: '/repo',
      mode: 'pointer',
      tools: ['all'],
    })

    assert.deepEqual(result.tools, ['codex', 'claude'])
  })

  it('supports skills-only and rules-only scopes', async () => {
    mockClack({
      selectValues: ['project', 'codex', 'skills'],
      multiselectValues: [['demo']],
      confirmValue: true,
    })
    let imported = await importPromptModule()
    assert.deepEqual(
      await imported.promptForInit({
        registry: registryFixture(),
        repoRoot: '/repo',
        mode: 'link',
      }),
      {
        mode: 'link',
        scope: 'project',
        tools: ['codex'],
        ruleWiring: 'reference',
        selected: { skills: ['demo'], rules: [] },
      },
    )

    mockClack({
      selectValues: ['project', 'claude', 'rules', 'inline'],
      multiselectValues: [['demo-rule']],
      confirmValue: true,
    })
    imported = await importPromptModule()
    assert.deepEqual(
      await imported.promptForInit({
        registry: registryFixture(),
        repoRoot: '/repo',
        mode: 'copy',
      }),
      {
        mode: 'copy',
        scope: 'project',
        tools: ['claude'],
        ruleWiring: 'inline',
        selected: { skills: [], rules: ['demo-rule'] },
      },
    )
  })

  it('cancels when confirmation is declined', async () => {
    const calls = mockClack({
      selectValues: ['project', 'both', 'all', 'reference'],
      confirmValue: false,
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    const { promptForInit } = await importPromptModule()

    await assert.rejects(
      () =>
        promptForInit({
          registry: registryFixture(),
          repoRoot: '/repo',
          mode: 'link',
        }),
      /exit 0/,
    )
    assert.deepEqual(calls.cancel, ['Dewey agent setup cancelled.'])
    exit.mockRestore()
  })

  it('cancels when a prompt returns a cancellation sentinel', async () => {
    const sentinel = Symbol('cancel')
    const calls = mockClack({
      selectValues: [sentinel],
      cancelValue: sentinel,
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
    const { promptForInit } = await importPromptModule()

    await assert.rejects(
      () =>
        promptForInit({
          registry: registryFixture(),
          repoRoot: '/repo',
        }),
      /exit 0/,
    )
    assert.deepEqual(calls.cancel, ['Dewey agent setup cancelled.'])
    exit.mockRestore()
  })
})

function mockClack({
  selectValues = [],
  multiselectValues = [],
  confirmValue = true,
  cancelValue,
} = {}) {
  const calls = {
    intro: [],
    note: [],
    cancel: [],
  }

  vi.resetModules()
  vi.doMock('@clack/prompts', () => ({
    intro(message) {
      calls.intro.push(message)
    },
    note(message, title) {
      calls.note.push([message, title])
    },
    cancel(message) {
      calls.cancel.push(message)
    },
    select: vi.fn(async () => selectValues.shift()),
    multiselect: vi.fn(async () => multiselectValues.shift()),
    confirm: vi.fn(async () => confirmValue),
    isCancel(value) {
      return value === cancelValue
    },
  }))

  return calls
}

async function importPromptModule() {
  return import('../src/cli/prompts.ts')
}

function registryFixture({ designs = false } = {}) {
  return {
    assets: {
      skills: {
        demo: {
          description: 'Demo skill',
        },
      },
      rules: {
        'demo-rule': {
          description: 'Demo rule',
        },
      },
      designs: designs
        ? {
            'dewey-interface': {
              description: 'Dewey design contract',
            },
          }
        : {},
    },
  }
}
