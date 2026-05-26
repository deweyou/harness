import { describe, it, vi } from 'vitest'
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

import { upsertAgentsSection } from '../src/cli/agents-md.ts'
import { cachePaths, runUpdate, updateCache } from '../src/cli/cache.ts'
import {
  renderMarkdownContext,
  resolveContext,
  runContext,
} from '../src/cli/context.ts'
import { checkDoctor, runDoctor } from '../src/cli/doctor.ts'
import { initRepo, runInit } from '../src/cli/init.ts'
import { loadRegistry } from '../src/cli/registry.ts'
import { resolveSourceRoot } from '../src/cli/source.ts'

describe('coverage gaps', () => {
  it('upserts AGENTS.md when the file is missing or has no managed section', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))

    const created = await upsertAgentsSection(repoRoot)
    assert.match(created, /Dewey Workflow/)
    assert.match(created, /If a root `DESIGN\.md` exists/)

    await writeFile(join(repoRoot, 'AGENTS.md'), '# Existing')
    const appended = await upsertAgentsSection(repoRoot)

    assert.match(appended, /# Existing\n\n<!-- deweyou-agent:start -->/)
    assert.equal(appended.endsWith('\n'), true)
  })

  it('replaces managed AGENTS.md sections without trailing newlines and bubbles read errors', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))

    await writeFile(
      join(repoRoot, 'AGENTS.md'),
      '# Existing\n\n<!-- deweyou-agent:start -->\nold\n<!-- deweyou-agent:end -->',
    )
    const replaced = await upsertAgentsSection(repoRoot)
    assert.equal(replaced.endsWith('\n'), true)
    assert.doesNotMatch(replaced, /old/)

    const badRepoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    await mkdir(join(badRepoRoot, 'AGENTS.md'))
    await assert.rejects(() => upsertAgentsSection(badRepoRoot), /EISDIR/)
  })

  it('updates cache without optional asset directories and rejects missing source roots', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))

    await updateCache({ homeDir, sourceRoot })
    const paths = cachePaths({ homeDir })

    assert.deepEqual(
      JSON.parse(await readFile(join(paths.assetsRoot, 'registry.json'), 'utf8')),
      { assets: { skills: {}, rules: {}, designs: {} } },
    )
    await assert.rejects(() => updateCache(), /sourceRoot is required/)
  })

  it('records git commits in the cache manifest when the asset source is a git repo', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = await createAssetHub()

    await execGit(sourceRoot, ['init'])
    await execGit(sourceRoot, ['config', 'user.email', 'dewey@example.com'])
    await execGit(sourceRoot, ['config', 'user.name', 'Dewey'])
    await execGit(sourceRoot, ['add', '.'])
    await execGit(sourceRoot, ['commit', '-m', 'initial assets'])
    const commit = (await execGit(sourceRoot, ['rev-parse', 'HEAD'])).trim()

    const manifest = await updateCache({ homeDir, sourceRoot })

    assert.equal(manifest.source.commit, commit)
  })

  it('logs runUpdate output while using an injected home directory', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))

    const output = await captureLog(() => runUpdate({ homeDir, sourceRoot }))

    assert.match(output, /Updated Dewey agent assets from local files/)
    await stat(join(homeDir, '.deweyou/agents/assets/registry.json'))
  })

  it('runUpdate resolves the source root from the environment', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))

    const output = await withEnv(
      'DEWEYOU_AGENTS_SOURCE',
      sourceRoot,
      () => captureLog(() => runUpdate({ homeDir })),
    )

    assert.match(output, /Updated Dewey agent assets from local files/)
  })

  it('reports missing context setup, missing cache, and missing registry assets', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))

    const missingManifest = await resolveContext({ repoRoot, homeDir })
    assert.equal(missingManifest.ok, false)
    assert.match(missingManifest.error, /not been initialized/)
    assert.match(renderMarkdownContext(missingManifest), /not been initialized/)

    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      source: { root: 'test-source', commit: null },
      cacheRoot: join(homeDir, '.deweyou/agents/assets'),
      assets: { skills: ['demo'], rules: ['demo-rule'], design: 'missing-design' },
      assetSnapshot: { skills: {}, rules: {} },
    })

    const missingCache = await resolveContext({ repoRoot, homeDir })
    assert.equal(missingCache.ok, false)
    assert.match(missingCache.error, /asset cache is missing/)

    await mkdir(join(homeDir, '.deweyou/agents/assets'), { recursive: true })
    await writeJson(join(homeDir, '.deweyou/agents/assets/registry.json'), {
      assets: { skills: {}, rules: {}, designs: {} },
    })

    const missingAssets = await resolveContext({ repoRoot, homeDir })
    assert.equal(missingAssets.ok, false)
    assert.match(missingAssets.error, /skill:demo/)
    assert.match(missingAssets.error, /rule:demo-rule/)
    assert.match(missingAssets.error, /design:missing-design/)
  })

  it('prints markdown and json context output including empty asset sections and update notices', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await mkdir(cacheRoot, { recursive: true })
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      source: { root: 'test-source', commit: 'old-commit' },
      cacheRoot,
      assets: { skills: [], rules: [], design: 'dewey-interface' },
      assetSnapshot: { skills: {}, rules: {}, designs: {} },
    })
    await writeJson(join(homeDir, '.deweyou/agents/manifest.json'), {
      source: { root: 'test-source', commit: 'new-commit' },
      cliVersion: '0.1.0',
      updatedAt: new Date().toISOString(),
    })
    await mkdir(join(cacheRoot, 'design'), { recursive: true })
    await writeFile(join(cacheRoot, 'design/dewey-interface.md'), '# Dewey interface')
    await writeJson(join(cacheRoot, 'registry.json'), {
      assets: {
        skills: {},
        rules: {},
        designs: {
          'dewey-interface': {
            path: 'design/dewey-interface.md',
            description: 'Dewey design contract',
            hash: 'sha256:dewey-design',
            tags: [],
          },
        },
      },
    })

    const markdown = await captureLog(() =>
      runContext({ repoRoot, homeDir, format: 'markdown' }),
    )
    assert.match(markdown, /- None selected\./)
    assert.match(markdown, /Active Design/)
    assert.match(markdown, /dewey-interface - Dewey design contract/)
    assert.match(markdown, /Dewey asset cache is at commit new-commit/)

    const json = await captureLog(() =>
      runContext({ repoRoot, homeDir, format: 'json' }),
    )
    assert.equal(JSON.parse(json).runtime.sourceCommit, 'new-commit')
  })

  it('resolves context when manifests and registries omit optional collections', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await mkdir(cacheRoot, { recursive: true })
    await writeJson(join(homeDir, '.deweyou/agents/manifest.json'), {})
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      source: { root: 'test-source', commit: null },
      cacheRoot,
      assets: { skills: ['demo'], rules: ['demo-rule'] },
    })
    await writeJson(join(cacheRoot, 'registry.json'), {
      assets: {
        skills: {
          demo: {
            path: 'skills/demo',
            description: 'Demo skill',
            hash: 'sha256:demo-skill',
            tags: [],
          },
        },
        rules: {
          'demo-rule': {
            path: 'rules/demo-rule.md',
            description: 'Demo rule',
            hash: 'sha256:demo-rule',
            tags: [],
          },
        },
      },
    })
    await mkdir(join(cacheRoot, 'skills/demo'), { recursive: true })
    await writeFile(join(cacheRoot, 'skills/demo/SKILL.md'), '# Demo')
    await mkdir(join(cacheRoot, 'rules'), { recursive: true })
    await writeFile(join(cacheRoot, 'rules/demo-rule.md'), '# Demo rule')

    const context = await resolveContext({ repoRoot, homeDir })

    assert.equal(context.ok, true)
    assert.deepEqual(context.runtime, {
      sourceCommit: null,
      repoSourceCommit: null,
    })
    assert.equal(context._notice.assets, null)
  })

  it('resolves empty context when selected asset collections are omitted', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await mkdir(cacheRoot, { recursive: true })
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      source: { root: 'test-source', commit: null },
      cacheRoot,
    })
    await writeJson(join(cacheRoot, 'registry.json'), {})

    const context = await resolveContext({ repoRoot, homeDir })

    assert.equal(context.ok, true)
    assert.deepEqual(context.assets, { skills: [], rules: [], designs: [] })
  })

  it('exercises doctor output for invalid json and failed runs', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(cacheRoot, { recursive: true })
    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await writeFile(join(cacheRoot, 'registry.json'), '{')
    await writeFile(join(repoRoot, '.agents/manifest.json'), '{')

    const previousExitCode = process.exitCode
    process.exitCode = undefined
    const output = await captureLog(() => runDoctor({ homeDir, repoRoot }))

    assert.match(output, /FAIL Dewey asset cache registry is invalid JSON/)
    assert.match(output, /FAIL repository manifest is invalid JSON/)
    assert.match(output, /FAIL AGENTS\.md is missing/)
    assert.equal(process.exitCode, 1)
    process.exitCode = previousExitCode
  })

  it('prints healthy doctor output without setting an exit code', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })
    const previousExitCode = process.exitCode
    process.exitCode = undefined

    const output = await captureLog(() => runDoctor({ homeDir, repoRoot }))

    assert.match(output, /PASS local asset cache registry exists/)
    assert.equal(process.exitCode, undefined)
    process.exitCode = previousExitCode
  })

  it('doctor reports missing manifests, missing selected assets, and copy-mode paths', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'copy' })

    const healthyCopy = await checkDoctor({ homeDir, repoRoot })
    assert.equal(healthyCopy.ok, true)

    await rm(join(repoRoot, '.agents/rules/demo-rule.md'))
    const missingRulePath = await checkDoctor({ homeDir, repoRoot })
    assert.equal(missingRulePath.ok, false)
    assert.match(failMessages(missingRulePath), /selected rule demo-rule path is missing/)

    const emptyRepo = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const missingManifest = await checkDoctor({ homeDir, repoRoot: emptyRepo })
    assert.equal(missingManifest.ok, false)
    assert.match(failMessages(missingManifest), /repository manifest is missing/)
  })

  it('doctor reports omitted registry and manifest collections', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(cacheRoot, { recursive: true })
    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await writeJson(join(cacheRoot, 'registry.json'), { assets: {} })
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      source: { root: 'test-source', commit: null },
      cacheRoot,
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /registry assets.skills must be an object/)
    assert.match(failMessages(result), /registry assets.rules must be an object/)
    assert.match(failMessages(result), /registry assets.designs must be an object/)
    assert.match(failMessages(result), /manifest assets must be an object/)
  })

  it('doctor reports missing top-level registry assets and manifest source', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(cacheRoot, { recursive: true })
    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await writeJson(join(cacheRoot, 'registry.json'), {})
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      cacheRoot,
      assets: { skills: [], rules: [] },
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /registry assets must be an object/)
    assert.match(failMessages(result), /manifest source must be an object/)

    await writeJson(join(repoRoot, '.agents/manifest.json'), null)
    const nullManifest = await checkDoctor({ homeDir, repoRoot })
    assert.match(failMessages(nullManifest), /manifest must be an object/)
  })

  it('doctor reports registry-selected missing assets and invalid rule paths', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })
    const registryPath = join(homeDir, '.deweyou/agents/assets/registry.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))

    delete registry.assets.skills.demo
    registry.assets.rules['demo-rule'].path = {}
    await writeJson(registryPath, registry)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /registry rule demo-rule path must be a string/)
  })

  it('doctor reports selected asset hash and registry consistency problems', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })
    const registryPath = join(homeDir, '.deweyou/agents/assets/registry.json')
    const manifestPath = join(repoRoot, '.agents/manifest.json')

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.assetSnapshot.skills.demo
    manifest.assetSnapshot.rules['demo-rule'].hash = 'sha256:old-rule'
    await writeJson(manifestPath, manifest)

    const missingSnapshot = await checkDoctor({ homeDir, repoRoot })
    assert.equal(missingSnapshot.ok, false)
    assert.match(
      failMessages(missingSnapshot),
      /selected skill demo is missing an initialized hash snapshot/,
    )
    assert.match(
      failMessages(missingSnapshot),
      /selected rule demo-rule has changed in the local asset cache/,
    )

    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.assets.skills.demo.description = 1
    registry.assets.skills.demo.hash = 'not-sha'
    registry.assets.skills.demo.tags = 'demo'
    await writeJson(registryPath, registry)

    const malformedRegistry = await checkDoctor({ homeDir, repoRoot })
    assert.equal(malformedRegistry.ok, false)
    assert.match(failMessages(malformedRegistry), /description must be a string/)
    assert.match(failMessages(malformedRegistry), /hash must be a sha256/)
    assert.match(failMessages(malformedRegistry), /tags must be an array/)
  })

  it('doctor reports selected design registry and path problems', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const registryPath = join(homeDir, '.deweyou/agents/assets/registry.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))

    manifest.assets.design = 'dewey-interface'
    manifest.assetSnapshot.designs = {
      'dewey-interface': { description: 'Old design', hash: 'sha256:old-design' },
    }
    registry.assets.designs['dewey-interface'].description = 1
    registry.assets.designs['dewey-interface'].hash = 'not-sha'
    registry.assets.designs['dewey-interface'].tags = 'design'
    await writeJson(manifestPath, manifest)
    await writeJson(registryPath, registry)

    const malformedDesign = await checkDoctor({ homeDir, repoRoot })
    assert.equal(malformedDesign.ok, false)
    assert.match(failMessages(malformedDesign), /registry design dewey-interface description must be a string/)
    assert.match(failMessages(malformedDesign), /registry design dewey-interface hash must be a sha256/)
    assert.match(failMessages(malformedDesign), /registry design dewey-interface tags must be an array/)

    registry.assets.designs['dewey-interface'] = {
      path: '',
      description: 'Dewey design contract',
      hash: 'sha256:dewey-design',
      tags: [],
    }
    await writeJson(registryPath, registry)
    const invalidPath = await checkDoctor({ homeDir, repoRoot })
    assert.match(failMessages(invalidPath), /selected design dewey-interface has invalid registry path/)

    delete registry.assets.designs['dewey-interface']
    await writeJson(registryPath, registry)
    const missingDesign = await checkDoctor({ homeDir, repoRoot })
    assert.match(failMessages(missingDesign), /selected design dewey-interface is missing from the registry/)
  })

  it('doctor reports missing selected design file paths', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'copy' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

    manifest.assets.design = 'dewey-interface'
    manifest.assetSnapshot.designs = {
      'dewey-interface': {
        description: 'Dewey design contract',
        hash: 'sha256:dewey-design',
      },
    }
    await writeJson(manifestPath, manifest)

    const result = await checkDoctor({ homeDir, repoRoot })
    assert.equal(result.ok, false)
    assert.match(failMessages(result), /selected design dewey-interface path is missing/)
  })

  it('doctor reports selected invalid registry paths after registry shape validation', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })
    const registryPath = join(homeDir, '.deweyou/agents/assets/registry.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))

    registry.assets.skills.demo.path = ''
    registry.assets.rules['demo-rule'].path = ''
    await writeJson(registryPath, registry)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /selected skill demo has invalid registry path/)
    assert.match(failMessages(result), /selected rule demo-rule has invalid registry path/)
  })

  it('doctor reports manifest source shape and selected missing registry entries', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const registryPath = join(homeDir, '.deweyou/agents/assets/registry.json')

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.source = { root: 1, commit: 2 }
    await writeJson(manifestPath, manifest)

    const badSource = await checkDoctor({ homeDir, repoRoot })
    assert.equal(badSource.ok, false)
    assert.match(failMessages(badSource), /manifest source.root must be a string/)
    assert.match(failMessages(badSource), /manifest source.commit must be a string or null/)

    manifest.source = { root: 'test-source', commit: null }
    await writeJson(manifestPath, manifest)
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    delete registry.assets.skills.demo
    delete registry.assets.rules['demo-rule']
    await writeJson(registryPath, registry)

    const missingSelected = await checkDoctor({ homeDir, repoRoot })
    assert.equal(missingSelected.ok, false)
    assert.match(failMessages(missingSelected), /selected skill demo is missing/)
    assert.match(failMessages(missingSelected), /selected rule demo-rule is missing/)
  })

  it('validates init errors and force replacement paths', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'link' })

    await assert.rejects(() => initRepo({ homeDir, repoRoot }), /selected assets/)
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['missing'], rules: [] },
        }),
      /Unknown Dewey skill/,
    )
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: ['missing'] },
        }),
      /Unknown Dewey rule/,
    )
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: [], design: 'missing-design' },
        }),
      /Unknown Dewey design/,
    )
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['demo'], rules: ['demo-rule'] },
          mode: 'link',
        }),
      /already exists/,
    )

    const replaced = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: ['demo-rule'] },
      mode: 'copy',
      force: true,
      skillsInstaller: createFakeSkillsInstaller(homeDir),
    })
    assert.equal(replaced.mode, 'copy')
  })

  it('validates init mode, cache manifest, and partial scripted selections', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: [] },
          mode: 1,
        }),
      /mode must be one of link, copy, or pointer/,
    )

    await rm(join(homeDir, '.deweyou/agents/manifest.json'))
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['demo'], rules: [] },
          mode: 'pointer',
        }),
      /cache manifest is missing source metadata/,
    )

    await writeJson(join(homeDir, '.deweyou/agents/manifest.json'), {
      source: { root: 'test-source', commit: null },
      cliVersion: '0.1.0',
      updatedAt: new Date().toISOString(),
    })

    const onlySkill = await runInit({
      homeDir,
      repoRoot,
      skills: ['demo'],
      mode: 'pointer',
      force: true,
    })
    assert.deepEqual(onlySkill.assets, { skills: ['demo'], rules: [] })

    const onlyRule = await runInit({
      homeDir,
      repoRoot,
      rules: ['demo-rule'],
      mode: 'pointer',
      force: true,
    })
    assert.deepEqual(onlyRule.assets, { skills: [], rules: ['demo-rule'] })
  })

  it('validates init scope and links global skill installs', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: ['demo-rule'] },
          scope: 'workspace' as never,
        }),
      /scope must be one of project or global/,
    )
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: ['demo-rule'] },
          tools: ['vim' as never],
        }),
      /tool must be one of codex or claude: vim/,
    )
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: ['demo-rule'] },
          ruleWiring: 'embed' as never,
        }),
      /ruleWiring must be one of reference or inline/,
    )
    const globalSkills = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: [] },
      scope: 'global',
      tools: ['codex'],
      skillsInstaller: createFakeSkillsInstaller(homeDir),
    })
    assert.deepEqual(globalSkills.assets, { skills: ['demo'], rules: [] })
    assert.equal(
      await readlink(join(homeDir, '.agents/skills/demo')),
      await realpath(join(homeDir, '.deweyou/agents/assets/skills/demo')),
    )
    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: [], rules: [], design: 'dewey-interface' },
          scope: 'global',
        }),
      /Global installs currently do not support design contracts/,
    )

    const allTools = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: [], rules: ['demo-rule'] },
      mode: 'pointer',
      tools: ['codex', 'all'],
      force: true,
    })
    assert.deepEqual(allTools.tools, ['codex', 'claude'])
  })

  it('initializes an empty manifest when selected collections are omitted', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const sourceRoot = await createAssetHub()

    await updateCache({ homeDir, sourceRoot, cliVersion: '0.1.0' })

    const manifest = await initRepo({
      homeDir,
      repoRoot,
      selected: {},
      mode: 'pointer',
    })

    assert.deepEqual(manifest.assets, { skills: [], rules: [] })
  })

  it('allows force replacement of Dewey-managed symlinks', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'link' })

    const refreshed = await initRepo({
      homeDir,
      repoRoot,
      selected: { skills: ['demo'], rules: ['demo-rule'] },
      mode: 'link',
      force: true,
      skillsInstaller: createFakeSkillsInstaller(homeDir),
    })

    assert.equal(refreshed.mode, 'link')
  })

  it('refuses force replacement of symlinks outside the Dewey cache', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const sourceRoot = await createAssetHub()
    const outsideRoot = await mkdtemp(join(tmpdir(), 'deweyou-outside-'))

    await updateCache({ homeDir, sourceRoot, cliVersion: '0.1.0' })
    await mkdir(join(repoRoot, '.agents/skills'), { recursive: true })
    await symlink(outsideRoot, join(repoRoot, '.agents/skills/demo'))
    await mkdir(join(repoRoot, '.agents/rules'), { recursive: true })
    await symlink(outsideRoot, join(repoRoot, '.agents/rules/demo-rule.md'))

    await assert.rejects(
      () =>
        initRepo({
          homeDir,
          repoRoot,
          selected: { skills: ['demo'], rules: ['demo-rule'] },
          mode: 'link',
          force: true,
        }),
      /Refusing to replace non-Dewey-managed destination/,
    )
    assert.equal((await lstat(join(repoRoot, '.agents/skills/demo'))).isSymbolicLink(), true)
  })

  it('runs scripted init for explicit skills and rules and fails when cache is missing', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })

    const result = await runInit({
      homeDir,
      repoRoot,
      skills: ['demo'],
      rules: ['demo-rule'],
      mode: 'pointer',
    })

    assert.deepEqual(result.assets, {
      skills: ['demo'],
      rules: ['demo-rule'],
    })

    const emptyHome = await mkdtemp(join(tmpdir(), 'deweyou-empty-home-'))
    await assert.rejects(
      () =>
        runInit({
          homeDir: emptyHome,
          repoRoot,
          all: true,
        }),
      /asset cache is missing/,
    )
  })

  it('runs scripted init for explicit design contracts', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })

    const result = await runInit({
      homeDir,
      repoRoot,
      design: 'dewey-interface',
      mode: 'copy',
      force: true,
    })

    assert.deepEqual(result.assets, {
      skills: [],
      rules: [],
      design: 'dewey-interface',
    })
    assert.match(await readFile(join(repoRoot, 'DESIGN.md'), 'utf8'), /Dewey interface/)
  })

  it('dispatches main commands through dynamic command handlers', async () => {
    const calls = []

    vi.doMock('../src/cli/init.ts', () => ({
      runInit: async (flags) => calls.push(['init', flags]),
    }))
    vi.doMock('../src/cli/cache.ts', () => ({
      runUpdate: async (flags) => calls.push(['update', flags]),
    }))
    vi.doMock('../src/cli/context.ts', () => ({
      runContext: async (flags) => calls.push(['context', flags]),
    }))
    vi.doMock('../src/cli/doctor.ts', () => ({
      runDoctor: async (flags) => calls.push(['doctor', flags]),
    }))

    vi.resetModules()
    const { main } = await import('../src/cli/main.ts')

    await main(['agent', 'init', '--all'])
    await main(['agent', 'update'])
    await main(['agent', 'context'])
    await main(['agent', 'doctor'])

    assert.deepEqual(calls, [
      ['init', { all: true }],
      ['update', {}],
      ['context', { format: 'markdown' }],
      ['doctor', {}],
    ])

    vi.doUnmock('../src/cli/init.ts')
    vi.doUnmock('../src/cli/cache.ts')
    vi.doUnmock('../src/cli/context.ts')
    vi.doUnmock('../src/cli/doctor.ts')
  })

  it('validates generated registry frontmatter shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))

    await mkdir(join(root, 'skills/demo'), { recursive: true })
    await writeFile(join(root, 'skills/demo/SKILL.md'), '# Missing frontmatter')
    await assert.rejects(() => loadRegistry(root), /must include YAML frontmatter/)

    await writeFile(
      join(root, 'skills/demo/SKILL.md'),
      `---
name: demo
description: Demo
tags: demo
---
`,
    )
    await assert.rejects(() => loadRegistry(root), /frontmatter tags must be an array/)

    await writeFile(
      join(root, 'skills/demo/SKILL.md'),
      `---
name: demo
description: Demo
tags: [demo, ""]
---
`,
    )
    await assert.rejects(
      () => loadRegistry(root),
      /frontmatter tags\[1\] must be a non-empty string/,
    )
  })

  it('validates generated registry frontmatter names and descriptions', async () => {
    const root = await createAssetHub()

    await writeFile(
      join(root, 'rules/demo-rule.md'),
      `---
name: other-rule
description: Demo rule
---
`,
    )
    await assert.rejects(() => loadRegistry(root), /name must match frontmatter/)

    await writeFile(
      join(root, 'rules/demo-rule.md'),
      `---
name: demo-rule
description:
---
`,
    )
    await assert.rejects(
      () => loadRegistry(root),
      /frontmatter description must be a non-empty string/,
    )
  })

  it('validates registry frontmatter edge cases', async () => {
    const root = await createAssetHub()

    await writeFile(join(root, 'skills/demo/SKILL.md'), '# No frontmatter')
    await assert.rejects(() => loadRegistry(root), /must include YAML frontmatter/)

    await writeFile(
      join(root, 'skills/demo/SKILL.md'),
      `---
- nope
---
`,
    )
    await assert.rejects(() => loadRegistry(root), /frontmatter must be an object/)

    await writeFile(
      join(root, 'skills/demo/SKILL.md'),
      `---
name: demo
description: ""
---
`,
    )
    await assert.rejects(() => loadRegistry(root), /frontmatter description/)
  })

  it('bubbles default source clone failures when no source override exists', async () => {
    await assert.rejects(
      () =>
        resolveSourceRoot({
          env: {},
          execFile: async () => {
            throw new Error('clone failed')
          },
        }),
      /clone failed/,
    )
  })

  it('bubbles default source pull failures for existing source checkouts', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    await mkdir(join(homeDir, '.deweyou/agents/source/.git'), {
      recursive: true,
    })

    await assert.rejects(
      () =>
        resolveSourceRoot({
          env: {},
          homeDir,
          execFile: async () => {
            throw new Error('pull failed')
          },
        }),
      /pull failed/,
    )
  })

  it('rejects prompts that return no selected asset object', async () => {
    const { homeDir, repoRoot } = await createFixture({ mode: 'pointer' })

    await assert.rejects(
      () =>
        runInit(
          { homeDir, repoRoot },
          {
            async promptForInit() {
              return {
                mode: 'pointer',
              } as any
            },
          },
        ),
      /No assets selected/,
    )
  })

  it('reports non-missing filesystem errors while reading context paths', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
    const cacheRoot = join(homeDir, '.deweyou/agents/assets')

    await mkdir(join(repoRoot, '.agents'), { recursive: true })
    await mkdir(join(homeDir, '.deweyou/agents'), { recursive: true })
    await mkdir(join(cacheRoot, 'registry.json'), { recursive: true })
    await writeJson(join(repoRoot, '.agents/manifest.json'), {
      mode: 'pointer',
      source: { root: 'test-source', commit: null },
      cacheRoot,
      assets: { skills: [], rules: [] },
      assetSnapshot: { skills: {}, rules: {} },
    })

    await assert.rejects(() => resolveContext({ repoRoot, homeDir }), /EISDIR/)
  })
})

async function createFixture({ mode }) {
  const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
  const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
  const sourceRoot = await createAssetHub()

  await updateCache({ homeDir, sourceRoot, cliVersion: '0.1.0' })
  await initRepo({
    homeDir,
    repoRoot,
    selected: { skills: ['demo'], rules: ['demo-rule'] },
    mode,
    skillsInstaller: createFakeSkillsInstaller(homeDir),
  })

  return { homeDir, repoRoot, sourceRoot }
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

async function createAssetHub() {
  const root = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))

  await mkdir(join(root, 'skills/demo'), { recursive: true })
  await mkdir(join(root, 'rules'), { recursive: true })
  await mkdir(join(root, 'design'), { recursive: true })
  await writeFile(
    join(root, 'skills/demo/SKILL.md'),
    `---
name: demo
description: Demo skill
---

# Demo skill
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

# Dewey interface
`,
  )
  return root
}

async function writeJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function execGit(cwd, args) {
  const { execFile } = await import('node:child_process')

  return await new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
        return
      }
      resolve(stdout)
    })
  })
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

async function withEnv(name, value, callback) {
  const original = process.env[name]
  process.env[name] = value

  try {
    return await callback()
  } finally {
    if (original === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = original
    }
  }
}

function failMessages(result) {
  return result.checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.message)
    .join('\n')
}
