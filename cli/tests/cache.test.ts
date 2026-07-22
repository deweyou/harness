import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { cachePaths, updateCache } from '../src/cli/cache.ts'
import { readJson, writeJson } from '../src/cli/manifest.ts'
import { resolveSourceRoot } from '../src/cli/source.ts'
import { CLI_CAPABILITIES } from '../src/cli/version-contract.ts'

describe('cachePaths', () => {
  it('returns the cache root, assets root, and manifest path', () => {
    const homeDir = '/tmp/dewey-home'

    assert.deepEqual(cachePaths({ homeDir }), {
      root: join(homeDir, '.deweyou', 'agents'),
      assetsRoot: join(homeDir, '.deweyou', 'agents', 'assets'),
      manifestPath: join(homeDir, '.deweyou', 'agents', 'manifest.json'),
    })
  })
})

describe('updateCache', () => {
  it('generates a registry and copies skills and rules into the local assets cache', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = await createAssetHub()

    const manifest = await updateCache({
      homeDir,
      sourceRoot,
      cliVersion: '0.1.0',
    })
    const paths = cachePaths({ homeDir })

    const registry = await readJson(join(paths.assetsRoot, 'registry.json'))
    assert.equal(registry.assets.skills.demo.path, 'skills/demo')
    assert.equal(registry.assets.skills.demo.description, 'Demo skill')
    assert.match(registry.assets.skills.demo.hash, /^sha256:[a-f0-9]{64}$/)
    assert.deepEqual(registry.assets.skills.demo.tags, [])
    assert.equal(registry.assets.rules['demo-rule'].path, 'rules/demo-rule.md')
    assert.match(registry.assets.rules['demo-rule'].hash, /^sha256:[a-f0-9]{64}$/)
    assert.equal(
      await readFile(join(paths.assetsRoot, 'skills/demo/SKILL.md'), 'utf8'),
      await readFile(join(sourceRoot, 'skills/demo/SKILL.md'), 'utf8'),
    )
    assert.equal(
      await readFile(join(paths.assetsRoot, 'rules/demo-rule.md'), 'utf8'),
      await readFile(join(sourceRoot, 'rules/demo-rule.md'), 'utf8'),
    )

    assert.deepEqual(await readJson(paths.manifestPath), manifest)
    assert.deepEqual(manifest.source, { root: sourceRoot, commit: null })
    assert.equal(manifest.cliVersion, '0.1.0')
    assert.deepEqual(manifest.capabilities, CLI_CAPABILITIES)
    assert.equal(Number.isNaN(Date.parse(manifest.updatedAt)), false)
  })

  it('replaces an existing assets cache', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = await createAssetHub()
    const paths = cachePaths({ homeDir })

    await mkdir(paths.assetsRoot, { recursive: true })
    await writeFile(join(paths.assetsRoot, 'stale.txt'), 'old cache')

    await updateCache({ homeDir, sourceRoot, cliVersion: '0.1.0' })

    await assert.rejects(() => stat(join(paths.assetsRoot, 'stale.txt')), {
      code: 'ENOENT',
    })
  })

  it('keeps existing assets and manifest when a replacement copy fails', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const oldSourceRoot = await createAssetHub()
    const paths = cachePaths({ homeDir })

    const oldManifest = await updateCache({
      homeDir,
      sourceRoot: oldSourceRoot,
      cliVersion: '0.1.0',
    })
    const oldRegistry = await readFile(
      join(paths.assetsRoot, 'registry.json'),
      'utf8',
    )
    const oldSkill = await readFile(
      join(paths.assetsRoot, 'skills/demo/SKILL.md'),
      'utf8',
    )
    const oldRule = await readFile(
      join(paths.assetsRoot, 'rules/demo-rule.md'),
      'utf8',
    )

    const incompleteSourceRoot = await createAssetHub({
      inaccessibleRulesDir: true,
      includeRuleFile: false,
    })

    await assert.rejects(
      () =>
        updateCache({
          homeDir,
          sourceRoot: incompleteSourceRoot,
          cliVersion: '0.1.0',
        }),
      { code: 'EACCES' },
    )

    assert.equal(
      await readFile(join(paths.assetsRoot, 'registry.json'), 'utf8'),
      oldRegistry,
    )
    assert.equal(
      await readFile(join(paths.assetsRoot, 'skills/demo/SKILL.md'), 'utf8'),
      oldSkill,
    )
    assert.equal(
      await readFile(join(paths.assetsRoot, 'rules/demo-rule.md'), 'utf8'),
      oldRule,
    )
    assert.deepEqual(await readJson(paths.manifestPath), oldManifest)
  })
})

describe('manifest json helpers', () => {
  it('writes pretty JSON with a trailing newline and creates parent directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-manifest-'))
    const path = join(root, 'nested', 'manifest.json')
    const value = {
      source: { root: '/tmp/source', commit: null },
      cliVersion: '0.1.0',
    }

    await writeJson(path, value)

    assert.equal(
      await readFile(path, 'utf8'),
      `${JSON.stringify(value, null, 2)}\n`,
    )
  })

  it('returns fallback when reading a missing JSON file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-manifest-'))
    const fallback = { source: { root: 'fallback', commit: null } }

    assert.deepEqual(
      await readJson(join(root, 'missing.json'), fallback),
      fallback,
    )
  })

  it('throws when reading a missing JSON file without fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-manifest-'))

    await assert.rejects(() => readJson(join(root, 'missing.json')), {
      code: 'ENOENT',
    })
  })
})

describe('resolveSourceRoot', () => {
  it('returns DEWEYOU_AGENTS_SOURCE when configured', async () => {
    const sourceRoot = '/tmp/deweyou-assets'
    const execCalls = []

    assert.equal(
      await resolveSourceRoot({
        env: { DEWEYOU_AGENTS_SOURCE: sourceRoot },
        execFile: async (...args) => {
          execCalls.push(args)
          return { stdout: '', stderr: '' }
        },
      }),
      sourceRoot,
    )
    assert.deepEqual(execCalls, [])
  })

  it('clones the default agents source into the Dewey cache when no override exists', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const execCalls = []

    const sourceRoot = await resolveSourceRoot({
      homeDir,
      env: {},
      execFile: async (...args) => {
        execCalls.push(args)
        return { stdout: '', stderr: '' }
      },
    })

    assert.equal(sourceRoot, join(homeDir, '.deweyou/agents/source'))
    assert.deepEqual(execCalls, [
      [
        'git',
        [
          'clone',
          '--depth',
          '1',
          'https://github.com/deweyou/agents.git',
          sourceRoot,
        ],
      ],
    ])
  })

  it('pulls the default agents source when the cached checkout already exists', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
    const sourceRoot = join(homeDir, '.deweyou/agents/source')
    const execCalls = []

    await mkdir(join(sourceRoot, '.git'), { recursive: true })

    assert.equal(
      await resolveSourceRoot({
        homeDir,
        env: {},
        execFile: async (...args) => {
          execCalls.push(args)
          return { stdout: '', stderr: '' }
        },
      }),
      sourceRoot,
    )
    assert.deepEqual(execCalls, [
      ['git', ['-C', sourceRoot, 'pull', '--ff-only']],
    ])
  })
})

async function createAssetHub(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'deweyou-assets-'))

  await mkdir(join(root, 'skills/demo'), { recursive: true })
  await mkdir(join(root, 'rules'), { recursive: true })

  await writeFile(
    join(root, 'skills/demo/SKILL.md'),
    `---
name: demo
description: Demo skill
---

# Demo
`,
  )

  if (options.includeRuleFile !== false) {
    await writeFile(
      join(root, 'rules/demo-rule.md'),
      `---
name: demo-rule
description: Demo rule
---

# Demo rule
`,
    )
  }

  if (options.inaccessibleRulesDir) {
    await chmod(join(root, 'rules'), 0o000)
  }

  return root
}
