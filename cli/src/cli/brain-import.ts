import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { captureBrainEvent } from './brain.ts'
import { loadBrainConfig } from './brain-config.ts'
import { parseClassification, parseScopes } from './brain-schema.ts'
import {
  BRAIN_AGENTS,
  type BrainImportOptions,
  type BrainImportResult,
  type Classification,
} from './brain-types.ts'

const SUPPORTED_EXTENSIONS = ['.json', '.jsonl', '.md', '.txt', '.yaml', '.yml']
const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024
const IMPORT_CHUNK_BYTES = 8 * 1024 * 1024

export interface BrainTranscriptImportOptions {
  homeDir?: string
  agent: (typeof BRAIN_AGENTS)[number]
  importName: string
  sourceKey: string
  sessionId: string
  content: string
  scopes: string[]
  classification: Classification
  occurredAt: Date
}

export async function importBrainHistory(
  options: BrainImportOptions,
): Promise<BrainImportResult> {
  const config = await loadBrainConfig({ homeDir: options.homeDir })
  const agent = parseAgent(options.agent)
  const scopes = parseScopes(options.scopes ?? config.defaults.scopes, 'import scopes')
  const classification = parseClassification(
    options.classification ?? config.defaults.classification,
    'import classification',
  )
  const files = await collectFiles(options.path)
  const result: BrainImportResult = {
    files: files.length,
    records: files.length,
    captured: 0,
    deduplicated: 0,
    quarantined: 0,
    skipped: 0,
  }

  for (const path of files) {
    const metadata = await stat(path)
    if (metadata.size === 0 || metadata.size > MAX_IMPORT_FILE_BYTES) {
      result.skipped += 1
      continue
    }
    const bytes = await readFile(path)
    const imported = await importBrainTranscript({
      homeDir: options.homeDir,
      agent,
      importName: basename(path),
      sourceKey: `${path}:${metadata.mtimeMs}`,
      sessionId: `import-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`,
      content: bytes.toString('utf8'),
      scopes,
      classification,
      occurredAt: options.now ?? metadata.mtime,
    })
    addOutcomes(result, imported)
  }
  return result
}

export async function importBrainTranscript(
  options: BrainTranscriptImportOptions,
): Promise<BrainImportResult> {
  const contentBytes = Buffer.from(options.content)
  const contentHash = createHash('sha256').update(contentBytes).digest('hex')
  const chunks = splitUtf8(contentBytes, IMPORT_CHUNK_BYTES)
  const result: BrainImportResult = {
    files: 1,
    records: 1,
    captured: 0,
    deduplicated: 0,
    quarantined: 0,
    skipped: chunks.length === 0 ? 1 : 0,
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const importId = createHash('sha256')
      .update(
        `${options.agent}:${options.sourceKey}:${contentHash}:${index}`,
      )
      .digest('hex')
      .slice(0, 32)
    const captured = await captureBrainEvent({
      homeDir: options.homeDir,
      agent: options.agent,
      eventType: 'historical-import',
      sessionId: options.sessionId,
      scopes: options.scopes,
      classification: options.classification,
      payload: {
        transcript: chunks[index].toString('utf8'),
        import_name: options.importName,
        import_content_hash: contentHash,
        import_part: index + 1,
        import_parts: chunks.length,
      },
      now: options.occurredAt,
      idFactory: () => `import-${importId}-${index + 1}`,
    })
    if (captured.status === 'quarantined') result.quarantined += 1
    else if (captured.created) result.captured += 1
    else result.deduplicated += 1
  }
  return result
}

function splitUtf8(bytes: Buffer, maxBytes: number): Buffer[] {
  const chunks: Buffer[] = []
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + maxBytes, bytes.length)
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1
    }
    if (end === start) end = Math.min(start + maxBytes, bytes.length)
    chunks.push(bytes.subarray(start, end))
    start = end
  }
  return chunks
}

async function collectFiles(path: string): Promise<string[]> {
  const metadata = await stat(path)
  if (metadata.isFile()) return isSupported(path) ? [path] : []
  if (!metadata.isDirectory()) return []

  const files: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(child))
    else if (entry.isFile() && isSupported(child)) files.push(child)
  }
  return files.sort()
}

function isSupported(path: string): boolean {
  const lower = path.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function parseAgent(value: string) {
  if (!BRAIN_AGENTS.includes(value as (typeof BRAIN_AGENTS)[number])) {
    throw new Error(`Brain agent must be one of ${BRAIN_AGENTS.join(', ')}`)
  }
  return value as (typeof BRAIN_AGENTS)[number]
}

function addOutcomes(target: BrainImportResult, source: BrainImportResult): void {
  target.captured += source.captured
  target.deduplicated += source.deduplicated
  target.quarantined += source.quarantined
  target.skipped += source.skipped
}
