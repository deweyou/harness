import { invariant } from './errors.js';
import { validatePlanGraph } from './graph.js';
import type { Claim, Commitment, Evidence, NodeExecution, Plan, Run } from './types.js';

function assertPositiveRevision(value: number, label: string): void {
  invariant(Number.isInteger(value) && value > 0, 'INVALID_REVISION', `${label} must be a positive integer`);
}

export function assertCommitmentRevision(run: Run, commitment: Commitment, previous?: Commitment): void {
  invariant(commitment.runId === run.id, 'RUN_SCOPE_MISMATCH', `Commitment '${commitment.id}' belongs to another Run`);
  invariant(commitment.id.length > 0, 'INVALID_COMMITMENT', 'Commitment id cannot be empty');
  invariant(commitment.objective.trim().length > 0, 'INVALID_COMMITMENT', `Commitment '${commitment.id}' must have an objective`);
  invariant(commitment.destination.trim().length > 0, 'INVALID_COMMITMENT', `Commitment '${commitment.id}' must have a destination`);
  invariant(commitment.acceptanceClaimIds.length > 0, 'EMPTY_ACCEPTANCE', `Commitment '${commitment.id}' must require at least one Claim`);
  invariant(
    new Set(commitment.acceptanceClaimIds).size === commitment.acceptanceClaimIds.length,
    'DUPLICATE_ACCEPTANCE_CLAIM',
    `Commitment '${commitment.id}' repeats an acceptance Claim`,
  );
  assertPositiveRevision(commitment.revision, `Commitment '${commitment.id}' revision`);
  if (!previous) {
    invariant(commitment.revision === 1, 'INVALID_COMMITMENT_REVISION', 'The first Commitment revision must be 1');
    invariant(commitment.supersedesRevision === undefined, 'INVALID_COMMITMENT_LINEAGE', 'The first Commitment cannot supersede another Commitment');
    return;
  }
  invariant(previous.runId === run.id, 'RUN_SCOPE_MISMATCH', `Previous Commitment '${previous.id}' belongs to another Run`);
  invariant(commitment.revision === previous.revision + 1, 'INVALID_COMMITMENT_REVISION', 'Commitment revisions must be contiguous');
  invariant(commitment.supersedesRevision === previous.revision, 'INVALID_COMMITMENT_LINEAGE', `Commitment '${commitment.id}' must supersede revision ${previous.revision}`);
}

export function assertPlanRevision(run: Run, commitment: Commitment, plan: Plan, previous?: Plan): void {
  invariant(plan.runId === run.id, 'RUN_SCOPE_MISMATCH', `Plan '${plan.id}' belongs to another Run`);
  invariant(commitment.runId === run.id, 'RUN_SCOPE_MISMATCH', `Commitment '${commitment.id}' belongs to another Run`);
  invariant(plan.commitmentRevision === commitment.revision, 'COMMITMENT_SCOPE_MISMATCH', `Plan '${plan.id}' targets a different Commitment revision`);
  invariant(plan.status === 'proposed', 'INVALID_PLAN_STATUS', `New Plan '${plan.id}' must be proposed`);
  invariant(plan.id.length > 0, 'INVALID_PLAN', 'Plan id cannot be empty');
  assertPositiveRevision(plan.revision, `Plan '${plan.id}' revision`);
  if (!previous) {
    invariant(plan.revision === 1, 'INVALID_PLAN_REVISION', 'The first Plan revision must be 1');
  } else {
    invariant(previous.runId === run.id, 'RUN_SCOPE_MISMATCH', `Previous Plan '${previous.id}' belongs to another Run`);
    invariant(plan.revision === previous.revision + 1, 'INVALID_PLAN_REVISION', 'Plan revisions must be contiguous within a Run');
  }
  validatePlanGraph(plan);
}

export function assertNodeExecution(plan: Plan, execution: NodeExecution, previousAttempts: readonly NodeExecution[]): void {
  invariant(execution.runId === plan.runId, 'RUN_SCOPE_MISMATCH', `Node execution '${execution.id}' belongs to another Run`);
  invariant(execution.planRevision === plan.revision, 'PLAN_SCOPE_MISMATCH', `Node execution '${execution.id}' belongs to another Plan revision`);
  invariant(plan.nodes.some((node) => node.id === execution.plannedNodeId), 'UNKNOWN_PLANNED_NODE', `Unknown planned node '${execution.plannedNodeId}'`);
  assertPositiveRevision(execution.attempt, `Node execution '${execution.id}' attempt`);
  const matchingAttempts = previousAttempts
    .filter(
      (candidate) =>
        candidate.runId === execution.runId &&
        candidate.planRevision === execution.planRevision &&
        candidate.plannedNodeId === execution.plannedNodeId,
    )
    .map((candidate) => candidate.attempt);
  invariant(!matchingAttempts.includes(execution.attempt), 'DUPLICATE_NODE_ATTEMPT', `Node '${execution.plannedNodeId}' already has attempt ${execution.attempt}`);
  const expectedAttempt = matchingAttempts.length === 0 ? 1 : Math.max(...matchingAttempts) + 1;
  invariant(execution.attempt === expectedAttempt, 'NON_CONTIGUOUS_NODE_ATTEMPT', `Node '${execution.plannedNodeId}' expected attempt ${expectedAttempt}`);
}

export function isCommitmentAccepted(
  commitment: Commitment,
  claims: Readonly<Record<string, Claim>>,
  evidence: Readonly<Record<string, Evidence>>,
): boolean {
  if (commitment.acceptanceClaimIds.length === 0 || commitment.unresolvedDecisions.length > 0) return false;
  return commitment.acceptanceClaimIds.every((claimId) => {
    const claim = claims[claimId];
    if (!claim || claim.runId !== commitment.runId || claim.commitmentId !== commitment.id || !['satisfied', 'waived'].includes(claim.status)) return false;
    return claim.evidenceIds.length > 0 && claim.evidenceIds.every((evidenceId) => {
      const item = evidence[evidenceId];
      return item?.runId === commitment.runId && item.commitmentRevision === commitment.revision;
    });
  });
}

export function assertClaimDecision(
  commitment: Commitment,
  claim: Claim,
  evidence: Readonly<Record<string, Evidence>>,
): void {
  invariant(claim.runId === commitment.runId, 'RUN_SCOPE_MISMATCH', `Claim '${claim.id}' belongs to another Run`);
  invariant(claim.commitmentId === commitment.id, 'COMMITMENT_SCOPE_MISMATCH', `Claim '${claim.id}' belongs to another Commitment`);
  if (claim.status !== 'satisfied' && claim.status !== 'waived') return;
  invariant(claim.evidenceIds.length > 0, 'CLAIM_WITHOUT_EVIDENCE', `Closed Claim '${claim.id}' requires Evidence`);
  for (const evidenceId of claim.evidenceIds) {
    const item = evidence[evidenceId];
    invariant(item, 'MISSING_EVIDENCE', `Claim '${claim.id}' refers to missing Evidence '${evidenceId}'`);
    invariant(item.runId === commitment.runId, 'RUN_SCOPE_MISMATCH', `Evidence '${evidenceId}' belongs to another Run`);
    invariant(item.commitmentRevision === commitment.revision, 'STALE_EVIDENCE', `Evidence '${evidenceId}' targets Commitment revision ${item.commitmentRevision}`);
  }
}
