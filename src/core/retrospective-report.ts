import type { ResourceProposal, RunProjection, RunRetrospective } from './types.js';

function inline(value: string): string {
  return value.replaceAll('`', '\\`').replaceAll('\n', ' ').trim();
}

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function buildRetrospectiveReport(
  projection: RunProjection,
  retrospective: RunRetrospective,
  proposals: ResourceProposal[],
): string {
  const commitment = projection.activeCommitmentRevision === undefined
    ? undefined
    : projection.commitments[projection.activeCommitmentRevision];
  const plan = projection.activePlanRevision === undefined
    ? undefined
    : projection.plans[projection.activePlanRevision];
  const lines = [
    `# Retrospective: ${inline(commitment?.objective ?? projection.runId)}`,
    '',
    `- Run: \`${projection.runId}\``,
    `- Status: ${projection.status}`,
    `- Commitment: ${projection.activeCommitmentRevision ?? 'none'}`,
    `- Plan: ${projection.activePlanRevision ?? 'none'}`,
    `- Wall time: ${duration(projection.timing.wallTimeMs)}`,
    `- Execution time: ${duration(projection.timing.executionTimeMs)}`,
    `- Retry time: ${duration(projection.timing.retryTimeMs)}`,
    `- Critical path: ${duration(projection.timing.criticalPathMs)}`,
    '',
    '## Acceptance',
    '',
  ];
  const acceptanceClaims = commitment?.acceptanceClaimIds.flatMap((claimId) => {
    const claim = projection.claims[claimId];
    return claim ? [claim] : [];
  }) ?? [];
  lines.push(...(acceptanceClaims.length
    ? acceptanceClaims.map((claim) => `- ${claim.status}: ${inline(claim.description)} (${claim.evidenceIds.length} evidence)`)
    : ['- No acceptance Claims were recorded.']));
  lines.push('', '## Executions', '');
  const executions = plan
    ? projection.nodeExecutions.filter((execution) => execution.planRevision === plan.revision)
    : projection.nodeExecutions;
  lines.push(...(executions.length
    ? executions.map((execution) => `- ${inline(execution.plannedNodeId)} attempt ${execution.attempt}: ${execution.status}, ${duration(execution.durationMs ?? 0)}, ${execution.evidenceIds.length} evidence`)
    : ['- No node executions were recorded.']));
  lines.push('', '## Observations', '');
  lines.push(...(retrospective.observations.length
    ? retrospective.observations.map((observation) => `- ${inline(observation.resourceId)} / ${inline(observation.category)}: ${inline(observation.summary)}`)
    : ['- No evidence-backed resource observations were recorded.']));
  lines.push('', '## Resource Proposals', '');
  lines.push(...(proposals.length
    ? proposals.map((proposal) => `- ${proposal.status}: ${inline(proposal.resourceId)} — ${inline(proposal.problem.summary)}`)
    : ['- No resource changes were proposed.']));
  return `${lines.join('\n')}\n`;
}
