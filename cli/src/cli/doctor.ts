import { lstat, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { cachePaths } from './cache.ts'
import { readJson } from './manifest.ts'
import type {
  AssetKind,
  AssetRegistry,
  DoctorCheck,
  DoctorFlags,
  DoctorResult,
  RepoManifest,
} from './types.ts'

export async function checkDoctor({
  repoRoot = process.cwd(),
  homeDir = homedir(),
}: DoctorFlags = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = []
  const paths = cachePaths({ homeDir })
  const registryPath = join(paths.assetsRoot, 'registry.json')
  const manifestPath = join(repoRoot, '.agents', 'manifest.json')
  const agentsMdPath = join(repoRoot, 'AGENTS.md')

  const registry = await readJsonCheck({
    path: registryPath,
    checks,
    passMessage: 'local asset cache registry exists',
    missingMessage: 'Dewey asset cache is missing. Run `deweyou-cli agent update`.',
    invalidMessage: 'Dewey asset cache registry is invalid JSON.',
  })
  const manifest = await readJsonCheck({
    path: manifestPath,
    checks,
    passMessage: 'repository manifest exists',
    missingMessage:
      'repository manifest is missing. Run `deweyou-cli agent init`.',
    invalidMessage: 'repository manifest is invalid JSON.',
  })
  const registryValid =
    registry !== undefined && validateRegistry(registry, checks)
  const manifestValid =
    manifest !== undefined && validateManifest(manifest, checks)

  if (!manifestValid || requiresAgentsMd(manifest as RepoManifest)) {
    await statCheck({
      path: agentsMdPath,
      checks,
      passMessage: 'AGENTS.md exists',
      missingMessage: 'AGENTS.md is missing. Run `deweyou-cli agent init`.',
    })
  }

  if (manifestValid && registryValid) {
    const validManifest = manifest as RepoManifest
    const validRegistry = registry as AssetRegistry
    await checkSelectedAssets({
      repoRoot,
      cacheRoot: validManifest.cacheRoot,
      manifest: validManifest,
      registry: validRegistry,
      checks,
    })
  }

  return {
    ok: checks.every((check) => check.status === 'pass'),
    checks,
  }
}

export async function runDoctor(flags: DoctorFlags = {}): Promise<DoctorResult> {
  const result = await checkDoctor({
    repoRoot: flags.repoRoot ?? process.cwd(),
    homeDir: flags.homeDir ?? homedir(),
  })

  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase()} ${check.message}`)
  }

  if (!result.ok) {
    process.exitCode = 1
  }

  return result
}

async function readJsonCheck({
  path,
  checks,
  passMessage,
  missingMessage,
  invalidMessage,
}: {
  path: string
  checks: DoctorCheck[]
  passMessage: string
  missingMessage: string
  invalidMessage: string
}): Promise<unknown> {
  try {
    const value = await readJson(path)
    checks.push(pass(passMessage))
    return value
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Error throws */
    if (!(error instanceof Error)) throw error
    if (!('code' in error)) {
      if (error instanceof SyntaxError) {
        checks.push(fail(invalidMessage))
        return undefined
      }
      /* v8 ignore next -- unexpected JSON helper errors should bubble */
      throw error
    }
    if (error.code === 'ENOENT') {
      checks.push(fail(missingMessage))
      return undefined
    }

    /* v8 ignore next -- retained for JSON parsers that attach code fields */
    if (error instanceof SyntaxError) {
      checks.push(fail(invalidMessage))
      return undefined
    }

    /* v8 ignore next -- non-missing read errors should bubble to the caller */
    throw error
  }
}

async function statCheck({
  path,
  checks,
  passMessage,
  missingMessage,
}: {
  path: string
  checks: DoctorCheck[]
  passMessage: string
  missingMessage: string
}): Promise<boolean> {
  try {
    await stat(path)
    checks.push(pass(passMessage))
    return true
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') {
      checks.push(fail(missingMessage))
      return false
    }

    /* v8 ignore next -- non-missing stat errors should bubble to the caller */
    throw error
  }
}

function validateRegistry(
  registry: unknown,
  checks: DoctorCheck[],
): registry is AssetRegistry {
  const before = checks.length

  if (!isPlainObject(registry)) {
    checks.push(fail('registry must be an object'))
    return false
  }

  if (!isPlainObject(registry.assets)) {
    checks.push(fail('registry assets must be an object'))
  }

  const assets = isPlainObject(registry.assets) ? registry.assets : {}

  if (!isPlainObject(assets.skills)) {
    checks.push(fail('registry assets.skills must be an object'))
  }

  if (!isPlainObject(assets.rules)) {
    checks.push(fail('registry assets.rules must be an object'))
  }

  if (!isPlainObject(assets.designs)) {
    checks.push(fail('registry assets.designs must be an object'))
  }

  if (isPlainObject(assets.skills)) {
    validateRegistryAssetGroup(assets.skills, 'skill', checks)
  }

  if (isPlainObject(assets.rules)) {
    validateRegistryAssetGroup(assets.rules, 'rule', checks)
  }

  if (isPlainObject(assets.designs)) {
    validateRegistryAssetGroup(assets.designs, 'design', checks)
  }

  return checks.length === before
}

function validateManifest(
  manifest: unknown,
  checks: DoctorCheck[],
): manifest is RepoManifest {
  const before = checks.length

  if (!isPlainObject(manifest)) {
    checks.push(fail('manifest must be an object'))
    return false
  }

  if (
    typeof manifest.mode !== 'string' ||
    !['link', 'copy', 'pointer'].includes(manifest.mode)
  ) {
    checks.push(fail('manifest mode must be one of link, copy, or pointer'))
  }

  if (!isPlainObject(manifest.source)) {
    checks.push(fail('manifest source must be an object'))
  } else {
    if (typeof manifest.source.root !== 'string') {
      checks.push(fail('manifest source.root must be a string'))
    }
    if (
      manifest.source.commit !== null &&
      typeof manifest.source.commit !== 'string'
    ) {
      checks.push(fail('manifest source.commit must be a string or null'))
    }
  }

  if (typeof manifest.cacheRoot !== 'string') {
    checks.push(fail('manifest cacheRoot must be a string'))
  }

  if (!isPlainObject(manifest.assets)) {
    checks.push(fail('manifest assets must be an object'))
  }

  const assets = isPlainObject(manifest.assets) ? manifest.assets : {}

  if (!Array.isArray(assets.skills)) {
    checks.push(fail('manifest assets.skills must be an array'))
  }

  if (!Array.isArray(assets.rules)) {
    checks.push(fail('manifest assets.rules must be an array'))
  }

  if (
    assets.design !== undefined &&
    assets.design !== null &&
    typeof assets.design !== 'string'
  ) {
    checks.push(fail('manifest assets.design must be a string or null'))
  }

  return checks.length === before
}

function requiresAgentsMd(manifest: RepoManifest): boolean {
  return manifest.assets.rules.length > 0 || Boolean(manifest.assets.design)
}

async function checkSelectedAssets({
  repoRoot,
  cacheRoot,
  manifest,
  registry,
  checks,
}: {
  repoRoot: string
  cacheRoot: string
  manifest: RepoManifest
  registry: AssetRegistry
  checks: DoctorCheck[]
}): Promise<void> {
  const registryAssets = {
    skills: registry.assets?.skills ?? {},
    rules: registry.assets?.rules ?? {},
    designs: registry.assets?.designs ?? {},
  }
  const selected = {
    skills: manifest.assets?.skills ?? [],
    rules: manifest.assets?.rules ?? [],
    designs: manifest.assets?.design ? [manifest.assets.design] : [],
  }
  const snapshot = {
    skills: manifest.assetSnapshot?.skills ?? {},
    rules: manifest.assetSnapshot?.rules ?? {},
    designs: manifest.assetSnapshot?.designs ?? {},
  }

  for (const name of selected.skills) {
    const asset = registryAssets.skills[name]
    if (!asset) {
      checks.push(fail(`selected skill ${name} is missing from the registry`))
      continue
    }

    if (!isValidRegistryPath(asset.path)) {
      checks.push(fail(`selected skill ${name} has invalid registry path`))
      continue
    }

    checkAssetHashSnapshot({
      kind: 'skill',
      name,
      currentHash: asset.hash,
      snapshotHash: snapshot.skills[name]?.hash,
      checks,
    })

    await checkAssetPath({
      kind: 'skill',
      name,
      filePath:
        manifest.mode === 'pointer'
          ? join(cacheRoot, asset.path, 'SKILL.md')
          : join(repoRoot, '.agents', 'skills', name, 'SKILL.md'),
      linkPath:
        manifest.mode === 'pointer'
          ? null
          : join(repoRoot, '.agents', 'skills', name),
      checks,
    })
  }

  for (const name of selected.rules) {
    const asset = registryAssets.rules[name]
    if (!asset) {
      checks.push(fail(`selected rule ${name} is missing from the registry`))
      continue
    }

    if (!isValidRegistryPath(asset.path)) {
      checks.push(fail(`selected rule ${name} has invalid registry path`))
      continue
    }

    checkAssetHashSnapshot({
      kind: 'rule',
      name,
      currentHash: asset.hash,
      snapshotHash: snapshot.rules[name]?.hash,
      checks,
    })

    const filePath =
      manifest.mode === 'pointer'
        ? join(cacheRoot, asset.path)
        : join(repoRoot, '.agents', 'rules', `${name}.md`)

    await checkAssetPath({
      kind: 'rule',
      name,
      filePath,
      linkPath: manifest.mode === 'pointer' ? null : filePath,
      checks,
    })
  }

  for (const name of selected.designs) {
    const asset = registryAssets.designs[name]
    if (!asset) {
      checks.push(fail(`selected design ${name} is missing from the registry`))
      continue
    }

    if (!isValidRegistryPath(asset.path)) {
      checks.push(fail(`selected design ${name} has invalid registry path`))
      continue
    }

    checkAssetHashSnapshot({
      kind: 'design',
      name,
      currentHash: asset.hash,
      snapshotHash: snapshot.designs[name]?.hash,
      checks,
    })

    await checkAssetPath({
      kind: 'design',
      name,
      filePath:
        manifest.mode === 'pointer'
          ? join(cacheRoot, asset.path)
          : join(repoRoot, 'DESIGN.md'),
      linkPath: manifest.mode === 'pointer' ? null : join(repoRoot, 'DESIGN.md'),
      checks,
    })
  }
}

function validateRegistryAssetGroup(
  assets: Record<string, unknown>,
  kind: AssetKind,
  checks: DoctorCheck[],
): void {
  for (const [name, asset] of Object.entries(assets)) {
    if (!isPlainObject(asset)) {
      checks.push(fail(`registry ${kind} ${name} must be an object`))
      continue
    }
    if (typeof asset.path !== 'string') {
      checks.push(fail(`registry ${kind} ${name} path must be a string`))
    }
    if (typeof asset.description !== 'string') {
      checks.push(fail(`registry ${kind} ${name} description must be a string`))
    }
    if (typeof asset.hash !== 'string' || !asset.hash.startsWith('sha256:')) {
      checks.push(fail(`registry ${kind} ${name} hash must be a sha256 content hash`))
    }
    if (!Array.isArray(asset.tags)) {
      checks.push(fail(`registry ${kind} ${name} tags must be an array`))
    }
  }
}

function checkAssetHashSnapshot({
  kind,
  name,
  currentHash,
  snapshotHash,
  checks,
}: {
  kind: AssetKind
  name: string
  currentHash: string
  snapshotHash?: string
  checks: DoctorCheck[]
}): void {
  if (!snapshotHash) {
    checks.push(fail(`selected ${kind} ${name} is missing an initialized hash snapshot`))
    return
  }

  if (currentHash !== snapshotHash) {
    checks.push(fail(`selected ${kind} ${name} has changed in the local asset cache`))
  }
}

async function checkAssetPath({
  kind,
  name,
  filePath,
  linkPath,
  checks,
}: {
  kind: AssetKind
  name: string
  filePath: string
  linkPath: string | null
  checks: DoctorCheck[]
}): Promise<void> {
  if (linkPath) {
    const linkOk = await checkLinkTarget({ kind, name, linkPath, checks })
    if (!linkOk) return
  }

  try {
    await stat(filePath)
    checks.push(pass(`selected ${kind} ${name} path exists`))
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') {
      checks.push(fail(`selected ${kind} ${name} path is missing: ${filePath}`))
      return
    }

    /* v8 ignore next -- non-missing stat errors should bubble to the caller */
    throw error
  }
}

async function checkLinkTarget({
  kind,
  name,
  linkPath,
  checks,
}: {
  kind: AssetKind
  name: string
  linkPath: string
  checks: DoctorCheck[]
}): Promise<boolean> {
  let entry

  try {
    entry = await lstat(linkPath)
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') {
      checks.push(fail(`selected ${kind} ${name} path is missing: ${linkPath}`))
      return false
    }

    /* v8 ignore next -- non-missing lstat errors should bubble to the caller */
    throw error
  }

  if (!entry.isSymbolicLink()) return true

  try {
    await stat(linkPath)
    return true
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') {
      checks.push(fail(`selected ${kind} ${name} symlink is broken: ${linkPath}`))
      return false
    }

    /* v8 ignore next -- non-missing stat errors should bubble to the caller */
    throw error
  }
}

function pass(message: string): DoctorCheck {
  return { status: 'pass', message }
}

function fail(message: string): DoctorCheck {
  return { status: 'fail', message }
}

function isValidRegistryPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
