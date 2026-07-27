import { stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import { CLASSIFICATION_RANK } from './brain-schema.ts'
import type {
  ArtifactStatus,
  BrainRecallOptions,
  Classification,
  ContextEntry,
  ContextPack,
} from './brain-types.ts'

interface RecallRow {
  id: string
  type: string
  path: string
  title: string
  body: string
  classification: Classification
  status: ArtifactStatus
  authority: string
  confidence: number | null
  provisional: number
  updated_at: string | null
  search_rank: number
  scopes: string
}

export async function recallBrain(
  options: BrainRecallOptions,
): Promise<ContextPack> {
  const config = await loadBrainConfig({ homeDir: options.homeDir })
  const paths = brainPaths(options.homeDir)
  if (!await exists(paths.databasePath)) {
    throw new Error('Brain index is missing. Run `deweyou-cli brain index`.')
  }
  const clearance = options.clearance ?? config.defaults.clearance
  const allowedScopes = options.allowedScopes ?? config.defaults.scopes
  const tokenBudget = options.tokenBudget ?? config.defaults.token_budget
  const database = new DatabaseSync(paths.databasePath, { readOnly: true })

  try {
    const rows = queryRows(database, {
      query: options.query,
      clearance,
      allowedScopes,
      includeArchived: options.includeArchived === true,
    })
    const entries: ContextEntry[] = []
    let estimatedTokens = 0

    for (const row of rows) {
      const estimated = estimateTokens(`${row.title}\n${row.body}`)
      if (estimatedTokens + estimated > tokenBudget) continue
      const scopes = JSON.parse(row.scopes) as string[]
      const entry: ContextEntry = {
        id: row.id,
        type: row.type,
        title: row.title,
        content: row.body,
        path: row.path,
        classification: row.classification,
        scopes,
        status: row.status,
        authority: row.authority,
        confidence: row.confidence,
        provisional: row.provisional === 1,
        score: scoreRow(row, options.now ?? new Date()),
        estimated_tokens: estimated,
      }
      entries.push(entry)
      estimatedTokens += estimated
    }
    entries.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))

    const levels = {
      l0: entries.filter((entry) => isL0(entry.type)),
      l1: entries.filter((entry) => isL1(entry.type)),
      l2: entries.filter((entry) => !isL0(entry.type) && !isL1(entry.type)),
    }
    const warnings = [
      ...entries
        .filter((entry) => entry.provisional)
        .map((entry) => `${entry.id} is a provisional observation`),
      ...entries
        .filter((entry) => entry.status === 'stale')
        .map((entry) => `${entry.id} may be stale`),
    ]

    return {
      schema_version: 1,
      generated_at: (options.now ?? new Date()).toISOString(),
      query: options.query,
      clearance,
      allowed_scopes: allowedScopes,
      token_budget: tokenBudget,
      estimated_tokens: estimatedTokens,
      levels,
      entries,
      warnings,
    }
  } finally {
    database.close()
  }
}

function queryRows(
  database: DatabaseSync,
  {
    query,
    clearance,
    allowedScopes,
    includeArchived,
  }: {
    query: string
    clearance: Classification
    allowedScopes: string[]
    includeArchived: boolean
  },
): RecallRow[] {
  if (allowedScopes.length === 0) return []
  const scopeWhere = allowedScopes
    .map(() => '(s.scope = ? OR s.scope LIKE ?)')
    .join(' OR ')
  const scopeArgs = allowedScopes.flatMap((scope) => [scope, `${scope}/%`])
  const statuses = includeArchived
    ? ['active', 'stale', 'archived']
    : ['active', 'stale']
  const statusPlaceholders = statuses.map(() => '?').join(', ')
  const ftsQuery = buildFtsQuery(query)
  const common = `
    a.classification_rank <= ?
    AND a.status IN (${statusPlaceholders})
    AND EXISTS (
      SELECT 1 FROM artifact_scopes s
      WHERE s.artifact_id = a.id AND (${scopeWhere})
    )
  `

  if (!ftsQuery) {
    return database.prepare(`
      SELECT
        a.*, 0 AS search_rank,
        (SELECT json_group_array(scope) FROM artifact_scopes WHERE artifact_id = a.id) AS scopes
      FROM artifacts a
      WHERE ${common}
      ORDER BY COALESCE(a.updated_at, '') DESC, a.id
      LIMIT 100
    `).all(
      CLASSIFICATION_RANK[clearance],
      ...statuses,
      ...scopeArgs,
    ) as unknown as RecallRow[]
  }

  return database.prepare(`
    SELECT
      a.*, bm25(artifact_fts) AS search_rank,
      (SELECT json_group_array(scope) FROM artifact_scopes WHERE artifact_id = a.id) AS scopes
    FROM artifact_fts
    JOIN artifacts a ON a.id = artifact_fts.id
    WHERE artifact_fts MATCH ? AND ${common}
    ORDER BY search_rank ASC, COALESCE(a.updated_at, '') DESC
    LIMIT 100
  `).all(
    ftsQuery,
    CLASSIFICATION_RANK[clearance],
    ...statuses,
    ...scopeArgs,
  ) as unknown as RecallRow[]
}

function buildFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' OR ')
}

function scoreRow(row: RecallRow, now: Date): number {
  const search = Number.isFinite(row.search_rank) ? -row.search_rank : 0
  const confidence = row.confidence ?? 0.5
  const authority = row.authority === 'user' ? 2 : row.authority === 'verified' ? 1.5 : 1
  const status = row.status === 'active' ? 1 : row.status === 'stale' ? 0.4 : 0.1
  const provisional = row.provisional === 1 ? 0.6 : 1
  const ageDays = row.updated_at
    ? Math.max(0, (now.getTime() - Date.parse(row.updated_at)) / 86_400_000)
    : 365
  const freshness = 1 / (1 + ageDays / 180)
  return search + confidence * authority * status * provisional + freshness
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil([...value].length / 3.2))
}

function isL0(type: string): boolean {
  return type === 'profile' || type === 'identity' || type === 'preference'
}

function isL1(type: string): boolean {
  return type === 'catalog' || type === 'wiki' || type === 'purpose' || type === 'decision'
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    /* v8 ignore next -- unexpected stat errors must surface unchanged. */
    throw error
  }
}
