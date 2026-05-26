import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'

import { cachePaths } from './cache.ts'
import { readJson, writeJson } from './manifest.ts'
import { upsertAgentsSection } from './agents-md.ts'
import { applyRuleInstall, planRuleInstall } from './rule-install.ts'
import { runSkillsInstall } from './skill-install.ts'
import type { SkillsInstaller } from './skill-install.ts'
import type {
  AssetKind,
  AssetMetadata,
  AssetPlan,
  AssetRegistry,
  CacheManifest,
  CachePaths,
  GlobalManifest,
  InitFlags,
  InitPlan,
  InitRepoOptions,
  InitResult,
  InstallMode,
  InstallScope,
  InstallTool,
  RegistryAsset,
  RepoManifest,
  RuleWiring,
  SelectedAssets,
  ToolSelection,
} from './types.ts'

const VALID_MODES = new Set<InstallMode>(['link', 'copy', 'pointer'])
const VALID_SCOPES = new Set<InstallScope>(['project', 'global'])
const VALID_TOOLS = new Set<InstallTool>(['codex', 'claude'])
const VALID_TOOL_SELECTIONS = new Set<ToolSelection[number]>([
  'all',
  'codex',
  'claude',
])
const VALID_RULE_WIRING = new Set<RuleWiring>(['reference', 'inline'])
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function initRepo(options: InitRepoOptions = {}): Promise<InitResult> {
  const {
    repoRoot = process.cwd(),
    homeDir = homedir(),
    mode = 'link',
    selected,
    force = false,
    dryRun = false,
    skillsInstaller = runSkillsInstall,
  } = options
  if (!selected) {
    throw new Error('selected assets are required')
  }
  const scope = options.scope ?? 'project'
  const ruleWiring = options.ruleWiring ?? 'reference'
  validateScope(scope)
  validateRuleWiring(ruleWiring)
  const tools = normalizeTools(options.tools)
  validateMode(mode)

  const paths = cachePaths({ homeDir })
  const registry = await readCachedRegistry(paths.assetsRoot)
  const cacheManifest = await readCacheManifest(paths.manifestPath)
  const assets = normalizeSelected(selected)
  const agentsRoot = join(repoRoot, '.agents')

  validateSelectedAssets(registry, assets)
  if (scope === 'global') {
    return await initGlobal({
      homeDir,
      repoRoot,
      paths,
      registry,
      cacheManifest,
      assets,
      tools,
      ruleWiring,
      force,
      dryRun,
      skillsInstaller,
    })
  }

  const plan = await buildInitPlan({
    repoRoot,
    agentsRoot,
    assetsRoot: paths.assetsRoot,
    registry,
    assets,
    mode,
  })
  const skillFiles = mode === 'pointer'
    ? []
    : projectSkillFiles({ repoRoot, assets, tools })
  const skillPlan = mode === 'pointer'
    ? { assets: [], files: [] }
    : await buildSkillSafetyPlan({
        assetsRoot: paths.assetsRoot,
        registry,
        skills: assets.skills,
        destinations: skillFiles,
        mode,
      })
  if (mode !== 'pointer') {
    await validateSelectedSkillSources(paths.assetsRoot, registry, assets.skills)
  }

  if (mode !== 'pointer') {
    await validateDestinationSafety({
      plan: {
        assets: [...skillPlan.assets, ...plan.assets],
        files: [...skillPlan.files, ...plan.files],
      },
      manifestPath: join(agentsRoot, 'manifest.json'),
      assetsRoot: paths.assetsRoot,
      force,
    })
  }

  const manifest: RepoManifest = {
    mode,
    source: cacheManifest.source,
    cacheRoot: paths.assetsRoot,
    assets,
    assetSnapshot: snapshotSelectedAssetMetadata(registry, assets),
    scope,
    tools,
    ruleWiring,
    initializedAt: new Date().toISOString(),
  }

  const rulePlan = await planRuleInstall({
    repoRoot,
    homeDir,
    cacheRoot: paths.assetsRoot,
    scope: 'project',
    tools,
    ruleWiring,
    selectedRules: assets.rules,
    rulePaths: projectRulePathMap(
      repoRoot,
      paths.assetsRoot,
      registry,
      assets,
      mode,
      ruleWiring,
    ),
    ruleDescriptions: ruleDescriptionMap(registry, assets.rules),
  })

  if (dryRun) {
    return {
      ...manifest,
      dryRun: true,
      files: uniqueFiles([...skillFiles, ...plan.files, ...rulePlan.files]),
    }
  }

  await mkdir(agentsRoot, { recursive: true })

  if (mode !== 'pointer') {
    if (assets.skills.length > 0) {
      await skillsInstaller({
        cwd: repoRoot,
        source: cacheManifest.source.root,
        skills: assets.skills,
        tools,
        scope: 'project',
        mode,
      })
    }
    await installAssets(plan.assets)
  }

  await writeJson(join(agentsRoot, 'manifest.json'), manifest)
  await upsertAgentsSection(repoRoot)
  await applyRuleInstall(rulePlan)

  return manifest
}

async function initGlobal({
  homeDir,
  repoRoot,
  paths,
  registry,
  cacheManifest,
  assets,
  tools,
  ruleWiring,
  force,
  dryRun,
  skillsInstaller,
}: {
  homeDir: string
  repoRoot: string
  paths: CachePaths
  registry: AssetRegistry
  cacheManifest: CacheManifest
  assets: SelectedAssets
  tools: InstallTool[]
  ruleWiring: RuleWiring
  force: boolean
  dryRun: boolean
  skillsInstaller: SkillsInstaller
}): Promise<InitResult> {
  if (assets.design) {
    throw new Error('Global installs currently do not support design contracts')
  }

  await validateSelectedSkillSources(paths.assetsRoot, registry, assets.skills)
  const skillFiles = globalSkillFiles({ homeDir, assets, tools })
  const skillPlan = await buildSkillSafetyPlan({
    assetsRoot: paths.assetsRoot,
    registry,
    skills: assets.skills,
    destinations: skillFiles,
    mode: 'link',
  })
  const rulePlan = await planRuleInstall({
    repoRoot,
    homeDir,
    cacheRoot: paths.assetsRoot,
    scope: 'global',
    tools,
    ruleWiring,
    selectedRules: assets.rules,
    rulePaths: rulePathMap(paths.assetsRoot, registry, assets.rules),
    ruleDescriptions: ruleDescriptionMap(registry, assets.rules),
  })
  await validateGlobalSkillDestinationSafety({
    plan: skillPlan,
    manifestPath: join(homeDir, '.deweyou/agents/global-manifest.json'),
    assetsRoot: paths.assetsRoot,
    tools,
    force,
  })
  const manifest: GlobalManifest = {
    scope: 'global',
    source: cacheManifest.source,
    cacheRoot: paths.assetsRoot,
    assets,
    assetSnapshot: snapshotSelectedAssetMetadata(registry, assets),
    tools,
    ruleWiring,
    initializedAt: new Date().toISOString(),
  }

  if (dryRun) {
    return {
      ...manifest,
      dryRun: true,
      files: uniqueFiles([
        ...skillFiles,
        ...rulePlan.files,
        join(homeDir, '.deweyou/agents/global-manifest.json'),
      ]),
    }
  }

  if (assets.skills.length > 0) {
    await skillsInstaller({
      cwd: repoRoot,
      source: cacheManifest.source.root,
      skills: assets.skills,
      tools,
      scope: 'global',
      mode: 'link',
    })
  }
  await applyRuleInstall(rulePlan)
  await writeJson(join(homeDir, '.deweyou/agents/global-manifest.json'), manifest)
  return manifest
}

type PromptForInit = (input: {
  registry: AssetRegistry
  repoRoot: string
  mode?: InstallMode
  scope?: InstallScope
  tools?: ToolSelection
  ruleWiring?: RuleWiring
}) => Promise<{
  mode: InstallMode
  scope: InstallScope
  tools: InstallTool[]
  ruleWiring: RuleWiring
  selected: SelectedAssets
}>

export async function runInit(
  flags: InitFlags = {},
  { promptForInit }: { promptForInit?: PromptForInit } = {},
): Promise<InitResult> {
  const homeDir = flags.homeDir ?? homedir()
  const repoRoot = flags.repoRoot ?? process.cwd()
  const paths = cachePaths({ homeDir })
  const registry = await readCachedRegistry(paths.assetsRoot)
  const scripted = hasScriptedSelectionFlags(flags)
  let mode = flags.mode ?? 'link'
  let scope = initScopeFromFlags(flags)
  let tools = flags.tools
  let ruleWiring = flags.ruleWiring
  let selected: SelectedAssets | undefined

  validateMode(mode)

  if (flags.yes && !scripted) {
    throw new Error('--yes requires --all, --skills, --rules, or --design')
  }

  if (scripted) {
    selected = flags.all
      ? {
          ...selectAll(registry),
          ...(flags.design ? { design: flags.design } : {}),
        }
      : {
          skills: flags.skills ?? [],
          rules: flags.rules ?? [],
          design: flags.design ?? null,
        }
  } else {
    const prompt = promptForInit ?? (await loadPromptForInit())
    const prompted = await prompt({
      registry,
      repoRoot,
      mode: flags.mode,
      scope,
      tools: flags.tools,
      ruleWiring: flags.ruleWiring,
    })
    mode = flags.mode ?? prompted.mode
    scope = flags.scope ?? prompted.scope
    tools = flags.tools ?? prompted.tools
    ruleWiring = flags.ruleWiring ?? prompted.ruleWiring
    selected = prompted.selected
  }

  if (!hasSelectedAssets(selected)) {
    throw new Error(
      'No assets selected. Pass --all, --skills, --rules, or --design, or run interactive setup.',
    )
  }

  if (scripted && scope === 'global' && !flags.yes && !flags.dryRun) {
    throw new Error(
      '--scope global with scripted selections requires --yes or --dry-run',
    )
  }

  const manifest = await initRepo({
    repoRoot,
    mode,
    scope,
    tools,
    ruleWiring,
    selected,
    force: flags.force ?? false,
    dryRun: flags.dryRun ?? false,
    homeDir,
    skillsInstaller: flags.skillsInstaller,
  })

  if (flags.dryRun) {
    console.log('Dewey workflow init plan:')
    for (const file of (manifest as Extract<InitResult, { dryRun: true }>).files) {
      console.log(`- ${file}`)
    }
  } else if (manifest.scope === 'global') {
    console.log('Initialized Dewey workflow globally.')
  } else {
    console.log('Initialized Dewey workflow for this repository.')
  }

  return manifest
}

async function loadPromptForInit(): Promise<PromptForInit> {
  const { promptForInit } = await import('./prompts.ts')
  return promptForInit
}

async function readCachedRegistry(assetsRoot: string): Promise<AssetRegistry> {
  try {
    const registry = JSON.parse(
      await readFile(join(assetsRoot, 'registry.json'), 'utf8'),
    ) as Partial<AssetRegistry>

    return {
      ...registry,
      assets: {
        /* v8 ignore next -- legacy cache manifests may omit collections */
        skills: registry.assets?.skills ?? {},
        /* v8 ignore next -- legacy cache manifests may omit collections */
        rules: registry.assets?.rules ?? {},
        /* v8 ignore next -- legacy cache manifests may omit collections */
        designs: registry.assets?.designs ?? {},
      },
    } as AssetRegistry
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') {
      throw new Error(
        'Dewey asset cache is missing. Run `deweyou-cli agent update` first.',
      )
    }
    /* v8 ignore next -- invalid JSON and non-missing read errors should bubble */
    throw error
  }
}

async function readCacheManifest(manifestPath: string): Promise<CacheManifest> {
  const manifest = await readJson<CacheManifest | null>(manifestPath, null)
  if (!manifest?.source || typeof manifest.source.root !== 'string') {
    throw new Error(
      'Dewey asset cache manifest is missing source metadata. Run `deweyou-cli agent update` first.',
    )
  }

  return manifest
}

function normalizeSelected(selected: SelectedAssets): SelectedAssets {
  const normalized: SelectedAssets = {
    skills: [...(selected.skills ?? [])],
    rules: [...(selected.rules ?? [])],
  }
  if (selected.design) normalized.design = selected.design
  return normalized
}

function hasSelectedAssets(selected: SelectedAssets | undefined): selected is SelectedAssets {
  if (!selected) return false
  return selected.skills.length > 0 || selected.rules.length > 0 || Boolean(selected.design)
}

function hasScriptedSelectionFlags(flags: InitFlags): boolean {
  return Boolean(flags.all || flags.skills || flags.rules || flags.design)
}

function initScopeFromFlags(flags: InitFlags): InstallScope | undefined {
  if (flags.global && flags.scope === 'project') {
    throw new Error('--global cannot be combined with --scope project')
  }
  if (flags.global) return 'global'
  return flags.scope
}

function validateMode(mode: unknown): asserts mode is InstallMode {
  if (typeof mode !== 'string') {
    throw new Error('mode must be one of link, copy, or pointer')
  }
  if (!VALID_MODES.has(mode as InstallMode)) {
    throw new Error('mode must be one of link, copy, or pointer')
  }
}

function validateScope(scope: unknown): asserts scope is InstallScope {
  if (typeof scope !== 'string') {
    throw new Error('scope must be one of project or global')
  }
  if (!VALID_SCOPES.has(scope as InstallScope)) {
    throw new Error('scope must be one of project or global')
  }
}

function normalizeTools(tools: ToolSelection | undefined): InstallTool[] {
  if (tools) {
    for (const tool of tools) {
      if (
        typeof tool !== 'string' ||
        !VALID_TOOL_SELECTIONS.has(tool as ToolSelection[number])
      ) {
        throw new Error(`tool must be one of codex or claude: ${tool}`)
      }
    }
  }

  const selected: unknown[] =
    !tools || tools.includes('all') ? ['codex', 'claude'] : [...tools]
  for (const tool of selected) {
    if (typeof tool !== 'string' || !VALID_TOOLS.has(tool as InstallTool)) {
      throw new Error(`tool must be one of codex or claude: ${tool}`)
    }
  }
  return [...new Set(selected)] as InstallTool[]
}

function validateRuleWiring(ruleWiring: unknown): asserts ruleWiring is RuleWiring {
  if (typeof ruleWiring !== 'string') {
    throw new Error('ruleWiring must be one of reference or inline')
  }
  if (!VALID_RULE_WIRING.has(ruleWiring as RuleWiring)) {
    throw new Error('ruleWiring must be one of reference or inline')
  }
}

function validateSelectedAssets(
  registry: AssetRegistry,
  selected: SelectedAssets,
): void {
  for (const skill of selected.skills) {
    if (!registry.assets.skills[skill]) {
      throw new Error(`Unknown Dewey skill: ${skill}`)
    }
    validateAssetId(skill, 'skill')
  }

  for (const rule of selected.rules) {
    if (!registry.assets.rules[rule]) {
      throw new Error(`Unknown Dewey rule: ${rule}`)
    }
    validateAssetId(rule, 'rule')
  }

  if (selected.design) {
    if (!registry.assets.designs[selected.design]) {
      throw new Error(`Unknown Dewey design: ${selected.design}`)
    }
    validateAssetId(selected.design, 'design')
  }
}

function validateAssetId(id: string, kind: AssetKind): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Dewey ${kind} id must be kebab-case: ${id}`)
  }
}

function selectAll(registry: AssetRegistry): SelectedAssets {
  return {
    skills: Object.keys(registry.assets.skills),
    rules: Object.keys(registry.assets.rules),
  }
}

function snapshotSelectedAssetMetadata(
  registry: AssetRegistry,
  selected: SelectedAssets,
): {
  skills: Record<string, AssetMetadata>
  rules: Record<string, AssetMetadata>
  designs?: Record<string, AssetMetadata>
} {
  return {
    skills: Object.fromEntries(
      selected.skills.map((name) => [
        name,
        pickAssetMetadata(registry.assets.skills[name]),
      ]),
    ),
    rules: Object.fromEntries(
      selected.rules.map((name) => [
        name,
        pickAssetMetadata(registry.assets.rules[name]),
      ]),
    ),
    ...(selected.design
      ? {
          designs: {
            [selected.design]: pickAssetMetadata(
              registry.assets.designs[selected.design],
            ),
          },
        }
      : {}),
  }
}

function pickAssetMetadata(asset: RegistryAsset): AssetMetadata {
  return {
    description: asset.description,
    hash: asset.hash,
  }
}

function uniqueFiles(files: string[]): string[] {
  return [...new Set(files)]
}

function rulePathMap(
  assetsRoot: string,
  registry: AssetRegistry,
  rules: string[],
): Map<string, string> {
  return new Map(
    rules.map((rule) => [rule, join(assetsRoot, registry.assets.rules[rule].path)]),
  )
}

function ruleDescriptionMap(
  registry: AssetRegistry,
  rules: string[],
): Map<string, string> {
  return new Map(
    rules.map((rule) => [rule, registry.assets.rules[rule].description]),
  )
}

function projectRulePathMap(
  repoRoot: string,
  assetsRoot: string,
  registry: AssetRegistry,
  assets: SelectedAssets,
  mode: InstallMode,
  ruleWiring: RuleWiring,
): Map<string, string> {
  if (mode === 'pointer' || ruleWiring === 'inline') {
    return rulePathMap(assetsRoot, registry, assets.rules)
  }
  return new Map(
    assets.rules.map((rule) => [
      rule,
      join(repoRoot, '.agents', 'rules', `${rule}.md`),
    ]),
  )
}

async function validateSelectedSkillSources(
  assetsRoot: string,
  registry: AssetRegistry,
  skills: string[],
): Promise<void> {
  await Promise.all(
    skills.map((skill) =>
      realpath(join(assetsRoot, registry.assets.skills[skill].path)),
    ),
  )
}

function projectSkillFiles({
  repoRoot,
  assets,
  tools,
}: {
  repoRoot: string
  assets: SelectedAssets
  tools: InstallTool[]
}): string[] {
  return tools.flatMap((tool) =>
    assets.skills.map((skill) => join(repoRoot, skillDirectory(tool), skill)),
  )
}

function globalSkillFiles({
  homeDir,
  assets,
  tools,
}: {
  homeDir: string
  assets: SelectedAssets
  tools: InstallTool[]
}): string[] {
  return tools.flatMap((tool) =>
    assets.skills.map((skill) => join(homeDir, skillDirectory(tool), skill)),
  )
}

function skillDirectory(tool: InstallTool): string {
  if (tool === 'claude') return '.claude/skills'
  return '.agents/skills'
}

async function buildSkillSafetyPlan({
  assetsRoot,
  registry,
  skills,
  destinations,
  mode,
}: {
  assetsRoot: string
  registry: AssetRegistry
  skills: string[]
  destinations: string[]
  mode: Exclude<InstallMode, 'pointer'>
}): Promise<InitPlan> {
  const assets = await Promise.all(
    destinations.map((destination) => {
      const id = basename(destination)
      return buildAssetPlan({
        kind: 'skill',
        id,
        source: join(assetsRoot, registry.assets.skills[id].path),
        destination,
        mode,
      })
    }),
  )

  return {
    assets: skills.length > 0 ? assets : [],
    files: destinations,
  }
}

async function validateGlobalSkillDestinationSafety({
  plan,
  manifestPath,
  assetsRoot,
  tools,
  force,
}: {
  plan: InitPlan
  manifestPath: string
  assetsRoot: string
  tools: InstallTool[]
  force: boolean
}): Promise<void> {
  const previousManifest = await readJson<GlobalManifest | null>(
    manifestPath,
    null,
  )
  const homeDir = dirname(dirname(dirname(manifestPath)))
  const safeManifestDestinations = new Set(
    globalSkillDestinations(homeDir, previousManifest, tools),
  )

  for (const asset of plan.assets) {
    await validateDestination(asset, {
      assetsRoot,
      force,
      safeManifestDestinations,
    })
  }
}

function globalSkillDestinations(
  homeDir: string,
  manifest: GlobalManifest | null,
  tools: InstallTool[],
): string[] {
  if (!manifest?.assets) return []
  const manifestTools = manifest.tools.length > 0 ? manifest.tools : tools

  return manifestTools.flatMap((tool) =>
    (manifest.assets.skills ?? []).map((id) =>
      join(homeDir, skillDirectory(tool), id),
    ),
  )
}

async function buildInitPlan({
  repoRoot,
  agentsRoot,
  assetsRoot,
  registry,
  assets,
  mode,
}: {
  repoRoot: string
  agentsRoot: string
  assetsRoot: string
  registry: AssetRegistry
  assets: SelectedAssets
  mode: InstallMode
}): Promise<InitPlan> {
  const assetPlans =
    mode === 'pointer'
      ? []
      : await Promise.all([
          ...assets.rules.map((id) =>
            buildAssetPlan({
              kind: 'rule',
              id,
              source: join(assetsRoot, registry.assets.rules[id].path),
              destination: join(agentsRoot, 'rules', `${id}.md`),
              mode,
            }),
          ),
          ...(assets.design
            ? [
                buildAssetPlan({
                  kind: 'design',
                  id: assets.design,
                  source: join(
                    assetsRoot,
                    registry.assets.designs[assets.design].path,
                  ),
                  destination: join(repoRoot, 'DESIGN.md'),
                  mode,
                }),
              ]
            : []),
        ])

  return {
    assets: assetPlans,
    files: [
      ...assetPlans.map((asset) => asset.destination),
      join(agentsRoot, 'manifest.json'),
      join(repoRoot, 'AGENTS.md'),
    ],
  }
}

async function buildAssetPlan({
  kind,
  id,
  source,
  destination,
  mode,
}: {
  kind: AssetKind
  id: string
  source: string
  destination: string
  mode: Exclude<InstallMode, 'pointer'>
}): Promise<AssetPlan> {
  return {
    kind,
    id,
    source: await realpath(source),
    destination,
    mode,
  }
}

async function validateDestinationSafety({
  plan,
  manifestPath,
  assetsRoot,
  force,
}: {
  plan: InitPlan
  manifestPath: string
  assetsRoot: string
  force: boolean
}): Promise<void> {
  const previousManifest = await readJson<RepoManifest | null>(manifestPath, null)
  const safeManifestDestinations = new Set(
    manifestDestinations(dirname(manifestPath), previousManifest),
  )

  for (const asset of plan.assets) {
    await validateDestination(asset, {
      assetsRoot,
      force,
      safeManifestDestinations,
    })
  }
}

function manifestDestinations(agentsRoot: string, manifest: RepoManifest | null): string[] {
  if (!manifest?.assets) return []
  const repoRoot = dirname(agentsRoot)
  const tools: InstallTool[] = manifest.tools?.length
    ? manifest.tools
    : ['codex', 'claude']

  return [
    ...tools.flatMap((tool) =>
      (manifest.assets.skills ?? []).map((id) =>
        join(repoRoot, skillDirectory(tool), id),
      ),
    ),
    ...(manifest.assets.rules ?? []).map((id) =>
      join(agentsRoot, 'rules', `${id}.md`),
    ),
    ...(manifest.assets.design ? [join(dirname(agentsRoot), 'DESIGN.md')] : []),
  ]
}

async function validateDestination(
  asset: AssetPlan,
  { assetsRoot, force, safeManifestDestinations }: {
    assetsRoot: string
    force: boolean
    safeManifestDestinations: Set<string>
  },
): Promise<void> {
  let destinationStat
  try {
    destinationStat = await lstat(asset.destination)
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') return
    /* v8 ignore next -- non-missing lstat errors should bubble to the caller */
    throw error
  }

  if (!force) {
    throw new Error(
      `${asset.destination} already exists. Use --force to replace Dewey-managed asset files.`,
    )
  }

  if (
    safeManifestDestinations.has(asset.destination) ||
    (destinationStat.isSymbolicLink() &&
      (await pointsIntoAssetsRoot(asset.destination, assetsRoot)))
  ) {
    return
  }

  throw new Error(
    `Refusing to replace non-Dewey-managed destination: ${asset.destination}`,
  )
}

async function pointsIntoAssetsRoot(
  destination: string,
  assetsRoot: string,
): Promise<boolean> {
  let destinationTarget
  try {
    destinationTarget = await realpath(destination)
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') return false
    /* v8 ignore next -- non-missing realpath errors should bubble to the caller */
    throw error
  }

  const root = await realpath(assetsRoot)
  const pathFromRoot = relative(root, destinationTarget)

  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  )
}

async function installAssets(assets: AssetPlan[]): Promise<void> {
  for (const asset of assets) {
    await installAsset(asset)
  }
}

async function installAsset({
  source,
  destination,
  mode,
}: AssetPlan): Promise<void> {
  const parent = dirname(destination)
  const tempDestination = tempSibling(destination, 'tmp')
  const backupDestination = tempSibling(destination, 'backup')

  await mkdir(parent, { recursive: true })

  try {
    await rm(tempDestination, { recursive: true, force: true })
    await rm(backupDestination, { recursive: true, force: true })

    if (mode === 'link') {
      await symlink(source, tempDestination)
    } else {
      await cp(source, tempDestination, {
        recursive: true,
        force: false,
        errorOnExist: true,
      })
    }

    const hasExistingDestination = await pathExists(destination)
    if (hasExistingDestination) {
      await rename(destination, backupDestination)
    }

    try {
      await rename(tempDestination, destination)
    } catch (error) {
      /* v8 ignore next -- defensive guard for non-Error filesystem failures */
      if (!(error instanceof Error)) throw error
      if (hasExistingDestination) {
        await restoreBackup(backupDestination, destination, error)
      }
      throw error
    }

    if (hasExistingDestination) {
      await rm(backupDestination, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(tempDestination, { recursive: true, force: true })
    /* v8 ignore next -- cleanup is deterministic; original error is rethrown */
    throw error
  }
}

function tempSibling(destination: string, label: string): string {
  return join(
    dirname(destination),
    `.${basename(destination)}.${label}-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    /* v8 ignore next -- defensive guard for non-Node filesystem errors */
    if (!(error instanceof Error) || !('code' in error)) throw error
    if (error.code === 'ENOENT') return false
    /* v8 ignore next -- non-missing lstat errors should bubble to the caller */
    throw error
  }
}

async function restoreBackup(
  backupDestination: string,
  destination: string,
  originalError: Error & { restoreError?: unknown },
): Promise<void> {
  try {
    await rename(backupDestination, destination)
  } catch (restoreError) {
    /* v8 ignore next -- restore failures are attached to the original error */
    originalError.restoreError = restoreError
  }
}
