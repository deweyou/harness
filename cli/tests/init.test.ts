import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  cp,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  DEWEYOU_SECTION_END,
  DEWEYOU_SECTION_START,
} from '../src/cli/agents-md.ts'
import { cachePaths, updateCache } from '../src/cli/cache.ts'
import { initRepo, runInit } from '../src/cli/init.ts'
import { readJson } from '../src/cli/manifest.ts'
import { promptForInit } from '../src/cli/prompts.ts'
import { loadRegistry } from '../src/cli/registry.ts'

describe('initRepo', () => {
  it('exports an interactive prompt entrypoint', () => {
    assert.equal(typeof promptForInit, 'function')
  })

  it('link mode creates asset symlinks, writes a manifest, and upserts AGENTS.md', async () => {
    const { homeDir, repoRoot, sourceRoot, skillsInstaller } = await createInitFixture()

    await writeFile(
      join(repoRoot, 'AGENTS.md'),
      `# Existing Instructions

Keep this intro.

${DEWEYOU_SECTION_START}
## Dewey Workflow

Old Dewey section text.
${DEWEYOU_SECTION_END}

Keep this outro.
`,
    )

    const manifest = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: ['demo-rule'], design: 'dewey-interface' },
      mode: 'link',
      skillsInstaller,
    })
    const paths = cachePaths({ homeDir })
    const registry = await loadRegistry(sourceRoot)

    assert.equal(
      await realpath(join(repoRoot, '.agents/skills/demo')),
      await realpath(join(paths.assetsRoot, 'skills/demo')),
    )
    assert.equal(
      await realpath(join(repoRoot, '.agents/rules/demo-rule.md')),
      await realpath(join(paths.assetsRoot, 'rules/demo-rule.md')),
    )
    assert.equal(
      (await lstat(join(repoRoot, '.agents/skills/demo'))).isSymbolicLink(),
      true,
    )
    assert.equal(
      (await lstat(join(repoRoot, '.agents/rules/demo-rule.md'))).isSymbolicLink(),
      true,
    )
    assert.equal(
      await realpath(join(repoRoot, 'DESIGN.md')),
      await realpath(join(paths.assetsRoot, 'design/dewey-interface.md')),
    )
    assert.equal((await lstat(join(repoRoot, 'DESIGN.md'))).isSymbolicLink(), true)
    assert.deepEqual(
      await readJson(join(repoRoot, '.agents/manifest.json')),
      manifest,
    )
    assert.equal(manifest.mode, 'link')
    assert.deepEqual(manifest.source, { root: sourceRoot, commit: null })
    assert.equal(manifest.cacheRoot, paths.assetsRoot)
    assert.deepEqual(manifest.assets, {
      skills: ['demo'],
      rules: ['demo-rule'],
      design: 'dewey-interface',
    })
    assert.deepEqual(manifest.assetSnapshot, {
      skills: {
        demo: {
          description: 'Demo skill',
          hash: registry.assets.skills.demo.hash,
        },
      },
      rules: {
        'demo-rule': {
          description: 'Demo rule',
          hash: registry.assets.rules['demo-rule'].hash,
        },
      },
      designs: {
        'dewey-interface': {
          description: 'Dewey interface design contract',
          hash: registry.assets.designs['dewey-interface'].hash,
        },
      },
    })
    assert.equal(Number.isNaN(Date.parse(manifest.initializedAt)), false)

    const agentsMd = await readFile(join(repoRoot, 'AGENTS.md'), 'utf8')
    assert.match(agentsMd, /# Existing Instructions/)
    assert.match(agentsMd, /Keep this intro\./)
    assert.match(agentsMd, /Keep this outro\./)
    assert.match(agentsMd, /## Dewey Workflow/)
    assert.match(agentsMd, new RegExp(DEWEYOU_SECTION_START))
    assert.match(agentsMd, new RegExp(DEWEYOU_SECTION_END))
    assert.doesNotMatch(agentsMd, /Old Dewey section text/)
    assert.match(agentsMd, /\.agents\//)
    assert.match(agentsMd, /deweyou-cli agent context --format markdown/)
    assert.match(agentsMd, /rules/)
    assert.match(agentsMd, /skill index/)
    assert.match(agentsMd, /asset paths/)
    assert.match(agentsMd, /runtime notices/)
  })

  it('copy mode creates real copied asset files', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: ['demo-rule'], design: 'dewey-interface' },
      mode: 'copy',
      skillsInstaller,
    })

    assert.equal(
      (await lstat(join(repoRoot, '.agents/skills/demo'))).isSymbolicLink(),
      false,
    )
    assert.equal(
      (await lstat(join(repoRoot, '.agents/rules/demo-rule.md'))).isSymbolicLink(),
      false,
    )
    assert.match(
      await readFile(join(repoRoot, '.agents/rules/demo-rule.md'), 'utf8'),
      /Demo rule/,
    )
    assert.match(
      await readFile(join(repoRoot, '.agents/skills/demo/SKILL.md'), 'utf8'),
      /Demo skill/,
    )
    assert.match(
      await readFile(join(repoRoot, 'DESIGN.md'), 'utf8'),
      /Dewey interface design contract/,
    )
  })

  it.each(['link', 'copy'] as const)(
    'project inline %s mode reads rule bodies before installing project rule assets',
    async (mode) => {
      const { homeDir, repoRoot } = await createInitFixture()

      await initRepo({
        homeDir,
        repoRoot,
        selected: { skills: [], rules: ['demo-rule'] },
        mode,
        tools: ['codex'],
        ruleWiring: 'inline',
      })

      const agentsMd = await readFile(join(repoRoot, 'AGENTS.md'), 'utf8')
      assert.match(agentsMd, /Follow these selected Dewey rules:/)
      assert.match(agentsMd, /description: Demo rule/)
      assert.match(agentsMd, /# Demo rule/)
    },
  )

  it('project inline dryRun plans files without reading missing project rule assets', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const plan = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: [], rules: ['demo-rule'] },
      mode: 'copy',
      tools: ['codex'],
      ruleWiring: 'inline',
      dryRun: true,
    })

    assert.equal(plan.dryRun, true)
    assert.deepEqual(plan.files, [
      join(repoRoot, '.agents/rules/demo-rule.md'),
      join(repoRoot, '.agents/manifest.json'),
      join(repoRoot, 'AGENTS.md'),
    ])
    await assert.rejects(() => stat(join(repoRoot, '.agents')), { code: 'ENOENT' })
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), { code: 'ENOENT' })
  })

  it('pointer mode writes a manifest without creating asset files', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const manifest = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: ['demo-rule'] },
      mode: 'pointer',
    })

    assert.equal(manifest.mode, 'pointer')
    assert.deepEqual(manifest.assets, {
      skills: ['demo'],
      rules: ['demo-rule'],
    })
    await assert.rejects(() => stat(join(repoRoot, '.agents/skills/demo')), {
      code: 'ENOENT',
    })
    await assert.rejects(
      () => stat(join(repoRoot, '.agents/rules/demo-rule.md')),
      {
        code: 'ENOENT',
      },
    )
  })

  it('project init records scope, tools, and rule wiring and creates CLAUDE.md', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    const manifest = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: [], rules: ['demo-rule'] },
      mode: 'link',
      scope: 'project',
      tools: ['codex', 'claude'],
      ruleWiring: 'reference',
    })

    assert.equal(manifest.scope, 'project')
    assert.deepEqual(manifest.tools, ['codex', 'claude'])
    assert.equal(manifest.ruleWiring, 'reference')
    assert.match(await readFile(join(repoRoot, 'AGENTS.md'), 'utf8'), /demo-rule/)
    assert.match(await readFile(join(repoRoot, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/)
  })

  it('refuses AGENTS.md symlinks before mutating the symlink target', async () => {
    const { homeDir, repoRoot } = await createInitFixture()
    const sharedRoot = await mkdtemp(join(tmpdir(), 'deweyou-shared-'))
    const sharedAgents = join(sharedRoot, 'AGENTS.md')
    const original = '# Shared instructions\n'

    await writeFile(sharedAgents, original)
    await symlink(sharedAgents, join(repoRoot, 'AGENTS.md'))

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: ['demo-rule'] },
          mode: 'link',
          tools: ['codex'],
          ruleWiring: 'reference',
        }),
      /Refusing to write Dewey workflow through symlink/,
    )

    assert.equal(await readFile(sharedAgents, 'utf8'), original)
  })

  it('global init writes tool instruction files and a global manifest', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    const manifest = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: [], rules: ['demo-rule'] },
      scope: 'global',
      tools: ['codex', 'claude'],
      ruleWiring: 'inline',
    })

    assert.equal(manifest.scope, 'global')
    assert.match(await readFile(join(homeDir, '.codex/AGENTS.md'), 'utf8'), /Demo rule/)
    assert.match(await readFile(join(homeDir, '.claude/CLAUDE.md'), 'utf8'), /Demo rule/)
    assert.deepEqual(
      await readJson(join(homeDir, '.deweyou/agents/global-manifest.json')),
      manifest,
    )
    await assert.rejects(() => stat(join(repoRoot, '.agents')), { code: 'ENOENT' })
  })

  it('force refuses to replace non-Dewey user-created asset destinations', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    await mkdir(join(repoRoot, '.agents/skills/demo'), { recursive: true })
    await mkdir(join(repoRoot, '.agents/rules'), { recursive: true })
    await writeFile(
      join(repoRoot, '.agents/skills/demo/SKILL.md'),
      'user skill',
    )
    await writeFile(
      join(repoRoot, '.agents/rules/demo-rule.md'),
      'user rule',
    )

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['demo'], rules: ['demo-rule'] },
          mode: 'copy',
          force: true,
        }),
      /Refusing to replace non-Dewey-managed destination/,
    )

    assert.equal(
      await readFile(join(repoRoot, '.agents/skills/demo/SKILL.md'), 'utf8'),
      'user skill',
    )
    assert.equal(
      await readFile(join(repoRoot, '.agents/rules/demo-rule.md'), 'utf8'),
      'user rule',
    )
    await assert.rejects(
      () => stat(join(repoRoot, '.agents/manifest.json')),
      { code: 'ENOENT' },
    )
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('scripted dryRun returns planned files without opening prompts or writing .agents or AGENTS.md', async () => {
    const { homeDir, repoRoot } = await createInitFixture()
    let promptCalls = 0

    const plan = await runInit(
      {
        homeDir,
        repoRoot,
        all: true,
        mode: 'copy',
        dryRun: true,
      },
      {
        async promptForInit() {
          promptCalls += 1
          throw new Error('scripted dryRun should not prompt')
        },
      },
    )

    assert.equal(promptCalls, 0)
    assert.equal(plan.dryRun, true)
    assert.equal(plan.mode, 'copy')
    assert.deepEqual(plan.assets, {
      skills: ['demo'],
      rules: ['demo-rule'],
    })
    assert.deepEqual(plan.files, [
      join(repoRoot, '.agents/skills/demo'),
      join(repoRoot, '.claude/skills/demo'),
      join(repoRoot, '.agents/rules/demo-rule.md'),
      join(repoRoot, '.agents/manifest.json'),
      join(repoRoot, 'AGENTS.md'),
      join(repoRoot, 'CLAUDE.md'),
    ])
    await assert.rejects(() => stat(join(repoRoot, '.agents')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('interactive dryRun uses prompted selection without writing .agents or AGENTS.md', async () => {
    const { homeDir, repoRoot } = await createInitFixture()
    let promptCalls = 0

    const plan = await runInit(
      { homeDir, repoRoot, dryRun: true },
      {
        async promptForInit({ registry, repoRoot: promptedRepoRoot }) {
          promptCalls += 1
          assert.equal(promptedRepoRoot, repoRoot)
          assert.deepEqual(Object.keys(registry.assets.skills), ['demo'])
          assert.deepEqual(Object.keys(registry.assets.rules), ['demo-rule'])
          return {
            mode: 'pointer',
            scope: 'project',
            tools: ['codex'],
            ruleWiring: 'reference',
            selected: { skills: ['demo'], rules: [] },
          }
        },
      },
    )

    assert.equal(promptCalls, 1)
    assert.equal(plan.dryRun, true)
    assert.equal(plan.mode, 'pointer')
    assert.deepEqual(plan.assets, {
      skills: ['demo'],
      rules: [],
    })
    assert.deepEqual(plan.files, [
      join(repoRoot, '.agents/manifest.json'),
      join(repoRoot, 'AGENTS.md'),
    ])
    await assert.rejects(() => stat(join(repoRoot, '.agents')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('interactive mode passes explicit mode to the prompt', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    const manifest = await runInit(
      { homeDir, repoRoot, mode: 'copy' },
      {
        async promptForInit({ mode }) {
          assert.equal(mode, 'copy')
          return {
            mode,
            scope: 'project',
            tools: ['claude'],
            ruleWiring: 'inline',
            selected: { skills: [], rules: ['demo-rule'] },
          }
        },
      },
    )

    assert.equal(manifest.mode, 'copy')
    assert.equal(manifest.scope, 'project')
    assert.deepEqual(manifest.tools, ['claude'])
    assert.equal(manifest.ruleWiring, 'inline')
    assert.deepEqual(manifest.assets, {
      skills: [],
      rules: ['demo-rule'],
    })
  })

  it('preserves explicit non-scripted mode over prompted values', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const manifest = await runInit(
      { homeDir, repoRoot, mode: 'copy', skillsInstaller },
      {
        async promptForInit() {
          return {
            mode: 'link',
            scope: 'project',
            tools: ['codex'],
            ruleWiring: 'reference',
            selected: { skills: ['demo'], rules: [] },
          }
        },
      },
    )

    assert.equal(manifest.mode, 'copy')
    assert.deepEqual(manifest.assets, {
      skills: ['demo'],
      rules: [],
    })
    assert.equal(
      (await lstat(join(repoRoot, '.agents/skills/demo'))).isSymbolicLink(),
      false,
    )
  })

  it('preserves explicit non-scripted scope over prompted values', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const manifest = await runInit(
      { homeDir, repoRoot, scope: 'global' },
      {
        async promptForInit() {
          return {
            mode: 'link',
            scope: 'project',
            tools: ['codex'],
            ruleWiring: 'reference',
            selected: { skills: [], rules: ['demo-rule'] },
          }
        },
      },
    )

    assert.equal(manifest.scope, 'global')
    assert.deepEqual(manifest.tools, ['codex'])
    assert.match(await readFile(join(homeDir, '.codex/AGENTS.md'), 'utf8'), /demo-rule/)
    await assert.rejects(() => stat(join(repoRoot, '.agents')), { code: 'ENOENT' })
  })

  it('scripted global runInit forwards scope, tools, and rule wiring to initRepo', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const manifest = await runInit({
      homeDir,
      repoRoot,
      scope: 'global',
      rules: ['demo-rule'],
      tools: ['codex', 'claude'],
      ruleWiring: 'inline',
      yes: true,
    })

    assert.equal(manifest.scope, 'global')
    assert.deepEqual(manifest.tools, ['codex', 'claude'])
    assert.equal(manifest.ruleWiring, 'inline')
    assert.match(await readFile(join(homeDir, '.codex/AGENTS.md'), 'utf8'), /Demo rule/)
    assert.match(await readFile(join(homeDir, '.claude/CLAUDE.md'), 'utf8'), /Demo rule/)
    assert.deepEqual(
      await readJson(join(homeDir, '.deweyou/agents/global-manifest.json')),
      manifest,
    )
    await assert.rejects(() => stat(join(repoRoot, '.agents')), { code: 'ENOENT' })
  })

  it('scripted global runInit requires --yes or --dry-run before writing files', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    await assert.rejects(
      () =>
        runInit({
          homeDir,
          repoRoot,
          scope: 'global',
          rules: ['demo-rule'],
        }),
      /--scope global with scripted selections requires --yes or --dry-run/,
    )

    await assert.rejects(() => stat(join(homeDir, '.codex/AGENTS.md')), {
      code: 'ENOENT',
    })
    await assert.rejects(
      () => stat(join(homeDir, '.deweyou/agents/global-manifest.json')),
      { code: 'ENOENT' },
    )
  })

  it('scripted global runInit allows dry-run without --yes', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    const plan = await runInit({
      homeDir,
      repoRoot,
      scope: 'global',
      rules: ['demo-rule'],
      dryRun: true,
    })

    assert.equal(plan.dryRun, true)
    assert.equal(plan.scope, 'global')
    assert.deepEqual(plan.files, [
      join(homeDir, '.codex/AGENTS.md'),
      join(homeDir, '.claude/CLAUDE.md'),
      join(homeDir, '.deweyou/agents/global-manifest.json'),
    ])
    await assert.rejects(() => stat(join(homeDir, '.codex/AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('scripted global runInit links selected skills into tool skill directories', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const manifest = await runInit({
      homeDir,
      repoRoot,
      scope: 'global',
      skills: ['demo'],
      tools: ['codex', 'claude'],
      yes: true,
      skillsInstaller,
    })

    assert.equal(manifest.scope, 'global')
    assert.deepEqual(manifest.assets, { skills: ['demo'], rules: [] })
    assert.equal(
      await readlink(join(homeDir, '.agents/skills/demo')),
      await realpath(join(homeDir, '.deweyou/agents/assets/skills/demo')),
    )
    assert.equal(
      await readlink(join(homeDir, '.claude/skills/demo')),
      await realpath(join(homeDir, '.deweyou/agents/assets/skills/demo')),
    )
    assert.deepEqual(
      await readJson(join(homeDir, '.deweyou/agents/global-manifest.json')),
      manifest,
    )
    await assert.rejects(() => stat(join(repoRoot, '.agents')), { code: 'ENOENT' })
  })

  it('scripted --global shortcut links selected skills into tool skill directories', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    const output = await captureLog(() =>
      runInit({
        homeDir,
        repoRoot,
        global: true,
        skills: ['demo'],
        tools: ['codex'],
        yes: true,
        skillsInstaller,
      }),
    )

    assert.match(output, /Initialized Dewey workflow globally\./)
    assert.equal(
      await readlink(join(homeDir, '.agents/skills/demo')),
      await realpath(join(homeDir, '.deweyou/agents/assets/skills/demo')),
    )
    await assert.rejects(() => stat(join(repoRoot, '.agents')), { code: 'ENOENT' })
  })

  it('rejects conflicting global shortcut and project scope', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()

    await assert.rejects(
      () =>
        runInit({
          homeDir,
          repoRoot,
          global: true,
          scope: 'project',
          skills: ['demo'],
          yes: true,
        }),
      /--global cannot be combined with --scope project/,
    )
  })

  it('rejects invalid interactive mode before prompting or writing files', async () => {
    const { homeDir, repoRoot } = await createInitFixture()
    let promptCalls = 0

    await assert.rejects(
      () =>
        runInit(
          { homeDir, repoRoot, mode: 'typo' },
          {
            async promptForInit() {
              promptCalls += 1
              return {
                mode: 'typo',
                scope: 'project',
                tools: ['codex'],
                ruleWiring: 'reference',
                selected: { skills: ['demo'], rules: [] },
              }
            },
          },
        ),
      /mode must be one of link, copy, or pointer/,
    )

    assert.equal(promptCalls, 0)
    await assert.rejects(() => stat(join(repoRoot, '.agents')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('rejects invalid tool names even when all is selected', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: ['demo-rule'] },
          tools: ['all', 'cursor'] as never,
        }),
      /tool must be one of codex or claude: cursor/,
    )
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('rejects --yes without scripted asset selection before prompting or writing files', async () => {
    const { homeDir, repoRoot } = await createInitFixture()
    let promptCalls = 0

    await assert.rejects(
      () =>
        runInit(
          { homeDir, repoRoot, yes: true },
          {
            async promptForInit() {
              promptCalls += 1
              return {
                mode: 'link',
                scope: 'project',
                tools: ['codex'],
                ruleWiring: 'reference',
                selected: { skills: ['demo'], rules: [] },
              }
            },
          },
        ),
      /--yes requires --all, --skills, --rules, or --design/,
    )

    assert.equal(promptCalls, 0)
    await assert.rejects(() => stat(join(repoRoot, '.agents')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('rejects empty interactive selection before writing files', async () => {
    const { homeDir, repoRoot } = await createInitFixture()

    await assert.rejects(
      () =>
        runInit(
          { homeDir, repoRoot },
          {
            async promptForInit() {
              return {
                mode: 'link',
                scope: 'project',
                tools: ['codex'],
                ruleWiring: 'reference',
                selected: { skills: [], rules: [] },
              }
            },
          },
        ),
      /No assets selected/,
    )

    await assert.rejects(() => stat(join(repoRoot, '.agents')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, 'AGENTS.md')), {
      code: 'ENOENT',
    })
  })

  it('planning failure preserves existing managed assets and manifest', async () => {
    const { homeDir, repoRoot, skillsInstaller } = await createInitFixture()
    const paths = cachePaths({ homeDir })

    const oldManifest = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: ['demo-rule'] },
      mode: 'copy',
      skillsInstaller,
    })
    const oldSkill = await readFile(
      join(repoRoot, '.agents/skills/demo/SKILL.md'),
      'utf8',
    )
    const oldRule = await readFile(
      join(repoRoot, '.agents/rules/demo-rule.md'),
      'utf8',
    )

    await rm(join(paths.assetsRoot, 'skills/demo'), {
      recursive: true,
      force: true,
    })

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['demo'], rules: ['demo-rule'] },
          mode: 'copy',
          force: true,
          skillsInstaller,
        }),
      { code: 'ENOENT' },
    )
    assert.equal(
      await readFile(join(repoRoot, '.agents/skills/demo/SKILL.md'), 'utf8'),
      oldSkill,
    )
    assert.equal(
      await readFile(join(repoRoot, '.agents/rules/demo-rule.md'), 'utf8'),
      oldRule,
    )
    assert.deepEqual(
      await readJson(join(repoRoot, '.agents/manifest.json')),
      oldManifest,
    )
    await assert.rejects(
      () => stat(join(repoRoot, '.agents/skills/.demo.tmp')),
      { code: 'ENOENT' },
    )
  })

  it('rejects malformed cache registry ids before writing outside .agents', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const sourceRoot = await createAssetHub()

    await updateCache({ homeDir, sourceRoot, cliVersion: '0.1.0' })
    const paths = cachePaths({ homeDir })
    await writeFile(
      join(paths.assetsRoot, 'registry.json'),
      `${JSON.stringify(
        {
          assets: {
            skills: {
              '../escape': {
                path: 'skills/demo',
                description: 'Demo skill',
                hash: 'sha256:demo',
                tags: [],
              },
            },
            rules: {},
          },
        },
        null,
        2,
      )}\n`,
    )

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['../escape'], rules: [] },
          mode: 'copy',
        }),
      /Dewey skill id must be kebab-case/,
    )
    await assert.rejects(() => stat(join(repoRoot, '.agents')), {
      code: 'ENOENT',
    })
    await assert.rejects(() => stat(join(repoRoot, 'escape')), {
      code: 'ENOENT',
    })
  })
})

async function createInitFixture() {
  const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
  const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
  const sourceRoot = await createAssetHub()

  await updateCache({ homeDir, sourceRoot, cliVersion: '0.1.0' })

  return {
    homeDir,
    repoRoot,
    sourceRoot,
    skillsInstaller: createFakeSkillsInstaller(homeDir),
  }
}

function createFakeSkillsInstaller(homeDir) {
  const assetsRoot = cachePaths({ homeDir }).assetsRoot

  return async ({ cwd, skills, tools, scope, mode }) => {
    const root = scope === 'global' ? homeDir : cwd

    await Promise.all(
      tools.flatMap((tool) =>
        skills.map(async (skill) => {
          const source = join(assetsRoot, 'skills', skill)
          const destination = join(
            root,
            tool === 'claude' ? '.claude/skills' : '.agents/skills',
            skill,
          )

          await rm(destination, { recursive: true, force: true })
          await mkdir(join(destination, '..'), { recursive: true })

          if (mode === 'copy') {
            await cp(source, destination, { recursive: true })
          } else {
            await symlink(await realpath(source), destination)
          }
        }),
      ),
    )
  }
}

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

async function createAssetHub(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))
  const skillId = options.skillId ?? 'demo'
  const skillPath = options.skillPath ?? 'skills/demo'

  await mkdir(join(root, skillPath), { recursive: true })
  await mkdir(join(root, 'rules'), { recursive: true })
  await mkdir(join(root, 'design'), { recursive: true })

  await writeFile(
    join(root, skillPath, 'SKILL.md'),
    `---
name: ${skillId}
description: Demo skill
---

# Demo
`,
  )

  await writeFile(
    join(root, 'rules/demo-rule.md'),
    `---
name: demo-rule
description: Demo rule
---

# Demo rule
`,
  )

  await writeFile(
    join(root, 'design/dewey-interface.md'),
    `---
name: dewey-interface
description: Dewey interface design contract
---

# Dewey Interface
`,
  )

  return root
}
