import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import { indexBrain } from './brain-index.ts'
import type { ArtifactStatus, Classification } from './brain-types.ts'
import { writeJsonAtomic } from './safe-io.ts'

export type UserArtifactStatus = Extract<
  ArtifactStatus,
  'active' | 'stale' | 'archived' | 'deleted'
>

interface TargetRow {
  id: string
  type: string
  classification: Classification
  scopes: string
  status: ArtifactStatus
}

export async function recordArtifactStateDecision({
  homeDir,
  artifactId,
  targetStatus,
  reason,
  now = new Date(),
}: {
  homeDir?: string
  artifactId: string
  targetStatus: UserArtifactStatus
  reason: string
  now?: Date
}): Promise<{ decisionId: string; decisionPath: string; previousStatus: ArtifactStatus }> {
  if (!artifactId.trim()) throw new Error('Brain state decision requires an artifact id')
  if (!reason.trim()) throw new Error('Brain state decision requires a reason')
  await indexBrain({ homeDir })
  const config = await loadBrainConfig({ homeDir })
  const target = targetRow(brainPaths(homeDir).databasePath, artifactId)
  if (!target) throw new Error(`Brain artifact not found: ${artifactId}`)
  if (target.type === 'decision') {
    throw new Error('Brain state decisions cannot target another decision')
  }
  const createdAt = now.toISOString()
  const decisionId = `decision_${createHash('sha256')
    .update(JSON.stringify([artifactId, targetStatus, reason.trim(), createdAt]))
    .digest('hex')
    .slice(0, 24)}`
  const decisionPath = join(config.knowledge_repo, 'decisions', `${decisionId}.json`)
  await writeJsonAtomic(decisionPath, {
    schema_version: 1,
    decision_id: decisionId,
    decision_type: 'artifact-status',
    created_at: createdAt,
    requested_by: 'user',
    target_ids: [artifactId],
    previous_status: target.status,
    target_status: targetStatus,
    reason: reason.trim(),
    classification: target.classification,
    scopes: JSON.parse(target.scopes),
    status: 'active',
  })
  await indexBrain({ homeDir })
  return { decisionId, decisionPath, previousStatus: target.status }
}

function targetRow(databasePath: string, artifactId: string): TargetRow | null {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return database.prepare(`
      SELECT
        a.id, a.type, a.classification, a.status,
        (SELECT json_group_array(scope) FROM artifact_scopes WHERE artifact_id = a.id) AS scopes
      FROM artifacts a
      WHERE a.id = ?
    `).get(artifactId) as unknown as TargetRow | undefined ?? null
  } finally {
    database.close()
  }
}
