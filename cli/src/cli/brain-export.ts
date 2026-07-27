import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import { indexBrain } from './brain-index.ts'
import { CLASSIFICATION_RANK } from './brain-schema.ts'
import type {
  BrainExportOptions,
  BrainExportResult,
  Classification,
} from './brain-types.ts'
import { writeFileAtomic } from './safe-io.ts'

const EXPORT_MARKER = '.deweyou-brain-export.json'

interface ExportRow {
  id: string
  path: string
  type: string
  title: string
  classification: Classification
  scopes: string
}

export async function exportBrainProjection(
  options: BrainExportOptions,
): Promise<BrainExportResult> {
  const config = await loadBrainConfig({ homeDir: options.homeDir })
  const outputDir = resolve(options.outputDir)
  assertExternalOutput(config.knowledge_repo, outputDir)
  const clearance = options.clearance ?? 'public'
  const allowedScopes = options.allowedScopes ?? config.defaults.scopes
  const format = options.format ?? 'wiki'
  await indexBrain({ homeDir: options.homeDir })
  const rows = selectExportRows({
    databasePath: brainPaths(options.homeDir).databasePath,
    clearance,
    allowedScopes,
    format,
  })
  const paths = rows.map((row) => row.path)
  const projectionScopes =
    allowedScopes.length > 0
      ? allowedScopes
      : ['system/empty-projection']
  const result: BrainExportResult = {
    outputDir,
    clearance,
    allowedScopes,
    format,
    exported: paths.length,
    paths,
    dryRun: options.dryRun === true,
  }
  if (options.dryRun) return result

  await assertManagedDestination(outputDir)
  const temporary = `${outputDir}.deweyou-tmp-${process.pid}-${Date.now()}`
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  for (const row of rows) {
    const target = join(temporary, row.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFileAtomic(
      target,
      await readFile(join(config.knowledge_repo, row.path), 'utf8'),
    )
  }
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    clearance,
    allowed_scopes: allowedScopes,
    format,
    artifacts: rows.map((row) => ({
      id: row.id,
      path: row.path,
      type: row.type,
      title: row.title,
      classification: row.classification,
      scopes: JSON.parse(row.scopes),
    })),
  }
  await writeFileAtomic(
    join(temporary, EXPORT_MARKER),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await writeFileAtomic(
    join(temporary, 'AGENTS.md'),
    `---
id: projection-agent-entry
type: instruction
title: Deweyou Brain Projection
classification: ${clearance}
scope:
${projectionScopes.map((scope) => `  - ${scope}`).join('\n')}
status: active
generated: true
---

# Deweyou Brain Projection

This directory is a generated, classification-filtered projection.
Do not treat it as the canonical knowledge ledger or edit it in place.
Clearance: ${clearance}
Scopes: ${allowedScopes.join(', ')}
`,
  )
  if (await exists(outputDir)) await rm(outputDir, { recursive: true })
  await rename(temporary, outputDir)
  return result
}

function selectExportRows({
  databasePath,
  clearance,
  allowedScopes,
  format,
}: {
  databasePath: string
  clearance: Classification
  allowedScopes: string[]
  format: 'wiki' | 'knowledge'
}): ExportRow[] {
  if (allowedScopes.length === 0) return []
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const types = format === 'wiki'
      ? ['wiki', 'catalog', 'purpose']
      : ['wiki', 'catalog', 'purpose', 'claim', 'decision']
    const typePlaceholders = types.map(() => '?').join(', ')
    const scopeWhere = allowedScopes
      .map(() => '(s.scope = ? OR s.scope LIKE ?)')
      .join(' OR ')
    const scopeArgs = allowedScopes.flatMap((scope) => [scope, `${scope}/%`])
    return database.prepare(`
      SELECT
        a.id, a.path, a.type, a.title, a.classification,
        (SELECT json_group_array(scope) FROM artifact_scopes WHERE artifact_id = a.id) AS scopes
      FROM artifacts a
      WHERE a.classification_rank <= ?
        AND a.status = 'active'
        AND a.type IN (${typePlaceholders})
        AND EXISTS (
          SELECT 1 FROM artifact_scopes s
          WHERE s.artifact_id = a.id AND (${scopeWhere})
        )
      ORDER BY a.path
    `).all(
      CLASSIFICATION_RANK[clearance],
      ...types,
      ...scopeArgs,
    ) as unknown as ExportRow[]
  } finally {
    database.close()
  }
}

function assertExternalOutput(repoRoot: string, outputDir: string): void {
  const fromRepo = relative(repoRoot, outputDir)
  if (fromRepo === '' || (!fromRepo.startsWith('..') && !fromRepo.startsWith('/'))) {
    throw new Error('Brain export output must be outside the canonical knowledge repository')
  }
}

async function assertManagedDestination(outputDir: string): Promise<void> {
  if (!await exists(outputDir)) return
  if (!await exists(join(outputDir, EXPORT_MARKER))) {
    throw new Error(
      `Brain export refuses to replace an unmanaged directory: ${outputDir}`,
    )
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
