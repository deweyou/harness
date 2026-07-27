import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import yaml from 'js-yaml'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import {
  CLASSIFICATION_RANK,
  isRecord,
  parseArtifactStatus,
  parseBrainMarkdown,
  parseClassification,
  parseScopes,
  type ArtifactDefaults,
} from './brain-schema.ts'
import type {
  BrainArtifact,
  BrainIndexResult,
} from './brain-types.ts'

const { load: loadYaml, JSON_SCHEMA } = yaml
const INDEX_ROOTS = [
  'events',
  'sources',
  'observations',
  'claims',
  'resolutions',
  'decisions',
  'wiki',
  'devices',
]

export async function indexBrain({
  homeDir,
}: {
  homeDir?: string
} = {}): Promise<BrainIndexResult> {
  const config = await loadBrainConfig({ homeDir })
  const paths = brainPaths(homeDir)
  await mkdir(dirname(paths.databasePath), { recursive: true })
  const database = new DatabaseSync(paths.databasePath)
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  createSchema(database)

  try {
    const rootDefaults = await readRepositoryDefaults(config.knowledge_repo, {
      classification: config.defaults.classification,
      scopes: config.defaults.scopes,
    })
    const files = await collectArtifactFiles(config.knowledge_repo)
    const purposeDefaults = await collectPurposeDefaults(
      config.knowledge_repo,
      files,
      rootDefaults,
    )
    const existing = new Map(
      (
        database.prepare('SELECT path, content_hash FROM artifacts').all() as Array<{
          path: string
          content_hash: string
        }>
      ).map((row) => [row.path, row.content_hash]),
    )
    const seen = new Set<string>()
    let indexed = 0
    let unchanged = 0

    database.exec('BEGIN IMMEDIATE')
    try {
      for (const absolutePath of files) {
        const path = relative(config.knowledge_repo, absolutePath).replaceAll('\\', '/')
        const contents = await readFile(absolutePath, 'utf8')
        const contentHash = createHash('sha256').update(contents).digest('hex')
        seen.add(path)
        if (existing.get(path) === contentHash) {
          unchanged += 1
          continue
        }
        const defaults = defaultsForPath(path, purposeDefaults, rootDefaults)
        const artifact = parseArtifact(path, contents, defaults)
        replaceArtifact(database, artifact, contentHash)
        indexed += 1
      }

      let removed = 0
      for (const path of existing.keys()) {
        if (seen.has(path)) continue
        removeArtifactByPath(database, path)
        removed += 1
      }
      applyGovernanceEffects(database)
      database.exec('COMMIT')
      return { databasePath: paths.databasePath, indexed, unchanged, removed }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    database.close()
  }
}

function applyGovernanceEffects(database: DatabaseSync): void {
  const resolutions = database.prepare(`
    SELECT metadata_json FROM artifacts
    WHERE type = 'resolution' AND path LIKE 'resolutions/jobs/%'
    ORDER BY id
  `).all() as Array<{ metadata_json: string }>
  const selectedGeneratedClaims = new Set<string>()
  for (const row of resolutions) {
    const value = JSON.parse(row.metadata_json) as Record<string, unknown>
    if (!Array.isArray(value.operations)) continue
    for (const rawOperation of value.operations) {
      if (!isRecord(rawOperation) || typeof rawOperation.op !== 'string') continue
      if (isRecord(rawOperation.claim) && typeof rawOperation.claim.id === 'string') {
        selectedGeneratedClaims.add(rawOperation.claim.id)
      }
      const claimIds = Array.isArray(rawOperation.claim_ids)
        ? rawOperation.claim_ids.filter((id): id is string => typeof id === 'string')
        : []
      if (rawOperation.op === 'SUPERSEDE_CLAIM' || rawOperation.op === 'MERGE_CLAIMS') {
        setArtifactStatuses(database, claimIds, 'superseded')
      }
      if (rawOperation.op === 'MARK_STALE') {
        setArtifactStatuses(database, claimIds, 'stale')
      }
      if (rawOperation.op === 'REJECT_OBSERVATION' && Array.isArray(rawOperation.observation_ids)) {
        setArtifactStatuses(
          database,
          rawOperation.observation_ids.filter(
            (id): id is string => typeof id === 'string',
          ),
          'deleted',
        )
      }
    }
  }
  const generatedClaims = database.prepare(`
    SELECT id, metadata_json FROM artifacts
    WHERE type = 'claim'
  `).all() as Array<{ id: string; metadata_json: string }>
  for (const row of generatedClaims) {
    const value = JSON.parse(row.metadata_json) as Record<string, unknown>
    if (
      typeof value.resolution_job === 'string' &&
      !selectedGeneratedClaims.has(row.id)
    ) {
      setArtifactStatuses(database, [row.id], 'superseded')
    }
  }
  const decisions = database.prepare(`
    SELECT metadata_json FROM artifacts
    WHERE type = 'decision'
    ORDER BY COALESCE(updated_at, ''), id
  `).all() as Array<{ metadata_json: string }>
  for (const row of decisions) {
    const value = JSON.parse(row.metadata_json) as Record<string, unknown>
    if (
      value.decision_type !== 'artifact-status' ||
      !Array.isArray(value.target_ids) ||
      typeof value.target_status !== 'string'
    ) {
      continue
    }
    const targetStatus = parseArtifactStatus(
      value.target_status,
      'artifact-status decision',
    )
    if (targetStatus === 'superseded') continue
    setArtifactStatuses(
      database,
      value.target_ids.filter((id): id is string => typeof id === 'string'),
      targetStatus,
    )
  }
}

function setArtifactStatuses(
  database: DatabaseSync,
  ids: string[],
  status: string,
): void {
  const statement = database.prepare('UPDATE artifacts SET status = ? WHERE id = ?')
  for (const id of ids) statement.run(status, id)
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      classification TEXT NOT NULL,
      classification_rank INTEGER NOT NULL,
      status TEXT NOT NULL,
      authority TEXT NOT NULL,
      confidence REAL,
      updated_at TEXT,
      provisional INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifact_scopes (
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      PRIMARY KEY (artifact_id, scope)
    );
    CREATE INDEX IF NOT EXISTS artifact_scopes_scope
      ON artifact_scopes(scope, artifact_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS artifact_fts USING fts5(
      id UNINDEXED,
      title,
      body,
      tokenize = 'unicode61'
    );
  `)
}

function replaceArtifact(
  database: DatabaseSync,
  artifact: BrainArtifact,
  contentHash: string,
): void {
  const old = database.prepare('SELECT id FROM artifacts WHERE path = ?').get(
    artifact.path,
  ) as { id: string } | undefined
  if (old && old.id !== artifact.id) removeArtifact(database, old.id)
  removeArtifact(database, artifact.id)
  database.prepare(`
    INSERT INTO artifacts (
      id, type, path, title, body, classification, classification_rank,
      status, authority, confidence, updated_at, provisional, content_hash,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifact.id,
    artifact.type,
    artifact.path,
    artifact.title,
    artifact.body,
    artifact.classification,
    CLASSIFICATION_RANK[artifact.classification],
    artifact.status,
    artifact.authority,
    artifact.confidence,
    artifact.updatedAt,
    artifact.provisional ? 1 : 0,
    contentHash,
    JSON.stringify(artifact.metadata),
  )
  const scopeStatement = database.prepare(
    'INSERT INTO artifact_scopes (artifact_id, scope) VALUES (?, ?)',
  )
  for (const scope of artifact.scopes) scopeStatement.run(artifact.id, scope)
  database.prepare(
    'INSERT INTO artifact_fts (id, title, body) VALUES (?, ?, ?)',
  ).run(artifact.id, artifact.title, artifact.body)
}

function removeArtifactByPath(database: DatabaseSync, path: string): void {
  const row = database.prepare('SELECT id FROM artifacts WHERE path = ?').get(path) as
    | { id: string }
    | undefined
  if (row) removeArtifact(database, row.id)
}

function removeArtifact(database: DatabaseSync, id: string): void {
  database.prepare('DELETE FROM artifact_fts WHERE id = ?').run(id)
  database.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
}

async function collectArtifactFiles(repoRoot: string): Promise<string[]> {
  const output: string[] = []
  for (const root of INDEX_ROOTS) {
    await walk(join(repoRoot, root), output)
  }
  return output.sort()
}

async function walk(path: string, output: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return
    /* v8 ignore next -- unexpected directory read errors must surface unchanged. */
    throw error
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'README.md') continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      await walk(child, output)
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.md') ||
        entry.name.endsWith('.json') ||
        entry.name.endsWith('.yaml') ||
        entry.name.endsWith('.yml'))
    ) {
      output.push(child)
    }
  }
}

function parseArtifact(
  path: string,
  contents: string,
  defaults: ArtifactDefaults,
): BrainArtifact {
  if (path.endsWith('.md')) {
    return parseBrainMarkdown({ path, contents, defaults })
  }
  const parsed = path.endsWith('.json')
    ? JSON.parse(contents) as unknown
    : loadYaml(contents, { schema: JSON_SCHEMA })
  if (!isRecord(parsed)) throw new Error(`${path}: artifact must be an object`)
  const id = firstString(parsed, ['event_id', 'source_id', 'observation_id', 'resolution_id', 'decision_id', 'device_id', 'id'])
  if (!id) throw new Error(`${path}: artifact id is missing`)
  const type = inferType(parsed, path)
  const classification = parseClassification(
    parsed.classification ?? defaults.classification,
    path,
  )
  const scopes = parseScopes(parsed.scopes ?? parsed.scope ?? defaults.scopes, path)
  const status = parseArtifactStatus(parsed.status ?? 'active', path)
  const payload = parsed.payload ?? parsed.content ?? parsed
  return {
    id,
    type,
    path,
    title: firstString(parsed, ['title', 'event_type', 'source_type']) ?? id,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    classification,
    scopes,
    status,
    authority: firstString(parsed, ['authority', 'agent', 'device_id']) ?? 'unknown',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    updatedAt: firstString(parsed, ['updated_at', 'occurred_at', 'captured_at', 'created_at']),
    provisional: parsed.provisional === true || type === 'event' || type === 'observation',
    metadata: parsed,
  }
}

async function readRepositoryDefaults(
  repoRoot: string,
  fallback: ArtifactDefaults,
): Promise<ArtifactDefaults> {
  try {
    const parsed = loadYaml(await readFile(join(repoRoot, 'brain.yaml'), 'utf8'), {
      schema: JSON_SCHEMA,
    })
    if (!isRecord(parsed)) return fallback
    return {
      classification: parseClassification(
        parsed.default_classification ?? fallback.classification,
        'brain.yaml',
      ),
      scopes: parseScopes(parsed.default_scopes ?? fallback.scopes, 'brain.yaml'),
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return fallback
    /* v8 ignore next -- malformed policy files and I/O failures must surface. */
    throw error
  }
}

async function collectPurposeDefaults(
  repoRoot: string,
  files: string[],
  rootDefaults: ArtifactDefaults,
): Promise<Map<string, ArtifactDefaults>> {
  const result = new Map<string, ArtifactDefaults>()
  for (const file of files.filter((path) => path.endsWith('/purpose.md'))) {
    const path = relative(repoRoot, file).replaceAll('\\', '/')
    const parsed = parseBrainMarkdown({
      path,
      contents: await readFile(file, 'utf8'),
      defaults: rootDefaults,
    })
    const rawDefaults = isRecord(parsed.metadata.defaults)
      ? parsed.metadata.defaults
      : {}
    result.set(dirnamePosix(path), {
      classification: parseClassification(
        rawDefaults.classification ?? parsed.classification,
        path,
      ),
      scopes: parseScopes(rawDefaults.scopes ?? parsed.scopes, path),
    })
  }
  return result
}

function defaultsForPath(
  path: string,
  domainDefaults: Map<string, ArtifactDefaults>,
  rootDefaults: ArtifactDefaults,
): ArtifactDefaults {
  let directory = dirnamePosix(path)
  while (directory && directory !== '.') {
    const found = domainDefaults.get(directory)
    if (found) return found
    const next = dirnamePosix(directory)
    if (next === directory) break
    directory = next
  }
  return rootDefaults
}

function dirnamePosix(value: string): string {
  const index = value.lastIndexOf('/')
  return index === -1 ? '.' : value.slice(0, index)
}

function inferType(value: Record<string, unknown>, path: string): string {
  if (typeof value.type === 'string') return value.type
  if ('event_id' in value) return 'event'
  if ('source_id' in value) return 'source'
  if ('observation_id' in value) return 'observation'
  if ('resolution_id' in value || path.startsWith('resolutions/')) return 'resolution'
  if ('decision_id' in value) return 'decision'
  if ('device_id' in value) return 'device'
  return 'artifact'
}

function firstString(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key]
  }
  return null
}

function hasCode(error: unknown, code: string): boolean {
  /* v8 ignore next -- defensive handling for non-Node filesystem throws. */
  return error instanceof Error && 'code' in error && error.code === code
}
