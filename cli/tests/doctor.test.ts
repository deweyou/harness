import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { updateCache } from '../src/cli/cache.ts'
import { checkDoctor } from '../src/cli/doctor.ts'
import { initRepo } from '../src/cli/init.ts'

describe('checkDoctor', () => {
  it('passes every check for a healthy initialized link-mode repo', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, true)
    assert.equal(result.checks.length > 0, true)
    assert.deepEqual(
      result.checks.map((check) => check.status),
      result.checks.map(() => 'pass'),
    )
  })

  it('passes for a skills-only repo without AGENTS.md', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({
      mode: 'link',
      selected: { skills: ['demo'], rules: [] },
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, true)
    assert.doesNotMatch(
      result.checks.map((check) => check.message).join('\n'),
      /AGENTS\.md/,
    )
  })

  it('passes for a design-only repo with AGENTS.md routing', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({
      mode: 'link',
      selected: { skills: [], rules: [], design: 'dewey-interface' },
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, true)
    assert.match(
      result.checks.map((check) => check.message).join('\n'),
      /AGENTS\.md exists/,
    )
  })

  it('fails when the local asset cache registry is missing', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })

    await rm(join(homeDir, '.deweyou/agents/assets'), {
      recursive: true,
      force: true,
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(
      result.checks.find((check) => check.status === 'fail')?.message ?? '',
      /asset cache is missing/,
    )
  })

  it('fails when a selected asset symlink is broken', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })

    await rm(join(homeDir, '.deweyou/agents/assets/skills/demo'), {
      recursive: true,
      force: true,
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(
      result.checks.find((check) => check.status === 'fail')?.message ?? '',
      /broken/,
    )
  })

  it('fails instead of throwing when a selected registry path is malformed', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'pointer' })
    const registryPath = join(homeDir, '.deweyou/agents/assets/registry.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.assets.skills.demo.path = {}
    await writeJsonFile(registryPath, registry)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(
      result.checks.find((check) => check.status === 'fail')?.message ?? '',
      /registry skill demo path must be a string/,
    )
  })

  it('fails when the registry JSON is null', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })
    await writeJsonFile(
      join(homeDir, '.deweyou/agents/assets/registry.json'),
      null,
    )

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /registry must be an object/)
  })

  it('fails when the registry has a malformed shape', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })
    await writeJsonFile(join(homeDir, '.deweyou/agents/assets/registry.json'), {
      assets: {
        skills: [],
        rules: null,
      },
    })

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(
      failMessages(result),
      /registry assets\.skills must be an object/,
    )
    assert.match(
      failMessages(result),
      /registry assets\.rules must be an object/,
    )
  })

  it('fails when the manifest mode is unsupported', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.mode = 'typo'
    await writeJsonFile(manifestPath, manifest)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /manifest mode must be one of/)
  })

  it('fails without throwing when manifest assets.skills is not an array', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.assets.skills = { demo: true }
    await writeJsonFile(manifestPath, manifest)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(
      failMessages(result),
      /manifest assets\.skills must be an array/,
    )
  })

  it('fails without throwing when manifest assets.rules is not an array', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'link' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.assets.rules = 'demo-rule'
    await writeJsonFile(manifestPath, manifest)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(
      failMessages(result),
      /manifest assets\.rules must be an array/,
    )
  })

  it('fails when a pointer manifest is missing cacheRoot', async () => {
    const { homeDir, repoRoot } = await createDoctorFixture({ mode: 'pointer' })
    const manifestPath = join(repoRoot, '.agents/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.cacheRoot
    await writeJsonFile(manifestPath, manifest)

    const result = await checkDoctor({ homeDir, repoRoot })

    assert.equal(result.ok, false)
    assert.match(failMessages(result), /manifest cacheRoot must be a string/)
  })
})

async function createDoctorFixture({
  mode,
  selected = { skills: ['demo'], rules: ['demo-rule'] },
} = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-home-'))
  const repoRoot = await mkdtemp(join(tmpdir(), 'deweyou-repo-'))
  const sourceRoot = await createAssetHub()

  await updateCache({
    homeDir,
    sourceRoot,
    cliVersion: '0.1.0',
  })
  await initRepo({
    homeDir,
    repoRoot,
    selected,
    mode,
    skillsInstaller: createFakeSkillsInstaller(homeDir),
  })

  return { homeDir, repoRoot }
}

function createFakeSkillsInstaller(homeDir) {
  const assetsRoot = join(homeDir, '.deweyou/agents/assets')

  return async ({ cwd, skills }) => {
    await Promise.all(
      skills.map(async (skill) => {
        const source = join(assetsRoot, 'skills', skill)
        const destination = join(cwd, '.agents/skills', skill)

        await rm(destination, { recursive: true, force: true })
        await mkdir(join(destination, '..'), { recursive: true })
        await symlink(await realpath(source), destination)
      }),
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

# Demo skill body
`,
  )

  await writeFile(
    join(root, 'rules/demo-rule.md'),
    `---
name: demo-rule
description: Demo rule
---

# Demo rule body
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

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function failMessages(result) {
  return result.checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.message)
    .join('\n')
}
