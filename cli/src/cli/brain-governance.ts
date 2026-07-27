import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import yaml from 'js-yaml'

import { loadBrainConfig } from './brain-config.ts'
import {
  isRecord,
  maxClassification,
  parseClassification,
  parseScopes,
  validateClassificationTransition,
} from './brain-schema.ts'
import type {
  AppliedResolution,
  ProposedClaim,
  ResolutionApplyResult,
  ResolutionOperation,
  ResolutionOperationType,
  ResolutionProposal,
} from './brain-types.ts'
import { writeFileAtomic, writeJsonAtomic } from './safe-io.ts'

const { dump: dumpYaml } = yaml
const OPERATION_TYPES = new Set<ResolutionOperationType>([
  'ADD_CLAIM',
  'MERGE_CLAIMS',
  'SUPERSEDE_CLAIM',
  'SPLIT_SCOPE',
  'MARK_STALE',
  'LINK_ENTITIES',
  'REJECT_OBSERVATION',
  'REQUEST_HUMAN_DECISION',
])

export function validateResolutionProposal(
  value: ResolutionProposal,
): ResolutionProposal {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new Error('Resolution proposal schema_version must be 1')
  }
  requiredId(value.job_id, 'job_id')
  requiredId(value.device_id, 'device_id')
  requiredString(value.created_at, 'created_at')
  requiredString(value.policy_version, 'policy_version')
  requiredString(value.provider, 'provider')
  requiredString(value.model, 'model')
  requiredString(value.prompt_version, 'prompt_version')
  confidence(value.confidence, 'proposal confidence')
  stringArray(value.input_ids, 'input_ids')
  stringArray(value.evidence_refs, 'evidence_refs')
  const inputClassification = parseClassification(
    value.input_classification,
    'proposal input_classification',
  )
  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    throw new Error('Resolution proposal operations must be a non-empty array')
  }

  for (const operation of value.operations) {
    if (!isRecord(operation) || !OPERATION_TYPES.has(operation.op as ResolutionOperationType)) {
      throw new Error(
        `Unsupported resolution operation: ${String(isRecord(operation) ? operation.op : operation)}`,
      )
    }
    validateOperation(operation as unknown as ResolutionOperation, inputClassification)
  }
  return value
}

export async function applyResolutionProposal({
  homeDir,
  proposal: rawProposal,
}: {
  homeDir?: string
  proposal: ResolutionProposal
}): Promise<ResolutionApplyResult> {
  const config = await loadBrainConfig({ homeDir })
  const proposal = validateResolutionProposal(structuredClone(rawProposal))
  if (proposal.policy_version !== config.compiler.policy_version) {
    throw new Error(
      `Resolution policy ${proposal.policy_version} does not match configured ${config.compiler.policy_version}`,
    )
  }
  const proposalPath = join(
    config.knowledge_repo,
    'resolutions',
    'proposals',
    safeId(proposal.job_id),
    `${safeId(proposal.device_id)}.json`,
  )
  const resolutionPath = join(
    config.knowledge_repo,
    'resolutions',
    'jobs',
    `${safeId(proposal.job_id)}.json`,
  )
  for (let index = 0; index < proposal.operations.length; index += 1) {
    const claim = proposal.operations[index].claim
    if (claim && !claim.id) {
      claim.id = deterministicClaimId(proposal.job_id, index, claim)
    }
  }
  const proposalJson = `${JSON.stringify(proposal, null, 2)}\n`
  await writeImmutable(proposalPath, proposalJson)

  if (await exists(resolutionPath)) {
    const existing = JSON.parse(await readFile(resolutionPath, 'utf8')) as AppliedResolution
    if (existing.selected_proposal !== relativeProposalPath(proposal)) {
      throw new Error(
        `Job ${proposal.job_id} already has a different canonical resolution`,
      )
    }
    return {
      proposalPath,
      resolutionPath,
      claimPaths: claimPathsFromResolution(config.knowledge_repo, existing),
      claimIds: claimIdsFromResolution(existing),
      alreadyApplied: true,
    }
  }

  const claimPaths: string[] = []
  const claimIds: string[] = []
  for (let index = 0; index < proposal.operations.length; index += 1) {
    const operation = proposal.operations[index]
    if (!operation.claim) continue
    const claimId = operation.claim.id!
    const claimPath = join(config.knowledge_repo, 'claims', `${safeId(claimId)}.md`)
    await writeImmutable(
      claimPath,
      renderClaim(operation.claim, proposal, claimId),
    )
    claimPaths.push(claimPath)
    claimIds.push(claimId)
  }

  const resolutionClassification = maxClassification([
    proposal.input_classification,
    ...proposal.operations
      .map((operation) => operation.claim?.classification)
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
  ])
  const resolutionScopes = [
    ...new Set(
      proposal.operations.flatMap((operation) =>
        operation.claim?.scopes ?? operation.scopes ?? [],
      ),
    ),
  ]
  const resolution: AppliedResolution = {
    schema_version: 1,
    resolution_id: `resolution_${proposal.job_id}`,
    job_id: proposal.job_id,
    selected_proposal: relativeProposalPath(proposal),
    resolved_at: proposal.created_at,
    policy_version: proposal.policy_version,
    confidence: proposal.confidence,
    input_ids: proposal.input_ids,
    evidence_refs: proposal.evidence_refs,
    classification: resolutionClassification,
    scopes: resolutionScopes.length > 0 ? resolutionScopes : config.defaults.scopes,
    status: 'active',
    operations: proposal.operations,
  }
  await writeJsonAtomic(resolutionPath, resolution)

  return {
    proposalPath,
    resolutionPath,
    claimPaths,
    claimIds,
    alreadyApplied: false,
  }
}

function validateOperation(
  operation: ResolutionOperation,
  inputClassification: ReturnType<typeof parseClassification>,
): void {
  if (operation.claim_ids) stringArray(operation.claim_ids, `${operation.op}.claim_ids`)
  if (operation.observation_ids) {
    stringArray(operation.observation_ids, `${operation.op}.observation_ids`)
  }
  if (operation.scopes) parseScopes(operation.scopes, `${operation.op}.scopes`)
  if (operation.claim) {
    validateClaim(operation.claim, inputClassification)
  }

  if (operation.op === 'ADD_CLAIM' && !operation.claim) {
    throw new Error('ADD_CLAIM requires claim')
  }
  if (
    (operation.op === 'MERGE_CLAIMS' || operation.op === 'SUPERSEDE_CLAIM') &&
    (!operation.claim || !operation.claim_ids?.length)
  ) {
    throw new Error(`${operation.op} requires claim and claim_ids`)
  }
  if (operation.op === 'MARK_STALE' && !operation.claim_ids?.length) {
    throw new Error('MARK_STALE requires claim_ids')
  }
  if (operation.op === 'REJECT_OBSERVATION' && !operation.observation_ids?.length) {
    throw new Error('REJECT_OBSERVATION requires observation_ids')
  }
  if (operation.op === 'REQUEST_HUMAN_DECISION' && !operation.reason) {
    throw new Error('REQUEST_HUMAN_DECISION requires reason')
  }
}

function validateClaim(
  claim: ProposedClaim,
  inputClassification: ReturnType<typeof parseClassification>,
): void {
  if (!isRecord(claim)) throw new Error('Resolution claim must be an object')
  if (claim.id !== undefined) requiredId(claim.id, 'claim.id')
  requiredString(claim.title, 'claim.title')
  requiredString(claim.body, 'claim.body')
  const classification = parseClassification(
    claim.classification,
    'claim.classification',
  )
  validateClassificationTransition(inputClassification, classification, 'model')
  parseScopes(claim.scopes, 'claim.scopes')
  requiredString(claim.authority, 'claim.authority')
  confidence(claim.confidence, 'claim.confidence')
}

function renderClaim(
  claim: ProposedClaim,
  proposal: ResolutionProposal,
  claimId: string,
): string {
  const frontmatter = {
    id: claimId,
    type: 'claim',
    title: claim.title,
    classification: claim.classification,
    scope: claim.scopes,
    status: 'active',
    authority: claim.authority,
    confidence: claim.confidence,
    valid_from: claim.valid_from,
    valid_until: claim.valid_until,
    updated_at: proposal.created_at,
    source_refs: proposal.evidence_refs,
    resolution_job: proposal.job_id,
  }
  return `---\n${dumpYaml(frontmatter, {
    noRefs: true,
    lineWidth: 100,
    skipInvalid: true,
  })}---\n\n# ${claim.title}\n\n${claim.body.trim()}\n`
}

function deterministicClaimId(
  jobId: string,
  index: number,
  claim: ProposedClaim,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([
      jobId,
      index,
      {
        title: claim.title,
        body: claim.body,
        classification: claim.classification,
        scopes: claim.scopes,
        authority: claim.authority,
        confidence: claim.confidence,
        valid_from: claim.valid_from,
        valid_until: claim.valid_until,
      },
    ]))
    .digest('hex')
    .slice(0, 24)
  return `claim_${hash}`
}

async function writeImmutable(path: string, content: string): Promise<void> {
  if (await exists(path)) {
    const existing = await readFile(path, 'utf8')
    if (existing !== content) {
      throw new Error(`Immutable Brain artifact already exists with different content: ${path}`)
    }
    return
  }
  await writeFileAtomic(path, content)
}

function relativeProposalPath(proposal: ResolutionProposal): string {
  return `resolutions/proposals/${safeId(proposal.job_id)}/${safeId(proposal.device_id)}.json`
}

function claimIdsFromResolution(resolution: AppliedResolution): string[] {
  return resolution.operations
    .map((operation) => operation.claim?.id)
    .filter((value): value is string => Boolean(value))
}

function claimPathsFromResolution(
  repoRoot: string,
  resolution: AppliedResolution,
): string[] {
  return claimIdsFromResolution(resolution).map((id) =>
    join(repoRoot, 'claims', `${safeId(id)}.md`),
  )
}

function safeId(value: string): string {
  requiredId(value, 'artifact id')
  return value
}

function requiredId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
  ) {
    throw new Error(`${label} must be a safe id`)
  }
}

function requiredString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function stringArray(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    throw new Error(`${label} must be a string array`)
  }
}

function confidence(value: unknown, label: string): void {
  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
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
