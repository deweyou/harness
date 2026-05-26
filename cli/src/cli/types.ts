import type { SkillsInstaller } from './skill-install.ts'

export type AssetKind = 'skill' | 'rule' | 'design'
export type InstallMode = 'link' | 'copy' | 'pointer'
export type InstallScope = 'project' | 'global'
export type InstallTool = 'codex' | 'claude'
export type ToolSelection = Array<InstallTool | 'all'>
export type RuleWiring = 'reference' | 'inline'
export type OutputFormat = 'markdown' | 'json'

export interface AssetMetadata {
  description: string
  hash: string
}

export interface RegistryAsset extends AssetMetadata {
  path: string
  tags: string[]
}

export interface AssetRegistry {
  assets: {
    skills: Record<string, RegistryAsset>
    rules: Record<string, RegistryAsset>
    designs: Record<string, RegistryAsset>
  }
}

export interface SelectedAssets {
  skills: string[]
  rules: string[]
  design?: string | null
}

export interface SourceSnapshot {
  root: string
  commit: string | null
}

export interface RepoManifest {
  mode: InstallMode
  scope?: InstallScope
  source: SourceSnapshot
  cacheRoot: string
  assets: SelectedAssets
  assetSnapshot?: {
    skills?: Record<string, AssetMetadata>
    rules?: Record<string, AssetMetadata>
    designs?: Record<string, AssetMetadata>
  }
  tools?: InstallTool[]
  ruleWiring?: RuleWiring
  initializedAt?: string
}

export interface GlobalManifest {
  scope: 'global'
  source: SourceSnapshot
  cacheRoot: string
  assets: SelectedAssets
  assetSnapshot?: {
    skills?: Record<string, AssetMetadata>
    rules?: Record<string, AssetMetadata>
    designs?: Record<string, AssetMetadata>
  }
  tools: InstallTool[]
  ruleWiring: RuleWiring
  initializedAt?: string
}

export interface GlobalDryRunManifest extends Omit<GlobalManifest, 'initializedAt'> {
  dryRun: true
  files: string[]
}

export interface CacheManifest {
  source: SourceSnapshot
  cliVersion: string
  updatedAt: string
}

export interface InitPlan {
  assets: AssetPlan[]
  files: string[]
}

export interface AssetPlan {
  kind: AssetKind
  id: string
  source: string
  destination: string
  mode: Exclude<InstallMode, 'pointer'>
}

export interface InitRepoOptions {
  repoRoot?: string
  homeDir?: string
  mode?: InstallMode
  scope?: InstallScope
  tools?: ToolSelection
  ruleWiring?: RuleWiring
  selected?: SelectedAssets
  force?: boolean
  dryRun?: boolean
  skillsInstaller?: SkillsInstaller
}

export interface InitFlags extends InitRepoOptions {
  all?: boolean
  global?: boolean
  skills?: string[]
  rules?: string[]
  design?: string
  yes?: boolean
}

export interface InitDryRunManifest extends Omit<RepoManifest, 'initializedAt'> {
  dryRun: true
  files: string[]
}

export type InitResult =
  | RepoManifest
  | InitDryRunManifest
  | GlobalManifest
  | GlobalDryRunManifest

export interface CachePaths {
  root: string
  assetsRoot: string
  manifestPath: string
}

export interface CacheOptions {
  homeDir?: string
  sourceRoot?: string
  cliVersion?: string
}

export interface ContextFlags {
  repoRoot?: string
  homeDir?: string
  format?: OutputFormat
}

export interface ContextAsset extends AssetMetadata {
  name: string
  path: string
}

export interface AgentContext {
  ok: true
  repo: {
    root: string
    mode: InstallMode
  }
  runtime: {
    sourceCommit: string | null
    repoSourceCommit: string | null
  }
  assets: {
    skills: ContextAsset[]
    rules: ContextAsset[]
    designs: ContextAsset[]
  }
  _notice: {
    update: string | null
    assets: string | null
  }
}

export interface ContextError {
  ok: false
  error: string
}

export type ContextResult = AgentContext | ContextError

export interface DoctorFlags {
  repoRoot?: string
  homeDir?: string
}

export interface DoctorCheck {
  status: 'pass' | 'fail'
  message: string
}

export interface DoctorResult {
  ok: boolean
  checks: DoctorCheck[]
}

export interface ParsedArgs {
  topic?: string
  command?: string
  flags: Record<string, boolean | string | string[]>
}

export type UsageError = Error & {
  exitCode: number
  silent: boolean
}
