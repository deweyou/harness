import yaml from 'js-yaml'

import {
  ARTIFACT_STATUSES,
  CLASSIFICATIONS,
  type ArtifactStatus,
  type BrainArtifact,
  type Classification,
} from './brain-types.ts'

const { load: loadYaml, JSON_SCHEMA } = yaml

export const CLASSIFICATION_RANK: Record<Classification, number> = {
  public: 0,
  private: 1,
  confidential: 2,
  restricted: 3,
}

export interface ArtifactDefaults {
  classification: Classification
  scopes: string[]
}

export function parseBrainMarkdown({
  path,
  contents,
  defaults,
}: {
  path: string
  contents: string
  defaults: ArtifactDefaults
}): BrainArtifact {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error(`${path}: missing YAML frontmatter`)

  const value = loadYaml(match[1], { schema: JSON_SCHEMA })
  if (!isRecord(value)) throw new Error(`${path}: frontmatter must be an object`)

  const id = requiredString(value.id, `${path}: frontmatter id`)
  const type = requiredString(value.type, `${path}: frontmatter type`)
  const classification = parseClassification(
    value.classification ?? defaults.classification,
    path,
  )
  const scopes = parseScopes(value.scope ?? value.scopes ?? defaults.scopes, path)
  const status = parseArtifactStatus(value.status ?? 'active', path)
  const body = contents.slice(match[0].length).trim()
  const title =
    optionalString(value.title) ??
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    id

  return {
    id,
    type,
    path,
    title,
    body,
    classification,
    scopes,
    status,
    authority: optionalString(value.authority) ?? 'unknown',
    confidence: optionalNumber(value.confidence),
    updatedAt: optionalString(value.updated_at),
    provisional: value.provisional === true,
    metadata: value,
  }
}

export function parseClassification(value: unknown, label = 'classification'): Classification {
  if (
    typeof value !== 'string' ||
    !CLASSIFICATIONS.includes(value as Classification)
  ) {
    throw new Error(`Invalid classification in ${label}: ${String(value)}`)
  }
  return value as Classification
}

export function parseArtifactStatus(value: unknown, label = 'status'): ArtifactStatus {
  if (
    typeof value !== 'string' ||
    !ARTIFACT_STATUSES.includes(value as ArtifactStatus)
  ) {
    throw new Error(`Invalid artifact status in ${label}: ${String(value)}`)
  }
  return value as ArtifactStatus
}

export function parseScopes(value: unknown, label = 'scope'): string[] {
  const values = typeof value === 'string' ? [value] : value
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !values.every((scope) => typeof scope === 'string' && isValidScope(scope))
  ) {
    throw new Error(`Invalid scope in ${label}`)
  }
  return [...new Set(values)]
}

export function validateClassificationTransition(
  current: Classification,
  next: Classification,
  actor: 'model' | 'policy' | 'user',
): void {
  if (
    actor === 'model' &&
    CLASSIFICATION_RANK[next] < CLASSIFICATION_RANK[current]
  ) {
    throw new Error(
      `A model may not lower classification from ${current} to ${next}`,
    )
  }
}

export function maxClassification(
  classifications: Classification[],
): Classification {
  if (classifications.length === 0) return 'private'
  return classifications.reduce((highest, current) =>
    CLASSIFICATION_RANK[current] > CLASSIFICATION_RANK[highest]
      ? current
      : highest,
  )
}

function isValidScope(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 180 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) &&
    !value.includes('..')
  )
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value)
  if (!result) throw new Error(`${label} must be a non-empty string`)
  return result
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
