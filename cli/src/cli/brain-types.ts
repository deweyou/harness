export const BRAIN_AGENTS = [
  'codex',
  'claude',
  'hermes',
  'openclaw',
  'trae',
] as const
export type BrainAgent = (typeof BRAIN_AGENTS)[number]
export type DiscoverableBrainAgent = 'codex' | 'hermes'

export const CLASSIFICATIONS = [
  'public',
  'private',
  'confidential',
  'restricted',
] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export const ARTIFACT_STATUSES = [
  'active',
  'stale',
  'superseded',
  'archived',
  'deleted',
] as const
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]

export interface BrainConfig {
  schema_version: 1
  knowledge_repo: string
  device_id: string
  sync: {
    enabled: boolean
    remote: string
    branch: string
    auto_push: boolean
    encryption: 'none' | 'sensitive-only' | 'all'
    profile: 'full' | 'knowledge'
  }
  defaults: {
    classification: Classification
    scopes: string[]
    clearance: Classification
    token_budget: number
  }
  compiler: {
    provider: 'none' | 'command'
    command: string[]
    policy_version: string
  }
}

export interface BrainPaths {
  homeDir: string
  runtimeRoot: string
  configPath: string
  databasePath: string
  queueRoot: string
  quarantineRoot: string
  rawSourcesRoot: string
  contextPackRoot: string
  locksRoot: string
  scheduleManifestPath: string
}

export interface BrainArtifact {
  id: string
  type: string
  path: string
  title: string
  body: string
  classification: Classification
  scopes: string[]
  status: ArtifactStatus
  authority: string
  confidence: number | null
  updatedAt: string | null
  provisional: boolean
  metadata: Record<string, unknown>
}

export interface BrainEvent {
  schema_version: 1
  event_id: string
  occurred_at: string
  device_id: string
  agent: BrainAgent
  event_type: string
  session_id: string | null
  cwd: string | null
  scopes: string[]
  classification: Classification
  source_id: string | null
  payload: Record<string, unknown>
}

export interface BrainSource {
  schema_version: 1
  source_id: string
  source_type: 'agent-session'
  captured_at: string
  device_id: string
  agent: BrainAgent
  session_id: string | null
  scopes: string[]
  classification: Classification
  storage: 'local'
  content_hash: string
  content_bytes: number
}

export interface BrainLocalSource extends BrainSource {
  content: unknown
}

export interface BrainCaptureResult {
  status: 'captured' | 'quarantined'
  created: boolean
  eventPath: string | null
  sourcePath: string | null
  localSourcePath: string | null
  jobPath: string | null
  quarantinePath: string | null
  event: BrainEvent | null
}

export interface BrainIndexResult {
  databasePath: string
  indexed: number
  unchanged: number
  removed: number
}

export interface ContextEntry {
  id: string
  type: string
  title: string
  content: string
  path: string
  classification: Classification
  scopes: string[]
  status: ArtifactStatus
  authority: string
  confidence: number | null
  provisional: boolean
  score: number
  estimated_tokens: number
}

export interface ContextPack {
  schema_version: 1
  generated_at: string
  query: string
  clearance: Classification
  allowed_scopes: string[]
  token_budget: number
  estimated_tokens: number
  levels: {
    l0: ContextEntry[]
    l1: ContextEntry[]
    l2: ContextEntry[]
  }
  entries: ContextEntry[]
  warnings: string[]
}

export interface BrainInitOptions {
  homeDir?: string
  repoPath: string
  deviceId?: string
  remote?: string
  branch?: string
  dryRun?: boolean
  now?: Date
}

export interface BrainCaptureOptions {
  homeDir?: string
  agent: BrainAgent | string
  eventType: string
  sessionId?: string
  cwd?: string
  scopes?: string[]
  classification?: Classification
  payload?: Record<string, unknown>
  data?: string
  queueMaintenance?: boolean
  now?: Date
  idFactory?: () => string
}

export interface BrainRecallOptions {
  homeDir?: string
  query: string
  clearance?: Classification
  allowedScopes?: string[]
  tokenBudget?: number
  includeArchived?: boolean
  now?: Date
}

export type ResolutionOperationType =
  | 'ADD_CLAIM'
  | 'MERGE_CLAIMS'
  | 'SUPERSEDE_CLAIM'
  | 'SPLIT_SCOPE'
  | 'MARK_STALE'
  | 'LINK_ENTITIES'
  | 'REJECT_OBSERVATION'
  | 'REQUEST_HUMAN_DECISION'

export interface ProposedClaim {
  id?: string
  title: string
  body: string
  classification: Classification
  scopes: string[]
  authority: string
  confidence: number
  valid_from?: string
  valid_until?: string
}

export interface ResolutionOperation {
  op: ResolutionOperationType
  claim_ids?: string[]
  observation_ids?: string[]
  claim?: ProposedClaim
  scopes?: string[]
  entities?: string[]
  reason?: string
}

export interface ResolutionProposal {
  schema_version: 1
  job_id: string
  device_id: string
  created_at: string
  policy_version: string
  provider: string
  model: string
  prompt_version: string
  confidence: number
  input_ids: string[]
  input_classification: Classification
  evidence_refs: string[]
  operations: ResolutionOperation[]
}

export interface AppliedResolution {
  schema_version: 1
  resolution_id: string
  job_id: string
  selected_proposal: string
  resolved_at: string
  policy_version: string
  confidence: number
  input_ids: string[]
  evidence_refs: string[]
  classification: Classification
  scopes: string[]
  status: 'active'
  operations: ResolutionOperation[]
}

export interface ResolutionApplyResult {
  proposalPath: string
  resolutionPath: string
  claimPaths: string[]
  claimIds: string[]
  alreadyApplied: boolean
}

export interface WikiCompileResult {
  pages: string[]
  claims: number
}

export type BrainHookAgent = BrainAgent | 'all'
export type BrainHookCommand = 'install' | 'status' | 'uninstall' | 'run'

export interface BrainHookFlags {
  homeDir?: string
  repo?: string
  agent?: BrainHookAgent
  event?: string
  dryRun?: boolean
  force?: boolean
  data?: string
}

export interface BrainHookStatus {
  agent: BrainAgent
  installed: boolean
  paths: string[]
  detail: string
}

export interface BrainHookResult {
  operation: Exclude<BrainHookCommand, 'run'>
  dryRun: boolean
  statuses: BrainHookStatus[]
}

export interface BrainImportOptions {
  homeDir?: string
  agent: BrainAgent | string
  path: string
  scopes?: string[]
  classification?: Classification
  now?: Date
}

export interface BrainImportResult {
  files: number
  records: number
  captured: number
  deduplicated: number
  quarantined: number
  skipped: number
}

export type BrainHistorySourceKind =
  | 'codex-jsonl'
  | 'hermes-sqlite'
  | 'hermes-jsonl'

export interface BrainHistorySource {
  agent: DiscoverableBrainAgent
  kind: BrainHistorySourceKind
  path: string
  files: number
  records: number
  source_bytes: number
}

export interface BrainHistoryDiscovery {
  agents: DiscoverableBrainAgent[]
  sources: BrainHistorySource[]
  files: number
  records: number
  source_bytes: number
  warnings: string[]
}

export interface BrainHistoryDiscoveryOptions {
  homeDir?: string
  agent?: DiscoverableBrainAgent | 'all'
  environment?: Record<string, string | undefined>
}

export interface BrainDiscoveredImportOptions
  extends BrainHistoryDiscoveryOptions {
  scopes?: string[]
  classification?: Classification
  dryRun?: boolean
}

export interface BrainDiscoveredImportResult {
  dryRun: boolean
  discovery: BrainHistoryDiscovery
  scopes: string[]
  classification: Classification
  sources: Array<BrainHistorySource & { result: BrainImportResult }>
  totals: BrainImportResult
}

export interface BrainInitPromptInput {
  homeDir: string
  defaultRepo: string
  defaultDevice: string
}

export interface BrainInitPromptResult {
  repo: string
  device: string
  remote?: string
  branch: string
}

export interface BrainMaintenanceJob {
  job_id: string
  event_id: string
  observation_id: string
  source_id: string | null
  local_source_path: string | null
  agent: BrainAgent
  session_id: string | null
  classification: Classification
  scopes: string[]
}

export interface BrainMaintenancePreparation {
  observed: number
  pending: number
  jobs: BrainMaintenanceJob[]
  prompt: string
}

export interface BrainExportOptions {
  homeDir?: string
  outputDir: string
  clearance?: Classification
  allowedScopes?: string[]
  format?: 'wiki' | 'knowledge'
  dryRun?: boolean
}

export interface BrainExportResult {
  outputDir: string
  clearance: Classification
  allowedScopes: string[]
  format: 'wiki' | 'knowledge'
  exported: number
  paths: string[]
  dryRun: boolean
}
