import { randomUUID } from 'node:crypto'

import type {
  DevEvent,
  DevEventKind,
  DevSessionSummary,
} from './types.ts'

const EVENT_KINDS = new Set<DevEventKind>([
  'requirement',
  'node',
  'evidence',
  'failure',
  'review',
  'recovery',
  'delivery',
])

const REQUIREMENT_STATUSES = new Set([
  'alignment_required',
  'confirmed',
  'confirmation_not_required',
])
const ACCEPTANCE_SOURCES = new Set(['user', 'existing_contract', 'inferred'])
const NODE_STATUSES = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'blocked',
  'skipped',
])
const EVIDENCE_STATUSES = new Set(['verified', 'failed', 'blocked', 'unverified'])
const FAILURE_CLASSES = new Set([
  'requirement',
  'design',
  'implementation',
  'verification',
  'environment',
  'permission',
  'external',
  'user_decision',
  'unknown',
])
const REVIEW_VERDICTS = new Set(['approved', 'changes_requested', 'blocked'])
const RECOVERY_STATUSES = new Set(['planned', 'resumed', 'completed', 'abandoned'])
const DELIVERY_STATUSES = new Set(['pending', 'completed', 'blocked', 'not_requested'])

export function parseDevEventKind(value: string | undefined): DevEventKind {
  if (!value || !EVENT_KINDS.has(value as DevEventKind)) {
    throw new Error(`Invalid DDev event kind: ${value ?? 'missing'}`)
  }
  return value as DevEventKind
}

export function parseDevEventPayload(
  kind: DevEventKind,
  value: string | undefined,
): Record<string, unknown> {
  if (!value) throw new Error('Missing DDev event data')

  let payload: unknown
  try {
    payload = JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid DDev event data JSON: ${errorMessage(error)}`)
  }

  if (!isRecord(payload)) throw new Error('DDev event data must be a JSON object')
  validatePayload(kind, payload)
  return payload
}

export function createDevEvent(
  kind: DevEventKind,
  branch: string,
  payload: Record<string, unknown>,
  occurredAt = new Date(),
): DevEvent {
  return {
    schema_version: 1,
    event_id: `evt_${occurredAt.getTime()}_${randomUUID()}`,
    occurred_at: occurredAt.toISOString(),
    kind,
    branch,
    payload,
  }
}

export function parseDevEventLog(value: string): DevEvent[] {
  const lines = value.split(/\r?\n/)
  const events: DevEvent[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue

    try {
      const event: unknown = JSON.parse(line)
      if (!isDevEvent(event)) throw new Error('event envelope does not match schema version 1')
      validatePayload(event.kind, event.payload)
      events.push(event)
    } catch (error) {
      throw new Error(`Invalid DDev event at line ${index + 1}: ${errorMessage(error)}`)
    }
  }

  return events
}

export function summarizeDevEvents(
  branch: string,
  events: DevEvent[],
  generatedAt = new Date(),
): DevSessionSummary {
  const counts = new Map<string, number>()
  const nodes = new Map<string, DevSessionSummary['nodes'][number]>()
  const claims = new Map<string, DevSessionSummary['claims'][number]>()
  const failures: DevSessionSummary['failures'] = []
  const reviews = new Map<string, DevSessionSummary['reviews'][number]>()
  const recoveries = new Map<string, DevSessionSummary['recoveries'][number]>()
  const deliveries = new Map<string, DevSessionSummary['deliveries'][number]>()
  let requirement: DevSessionSummary['requirement'] = null

  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
    const payload = event.payload

    if (event.kind === 'requirement') {
      requirement = {
        status: stringValue(payload.status),
        acceptance_source: stringValue(payload.acceptance_source),
        unresolved_decisions: stringArray(payload.unresolved_decisions),
        event_id: event.event_id,
      }
    }

    if (event.kind === 'node') {
      nodes.set(stringValue(payload.node_id), {
        node_id: stringValue(payload.node_id),
        node_type: stringValue(payload.node_type),
        status: stringValue(payload.status),
        depends_on: stringArray(payload.depends_on),
        evidence_ids: stringArray(payload.evidence_ids),
        event_id: event.event_id,
      })
    }

    if (event.kind === 'evidence') {
      const claimId = stringValue(payload.claim_id)
      const current = claims.get(claimId) ?? {
        claim_id: claimId,
        status: stringValue(payload.status),
        evidence_ids: [],
        summaries: [],
      }
      current.status = stringValue(payload.status)
      current.evidence_ids.push(stringValue(payload.evidence_id))
      current.summaries.push(stringValue(payload.summary))
      claims.set(claimId, current)
    }

    if (event.kind === 'failure') {
      failures.push({
        failure_id: stringValue(payload.failure_id),
        node_id: stringValue(payload.node_id),
        failure_class: stringValue(payload.failure_class),
        summary: stringValue(payload.summary),
        evidence_ids: stringArray(payload.evidence_ids),
        restart_from: optionalString(payload.restart_from),
        retryable: optionalBoolean(payload.retryable),
        event_id: event.event_id,
      })
    }

    if (event.kind === 'review') {
      const reviewId = stringValue(payload.review_id)
      reviews.set(reviewId, {
        review_id: reviewId,
        scope: stringValue(payload.scope),
        verdict: stringValue(payload.verdict),
        findings: stringArray(payload.findings),
        evidence_ids: stringArray(payload.evidence_ids),
        restart_from: optionalString(payload.restart_from),
        event_id: event.event_id,
      })
    }

    if (event.kind === 'recovery') {
      const recoveryId = stringValue(payload.recovery_id)
      recoveries.set(recoveryId, {
        recovery_id: recoveryId,
        source_event_id: stringValue(payload.source_event_id),
        restart_from: stringValue(payload.restart_from),
        reason: stringValue(payload.reason),
        status: stringValue(payload.status),
        event_id: event.event_id,
      })
    }

    if (event.kind === 'delivery') {
      const deliveryId = stringValue(payload.delivery_id)
      deliveries.set(deliveryId, {
        delivery_id: deliveryId,
        status: stringValue(payload.status),
        summary: stringValue(payload.summary),
        evidence_ids: stringArray(payload.evidence_ids),
        event_id: event.event_id,
      })
    }
  }

  const sortedCounts = Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
  const nodeList = [...nodes.values()].sort((left, right) => left.node_id.localeCompare(right.node_id))
  const claimList = [...claims.values()].sort((left, right) => left.claim_id.localeCompare(right.claim_id))
  const reviewList = [...reviews.values()].sort((left, right) => left.review_id.localeCompare(right.review_id))
  const recoveryList = [...recoveries.values()].sort((left, right) => left.recovery_id.localeCompare(right.recovery_id))
  const deliveryList = [...deliveries.values()].sort((left, right) => left.delivery_id.localeCompare(right.delivery_id))

  return {
    schema_version: 1,
    branch,
    generated_at: generatedAt.toISOString(),
    event_count: events.length,
    counts: sortedCounts,
    requirement,
    nodes: nodeList,
    claims: claimList,
    failures,
    reviews: reviewList,
    recoveries: recoveryList,
    deliveries: deliveryList,
    open_issues: openIssues(
      requirement,
      nodeList,
      claimList,
      reviewList,
      recoveryList,
      deliveryList,
    ),
  }
}

export function renderDevSummary(summary: DevSessionSummary): string {
  const lines = [
    '# DDev Session Summary',
    '',
    `- Branch: \`${summary.branch}\``,
    `- Generated at: ${summary.generated_at}`,
    `- Events: ${summary.event_count}`,
    '',
    '## Requirement',
    '',
  ]

  if (summary.requirement) {
    lines.push(
      `- Status: \`${summary.requirement.status}\``,
      `- Acceptance source: \`${summary.requirement.acceptance_source}\``,
    )
    for (const decision of summary.requirement.unresolved_decisions) {
      lines.push(`- Unresolved: ${decision}`)
    }
  } else {
    lines.push('- No requirement event recorded.')
  }

  lines.push('', '## Nodes', '')
  if (summary.nodes.length === 0) lines.push('- No node events recorded.')
  for (const node of summary.nodes) {
    lines.push(`- \`${node.node_id}\` (${node.node_type}): \`${node.status}\``)
  }

  lines.push('', '## Claims And Evidence', '')
  if (summary.claims.length === 0) lines.push('- No evidence events recorded.')
  for (const claim of summary.claims) {
    lines.push(`- \`${claim.claim_id}\`: \`${claim.status}\` via ${claim.evidence_ids.map(code).join(', ')}`)
  }

  lines.push('', '## Failures And Recovery', '')
  if (summary.failures.length === 0 && summary.recoveries.length === 0) {
    lines.push('- No failure or recovery events recorded.')
  }
  for (const failure of summary.failures) {
    lines.push(`- Failure \`${failure.failure_id}\` on \`${failure.node_id}\`: ${failure.summary}`)
    if (failure.evidence_ids.length > 0) {
      lines.push(`  - Evidence: ${failure.evidence_ids.map(code).join(', ')}`)
    }
    if (failure.restart_from) lines.push(`  - Restart from \`${failure.restart_from}\`.`)
  }
  for (const recovery of summary.recoveries) {
    lines.push(`- Recovery \`${recovery.recovery_id}\`: \`${recovery.status}\`, restart from \`${recovery.restart_from}\`.`)
  }

  lines.push('', '## Reviews', '')
  if (summary.reviews.length === 0) lines.push('- No review events recorded.')
  for (const review of summary.reviews) {
    lines.push(`- \`${review.review_id}\` (${review.scope}): \`${review.verdict}\``)
    for (const finding of review.findings) lines.push(`  - Finding: ${finding}`)
    if (review.evidence_ids.length > 0) {
      lines.push(`  - Evidence: ${review.evidence_ids.map(code).join(', ')}`)
    }
  }

  lines.push('', '## Delivery', '')
  if (summary.deliveries.length === 0) lines.push('- No delivery events recorded.')
  for (const delivery of summary.deliveries) {
    lines.push(`- \`${delivery.delivery_id}\`: \`${delivery.status}\` — ${delivery.summary}`)
    if (delivery.evidence_ids.length > 0) {
      lines.push(`  - Evidence: ${delivery.evidence_ids.map(code).join(', ')}`)
    }
  }

  lines.push('', '## Open Issues', '')
  if (summary.open_issues.length === 0) lines.push('- None.')
  for (const issue of summary.open_issues) lines.push(`- ${issue}`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

function validatePayload(kind: DevEventKind, payload: Record<string, unknown>): void {
  if (kind === 'requirement') {
    requireEnum(payload, 'status', REQUIREMENT_STATUSES)
    requireEnum(payload, 'acceptance_source', ACCEPTANCE_SOURCES)
    optionalStringArray(payload, 'unresolved_decisions')
    return
  }

  if (kind === 'node') {
    requireString(payload, 'node_id')
    requireString(payload, 'node_type')
    requireEnum(payload, 'status', NODE_STATUSES)
    optionalStringArray(payload, 'depends_on')
    optionalStringArray(payload, 'evidence_ids')
    optionalRecord(payload, 'input')
    optionalRecord(payload, 'output')
    return
  }

  if (kind === 'evidence') {
    requireString(payload, 'evidence_id')
    requireString(payload, 'claim_id')
    requireString(payload, 'evidence_type')
    requireEnum(payload, 'status', EVIDENCE_STATUSES)
    requireString(payload, 'summary')
    validateOptionalString(payload, 'command')
    optionalNumber(payload, 'exit_code')
    validateOptionalString(payload, 'artifact')
    return
  }

  if (kind === 'failure') {
    requireString(payload, 'failure_id')
    requireString(payload, 'node_id')
    requireEnum(payload, 'failure_class', FAILURE_CLASSES)
    requireString(payload, 'summary')
    optionalStringArray(payload, 'evidence_ids')
    validateOptionalString(payload, 'restart_from')
    optionalBooleanField(payload, 'retryable')
    return
  }

  if (kind === 'review') {
    requireString(payload, 'review_id')
    requireString(payload, 'scope')
    requireEnum(payload, 'verdict', REVIEW_VERDICTS)
    optionalStringArray(payload, 'findings')
    optionalStringArray(payload, 'evidence_ids')
    validateOptionalString(payload, 'restart_from')
    return
  }

  if (kind === 'recovery') {
    requireString(payload, 'recovery_id')
    requireString(payload, 'source_event_id')
    requireString(payload, 'restart_from')
    requireString(payload, 'reason')
    requireEnum(payload, 'status', RECOVERY_STATUSES)
    return
  }

  requireString(payload, 'delivery_id')
  requireEnum(payload, 'status', DELIVERY_STATUSES)
  requireString(payload, 'summary')
  optionalStringArray(payload, 'evidence_ids')
}

function openIssues(
  requirement: DevSessionSummary['requirement'],
  nodes: DevSessionSummary['nodes'],
  claims: DevSessionSummary['claims'],
  reviews: DevSessionSummary['reviews'],
  recoveries: DevSessionSummary['recoveries'],
  deliveries: DevSessionSummary['deliveries'],
): string[] {
  const issues: string[] = []
  if (requirement?.status === 'alignment_required') {
    issues.push('Requirement alignment is still required.')
  }
  for (const node of nodes) {
    if (node.status !== 'completed' && node.status !== 'skipped') {
      issues.push(`Node \`${node.node_id}\` is ${node.status}.`)
    }
  }
  for (const claim of claims) {
    if (claim.status !== 'verified') issues.push(`Claim \`${claim.claim_id}\` is ${claim.status}.`)
  }
  for (const review of reviews) {
    if (review.verdict === 'changes_requested') {
      issues.push(`Review \`${review.review_id}\` requests changes.`)
    } else if (review.verdict === 'blocked') {
      issues.push(`Review \`${review.review_id}\` is blocked.`)
    }
  }
  for (const recovery of recoveries) {
    if (recovery.status === 'planned' || recovery.status === 'resumed') {
      issues.push(`Recovery \`${recovery.recovery_id}\` is ${recovery.status}.`)
    }
  }
  for (const delivery of deliveries) {
    if (delivery.status === 'pending' || delivery.status === 'blocked') {
      issues.push(`Delivery \`${delivery.delivery_id}\` is ${delivery.status}.`)
    }
  }
  return issues
}

function isDevEvent(value: unknown): value is DevEvent {
  return isRecord(value)
    && value.schema_version === 1
    && typeof value.event_id === 'string'
    && typeof value.occurred_at === 'string'
    && typeof value.branch === 'string'
    && typeof value.kind === 'string'
    && EVENT_KINDS.has(value.kind as DevEventKind)
    && isRecord(value.payload)
}

function requireString(payload: Record<string, unknown>, key: string): void {
  if (typeof payload[key] !== 'string' || payload[key].trim() === '') {
    throw new Error(`DDev event field ${key} must be a non-empty string`)
  }
}

function requireEnum(
  payload: Record<string, unknown>,
  key: string,
  values: Set<string>,
): void {
  requireString(payload, key)
  if (!values.has(payload[key] as string)) {
    throw new Error(`DDev event field ${key} must be one of: ${[...values].join(', ')}`)
  }
}

function validateOptionalString(payload: Record<string, unknown>, key: string): void {
  if (payload[key] !== undefined && typeof payload[key] !== 'string') {
    throw new Error(`DDev event field ${key} must be a string`)
  }
}

function optionalStringArray(payload: Record<string, unknown>, key: string): void {
  if (payload[key] === undefined) return
  if (!Array.isArray(payload[key]) || payload[key].some((value) => typeof value !== 'string')) {
    throw new Error(`DDev event field ${key} must be an array of strings`)
  }
}

function optionalRecord(payload: Record<string, unknown>, key: string): void {
  if (payload[key] !== undefined && !isRecord(payload[key])) {
    throw new Error(`DDev event field ${key} must be an object`)
  }
}

function optionalNumber(payload: Record<string, unknown>, key: string): void {
  if (payload[key] !== undefined && typeof payload[key] !== 'number') {
    throw new Error(`DDev event field ${key} must be a number`)
  }
}

function optionalBooleanField(payload: Record<string, unknown>, key: string): void {
  if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
    throw new Error(`DDev event field ${key} must be a boolean`)
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function code(value: string): string {
  return `\`${value}\``
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
