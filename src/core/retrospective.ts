import { createHash } from 'node:crypto';
import type { HarnessEvent, ResourceKind, ResourceProposal, RunRetrospective } from './types.js';

interface ResourceLockEntry {
  kind?: ResourceKind;
  digest?: string | null;
}

function eventResourceIds(event: HarnessEvent): string[] {
  if (typeof event.payload.resourceId === 'string') return [event.payload.resourceId];
  if (Array.isArray(event.payload.resourceIds)) return event.payload.resourceIds.filter((value): value is string => typeof value === 'string');
  return [];
}

function observationCategory(event: HarnessEvent): string | undefined {
  if (event.type === 'resource.feedback.recorded') {
    return typeof event.payload.category === 'string' ? event.payload.category : 'resource-feedback';
  }
  if (['node.failed', 'node.blocked', 'node.interrupted'].includes(event.type)) return event.type;
  if (event.type === 'decision.recorded' && event.payload.result === 'verification_rejected') return 'verification-rejected';
  return undefined;
}

function observationSummary(event: HarnessEvent, category: string): string {
  for (const key of ['summary', 'reason', 'message']) {
    if (typeof event.payload[key] === 'string' && event.payload[key].trim()) return event.payload[key];
  }
  return `Run evidence recorded ${category}.`;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

export function buildRetrospective(
  runId: string,
  events: HarnessEvent[],
  resourceLock: Record<string, ResourceLockEntry>,
  createdAt: string,
): { retrospective: RunRetrospective; proposals: ResourceProposal[] } {
  const observations = events.flatMap((event) => {
    const category = observationCategory(event);
    if (!category) return [];
    return eventResourceIds(event).map((resourceId) => ({
      eventId: event.id,
      resourceId,
      category,
      summary: observationSummary(event, category),
    }));
  });

  const byResource = new Map<string, typeof observations>();
  for (const observation of observations) {
    const grouped = byResource.get(observation.resourceId) ?? [];
    grouped.push(observation);
    byResource.set(observation.resourceId, grouped);
  }
  const proposals = [...byResource].map(([resourceId, resourceObservations]): ResourceProposal => {
    const evidenceEventIds = resourceObservations.map((observation) => observation.eventId);
    const categories = [...new Set(resourceObservations.map((observation) => observation.category))];
    const summaries = [...new Set(resourceObservations.map((observation) => observation.summary))];
    const lock = resourceLock[resourceId];
    return {
      schemaVersion: 2,
      id: stableId('proposal', `${runId}\0${resourceId}\0${evidenceEventIds.join('\0')}`),
      runId,
      resourceId,
      resourceKind: lock?.kind ?? 'unknown',
      baseDigest: lock?.digest ?? null,
      status: 'proposed',
      createdAt,
      evidenceEventIds,
      problem: { categories, summary: summaries.join(' ') },
      suggestion: { summary: `Review '${resourceId}' against the attributed Run evidence and update only the instructions or facts that caused the observed gap.` },
      validation: {
        replayRunIds: [runId],
        acceptance: `Replay the affected cases without equivalent feedback attributed to '${resourceId}'.`,
      },
    };
  });
  const retrospective: RunRetrospective = {
    schemaVersion: 2,
    id: stableId('retro', runId),
    runId,
    createdAt,
    observations,
    proposalIds: proposals.map((proposal) => proposal.id),
  };
  return { retrospective, proposals };
}
