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
  capabilities: string[]
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
  capabilities?: readonly string[]
}

export interface UnifiedUpdateFlags {
  dryRun?: boolean
  cliOnly?: boolean
  agentsOnly?: boolean
}

export type DevSessionCommand = 'start' | 'list' | 'status' | 'close' | 'archive' | 'clean'

export interface ParsedDevSessionArgs {
  command: DevSessionCommand
  flags: DevFlags
}

export interface CommandResult {
  stdout: string
  stderr: string
}

export type CommandRunner = (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>

export interface UpdateRuntimeOptions {
  env?: NodeJS.ProcessEnv
  logger?: (message: string) => void
  platform?: NodeJS.Platform
  runner?: CommandRunner
}

export interface UnifiedUpdateResult {
  cli: {
    status: 'planned' | 'unchanged' | 'updated'
    version: string | null
  }
  agents: {
    status: 'planned' | 'unchanged' | 'updated'
    source: string | null
  }
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

export interface DevFlags {
  repoRoot?: string
  homeDir?: string
  branch?: string
  host?: string
  port?: string | number
  all?: boolean
  noServer?: boolean
  once?: boolean
  dryRun?: boolean
  kind?: string
  data?: string
  dataFile?: string
  format?: OutputFormat
  id?: string
  title?: string
  force?: boolean
}

export type DevSessionStatus = 'active' | 'closed' | 'archived'

export interface DevSession {
  schema_version: 1
  id: string
  title: string
  repo_id: string
  repo_root: string
  branch: string
  head_sha: string | null
  status: DevSessionStatus
  created_at: string
  updated_at: string
}

export interface DevSessionListItem {
  id: string
  path: string
  status: DevSessionStatus | 'legacy'
  title: string | null
  branch: string | null
  current: boolean
}

export interface DevSessionResult {
  session: DevSession
  sessionPath: string
}

export interface DevSessionListResult {
  sessions: DevSessionListItem[]
}

export type DevEventKind =
  | 'requirement'
  | 'node'
  | 'evidence'
  | 'failure'
  | 'review'
  | 'recovery'
  | 'delivery'

export interface DevEvent {
  schema_version: 1
  event_id: string
  occurred_at: string
  kind: DevEventKind
  session_id: string
  branch: string
  payload: Record<string, unknown>
}

export interface DevSessionSummary {
  schema_version: 1
  branch: string
  generated_at: string
  event_count: number
  counts: Record<string, number>
  requirement: null | {
    status: string
    acceptance_source: string
    unresolved_decisions: string[]
    event_id: string
  }
  nodes: Array<{
    node_id: string
    node_type: string
    status: string
    depends_on: string[]
    evidence_ids: string[]
    event_id: string
  }>
  claims: Array<{
    claim_id: string
    status: string
    evidence_ids: string[]
    summaries: string[]
  }>
  failures: Array<{
    failure_id: string
    node_id: string
    failure_class: string
    summary: string
    evidence_ids: string[]
    restart_from: string | null
    retryable: boolean | null
    event_id: string
  }>
  reviews: Array<{
    review_id: string
    scope: string
    verdict: string
    findings: string[]
    evidence_ids: string[]
    restart_from: string | null
    event_id: string
  }>
  recoveries: Array<{
    recovery_id: string
    source_event_id: string
    restart_from: string
    reason: string
    status: string
    event_id: string
  }>
  deliveries: Array<{
    delivery_id: string
    status: string
    summary: string
    evidence_ids: string[]
    event_id: string
  }>
  open_issues: string[]
}

export interface DevStatusResult {
  runtimeRoot: string
  repoStateRoot: string
  branch: string
  sessionPath: string
  runtimeExists: boolean
  repoStateExists: boolean
  sessionExists: boolean
}

export interface DevDoctorCheck {
  status: 'pass' | 'warn' | 'fail'
  message: string
}

export interface DevDoctorResult {
  ok: boolean
  checks: DevDoctorCheck[]
}

export interface DevInstallResult {
  runtimeRoot: string
  repoStateRoot: string
  configPath: string
  sessionPath: string | null
  codexHooksPath: string
  moduleSkills: Record<string, string>
  dryRun: boolean
  exclude: string
  hooks: string
  codexHooks: string
}

export interface DevCleanResult {
  target: string
  removed: boolean
  dryRun: boolean
}

export interface DevUninstallResult {
  runtimeRoot: string
  repoStateRoot: string
  dryRun: boolean
  runtimeRemoved: boolean
  repoStateRemoved: boolean
  exclude: string
  codexHooks: string
}

export interface DevDemoResult {
  demoRoot: string
  indexPath: string
  url: string | null
  served: boolean
  dryRun: boolean
}

export interface DevRecordResult {
  sessionPath: string
  eventsPath: string
  event: DevEvent
}

export interface DevSummaryResult {
  sessionPath: string
  eventsPath: string
  summaryPath: string
  summary: DevSessionSummary
  markdown: string
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
