import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { loadBrainConfig } from './brain-config.ts'
import {
  importBrainHistory,
  importBrainTranscript,
} from './brain-import.ts'
import { parseClassification, parseScopes } from './brain-schema.ts'
import type {
  BrainDiscoveredImportOptions,
  BrainDiscoveredImportResult,
  BrainHistoryDiscovery,
  BrainHistoryDiscoveryOptions,
  BrainHistorySource,
  BrainImportResult,
  DiscoverableBrainAgent,
} from './brain-types.ts'

const MAX_NATIVE_HISTORY_FILE_BYTES = 100 * 1024 * 1024

export async function discoverBrainHistory(
  options: BrainHistoryDiscoveryOptions = {},
): Promise<BrainHistoryDiscovery> {
  const agents = discoveryAgents(options.agent)
  const environment = options.environment ?? process.env
  const userHome = options.homeDir ?? homedir()
  const sources: BrainHistorySource[] = []
  const warnings: string[] = []
  if (agents.includes('codex')) {
    const codexHome = environment.CODEX_HOME?.trim() || join(userHome, '.codex')
    try {
      sources.push(...await discoverCodexSources(codexHome))
    } catch (error) {
      warnings.push(`Unable to discover Codex history: ${errorMessage(error)}`)
    }
  }
  if (agents.includes('hermes')) {
    const hermesHome =
      environment.HERMES_HOME?.trim() || join(userHome, '.hermes')
    try {
      sources.push(...await discoverHermesSources(hermesHome, warnings))
    } catch (error) {
      warnings.push(`Unable to discover Hermes history: ${errorMessage(error)}`)
    }
  }
  return {
    agents,
    sources,
    files: sources.reduce((total, source) => total + source.files, 0),
    records: sources.reduce((total, source) => total + source.records, 0),
    source_bytes: sources.reduce(
      (total, source) => total + source.source_bytes,
      0,
    ),
    warnings,
  }
}

export async function importDiscoveredBrainHistory(
  options: BrainDiscoveredImportOptions = {},
): Promise<BrainDiscoveredImportResult> {
  const config = await loadBrainConfig({ homeDir: options.homeDir })
  const discovery = await discoverBrainHistory(options)
  const scopes = parseScopes(
    options.scopes ?? [`device/${config.device_id}`],
    'discovered import scopes',
  )
  const classification = parseClassification(
    options.classification ?? 'private',
    'discovered import classification',
  )
  const totals = emptyImportResult(
    options.dryRun ? discovery.files : 0,
    options.dryRun ? discovery.records : 0,
  )
  if (options.dryRun) {
    return {
      dryRun: true,
      discovery,
      scopes,
      classification,
      sources: [],
      totals,
    }
  }

  const importedSources: BrainDiscoveredImportResult['sources'] = []
  for (const source of discovery.sources) {
    const result =
      source.kind === 'codex-jsonl'
        ? await importCodexSource(options.homeDir, source, scopes, classification)
        : source.kind === 'hermes-sqlite'
          ? await importHermesDatabase(
              options.homeDir,
              source,
              scopes,
              classification,
            )
          : await importBrainHistory({
              homeDir: options.homeDir,
              agent: 'hermes',
              path: source.path,
              scopes,
              classification,
            })
    importedSources.push({ ...source, result })
    addImportResult(totals, result)
  }
  return {
    dryRun: false,
    discovery,
    scopes,
    classification,
    sources: importedSources,
    totals,
  }
}

async function discoverCodexSources(
  codexHome: string,
): Promise<BrainHistorySource[]> {
  const sources: BrainHistorySource[] = []
  for (const path of [
    join(codexHome, 'sessions'),
    join(codexHome, 'archived_sessions'),
  ]) {
    const files = await collectJsonlFiles(path)
    if (files.length === 0) continue
    sources.push({
      agent: 'codex',
      kind: 'codex-jsonl',
      path,
      files: files.length,
      records: files.length,
      source_bytes: await totalBytes(files),
    })
  }
  return sources
}

async function discoverHermesSources(
  hermesHome: string,
  warnings: string[],
): Promise<BrainHistorySource[]> {
  const sources: BrainHistorySource[] = []
  for (const profileHome of await hermesProfileHomes(hermesHome)) {
    const databasePath = join(profileHome, 'state.db')
    const databaseMetadata = await optionalStat(databasePath)
    if (databaseMetadata?.isFile()) {
      let records = 0
      try {
        records = countHermesSessions(databasePath)
      } catch (error) {
        warnings.push(errorMessage(error))
      }
      if (records > 0) {
        sources.push({
          agent: 'hermes',
          kind: 'hermes-sqlite',
          path: databasePath,
          files: 1,
          records,
          source_bytes: databaseMetadata.size,
        })
      }
    }
    const sessionsPath = join(profileHome, 'sessions')
    const legacyFiles = await collectJsonlFiles(sessionsPath)
    if (legacyFiles.length > 0) {
      sources.push({
        agent: 'hermes',
        kind: 'hermes-jsonl',
        path: sessionsPath,
        files: legacyFiles.length,
        records: legacyFiles.length,
        source_bytes: await totalBytes(legacyFiles),
      })
    }
  }
  return sources
}

async function importCodexSource(
  homeDir: string | undefined,
  source: BrainHistorySource,
  scopes: string[],
  classification: BrainDiscoveredImportResult['classification'],
): Promise<BrainImportResult> {
  const files = await collectJsonlFiles(source.path)
  const result = emptyImportResult(files.length, files.length)
  for (const path of files) {
    const metadata = await stat(path)
    if (
      metadata.size === 0 ||
      metadata.size > MAX_NATIVE_HISTORY_FILE_BYTES
    ) {
      result.skipped += 1
      continue
    }
    const normalized = normalizeCodexSession(await readFile(path, 'utf8'))
    if (!normalized) {
      result.skipped += 1
      continue
    }
    const imported = await importBrainTranscript({
      homeDir,
      agent: 'codex',
      importName: basename(path),
      sourceKey: `codex:${normalized.sessionId}`,
      sessionId: normalized.sessionId,
      content: normalized.content,
      scopes,
      classification,
      occurredAt: normalized.occurredAt ?? metadata.mtime,
    })
    addImportOutcomes(result, imported)
  }
  return result
}

async function importHermesDatabase(
  homeDir: string | undefined,
  source: BrainHistorySource,
  scopes: string[],
  classification: BrainDiscoveredImportResult['classification'],
): Promise<BrainImportResult> {
  const database = openHermesDatabase(source.path)
  try {
    const sessions = database.prepare(`
      SELECT id, source, model, title, parent_session_id, started_at, ended_at
      FROM sessions
      ORDER BY started_at, id
    `).all() as unknown as HermesSessionRow[]
    const messagesForSession = database.prepare(`
      SELECT id, role, content, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp, id
    `)
    const result = emptyImportResult(1, sessions.length)
    const databaseKey = createHash('sha256')
      .update(source.path)
      .digest('hex')
      .slice(0, 16)
    for (const session of sessions) {
      const messages = (
        messagesForSession.all(session.id) as unknown as HermesMessageRow[]
      )
        .filter((message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0
        )
        .map((message) => ({
          timestamp: unixSecondsToIso(message.timestamp),
          role: message.role,
          content: message.content,
        }))
      if (messages.length === 0) {
        result.skipped += 1
        continue
      }
      const occurredAt = unixSecondsToDate(session.started_at)
      const imported = await importBrainTranscript({
        homeDir,
        agent: 'hermes',
        importName: `state.db#${session.id}`,
        sourceKey: `hermes:${databaseKey}:${session.id}`,
        sessionId: session.id,
        content: `${JSON.stringify({
          schema_version: 1,
          source: 'hermes',
          session: {
            id: session.id,
            source: session.source,
            model: session.model,
            title: session.title,
            parent_session_id: session.parent_session_id,
            started_at: unixSecondsToIso(session.started_at),
            ended_at: session.ended_at === null
              ? null
              : unixSecondsToIso(session.ended_at),
          },
          messages,
        }, null, 2)}\n`,
        scopes,
        classification,
        occurredAt,
      })
      addImportOutcomes(result, imported)
    }
    return result
  } finally {
    database.close()
  }
}

function normalizeCodexSession(contents: string): {
  sessionId: string
  occurredAt: Date | null
  content: string
} | null {
  let sessionId = ''
  let sessionTimestamp: string | null = null
  const messages: NormalizedMessage[] = []
  const fallbackMessages: NormalizedMessage[] = []
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    const value = parseJsonObject(line)
    if (!value) continue
    const payload = recordValue(value.payload)
    const timestamp = stringValue(value.timestamp)
    if (value.type === 'session_meta') {
      sessionId =
        stringValue(payload?.id) ??
        stringValue(payload?.session_id) ??
        sessionId
      sessionTimestamp =
        stringValue(payload?.timestamp) ?? timestamp ?? sessionTimestamp
      continue
    }
    if (value.type === 'event_msg' && payload?.type === 'user_message') {
      pushMessage(messages, timestamp, 'user', payload.message)
      continue
    }
    if (
      value.type === 'event_msg' &&
      payload?.type === 'agent_message' &&
      (payload.phase === undefined || payload.phase === 'final_answer')
    ) {
      pushMessage(messages, timestamp, 'assistant', payload.message)
      continue
    }
    if (
      value.type === 'response_item' &&
      payload?.type === 'message' &&
      (payload.role === 'user' || payload.role === 'assistant') &&
      (payload.role !== 'assistant' ||
        payload.phase === undefined ||
        payload.phase === 'final_answer')
    ) {
      const text = responseText(payload.content)
      pushMessage(fallbackMessages, timestamp, payload.role, text)
    }
  }
  const selectedMessages = messages.length > 0 ? messages : fallbackMessages
  if (selectedMessages.length === 0) return null
  if (!sessionId) {
    sessionId = `codex-${createHash('sha256')
      .update(contents)
      .digest('hex')
      .slice(0, 24)}`
  }
  const occurredAt = validDate(sessionTimestamp ?? selectedMessages[0].timestamp)
  return {
    sessionId,
    occurredAt,
    content: `${JSON.stringify({
      schema_version: 1,
      source: 'codex',
      session_id: sessionId,
      started_at: occurredAt?.toISOString() ?? null,
      messages: selectedMessages,
    }, null, 2)}\n`,
  }
}

async function hermesProfileHomes(hermesHome: string): Promise<string[]> {
  const homes = [hermesHome]
  const profilesPath = join(hermesHome, 'profiles')
  const metadata = await optionalStat(profilesPath)
  if (!metadata?.isDirectory()) return homes
  for (const entry of await readdir(profilesPath, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      homes.push(join(profilesPath, entry.name))
    }
  }
  return homes.sort()
}

async function collectJsonlFiles(root: string): Promise<string[]> {
  const metadata = await optionalStat(root)
  if (!metadata?.isDirectory()) return []
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await collectJsonlFiles(path))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
      files.push(path)
    }
  }
  return files.sort()
}

async function totalBytes(files: string[]): Promise<number> {
  let bytes = 0
  for (const path of files) bytes += (await stat(path)).size
  return bytes
}

function countHermesSessions(path: string): number {
  const database = openHermesDatabase(path)
  try {
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM sessions')
      .get() as { count: number | bigint }
    return Number(row.count)
  } finally {
    database.close()
  }
}

function openHermesDatabase(path: string): DatabaseSync {
  try {
    const database = new DatabaseSync(path, { readOnly: true, timeout: 5000 })
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('sessions', 'messages')
    `).all() as Array<{ name: string }>
    if (new Set(tables.map((table) => table.name)).size !== 2) {
      database.close()
      throw new Error('required sessions and messages tables are missing')
    }
    return database
  } catch (error) {
    throw new Error(
      `Unable to read Hermes session database ${path}: ${errorMessage(error)}`,
    )
  }
}

function discoveryAgents(
  value: BrainHistoryDiscoveryOptions['agent'] = 'all',
): DiscoverableBrainAgent[] {
  if (value === 'all') return ['codex', 'hermes']
  if (value === 'codex' || value === 'hermes') return [value]
  throw new Error('Brain history discovery supports codex, hermes, or all')
}

function emptyImportResult(files: number, records: number): BrainImportResult {
  return {
    files,
    records,
    captured: 0,
    deduplicated: 0,
    quarantined: 0,
    skipped: 0,
  }
}

function addImportResult(
  target: BrainImportResult,
  source: BrainImportResult,
): void {
  target.files += source.files
  target.records += source.records
  addImportOutcomes(target, source)
}

function addImportOutcomes(
  target: BrainImportResult,
  source: BrainImportResult,
): void {
  target.captured += source.captured
  target.deduplicated += source.deduplicated
  target.quarantined += source.quarantined
  target.skipped += source.skipped
}

async function optionalStat(path: string) {
  try {
    return await stat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return recordValue(JSON.parse(value))
  } catch {
    return null
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function responseText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      const record = recordValue(part)
      return record &&
        (record.type === 'input_text' || record.type === 'output_text')
        ? stringValue(record.text) ?? ''
        : ''
    })
    .filter(Boolean)
    .join('\n')
}

function pushMessage(
  target: NormalizedMessage[],
  timestamp: string | null,
  role: 'user' | 'assistant',
  content: unknown,
): void {
  const text = stringValue(content)
  if (!text) return
  target.push({ timestamp, role, content: text })
}

function validDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function unixSecondsToDate(value: number): Date {
  const date = new Date(Number(value) * 1000)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Hermes session timestamp: ${value}`)
  }
  return date
}

function unixSecondsToIso(value: number): string {
  return unixSecondsToDate(value).toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface NormalizedMessage {
  timestamp: string | null
  role: 'user' | 'assistant'
  content: string
}

interface HermesSessionRow {
  id: string
  source: string
  model: string | null
  title: string | null
  parent_session_id: string | null
  started_at: number
  ended_at: number | null
}

interface HermesMessageRow {
  id: number
  role: string
  content: string | null
  timestamp: number
}
