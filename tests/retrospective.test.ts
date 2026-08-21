import { describe, expect, it } from 'vitest';
import { buildRetrospective } from '../src/core/retrospective.js';
import type { HarnessEvent, HarnessEventType } from '../src/core/types.js';

function event(sequence: number, type: HarnessEventType, payload: Record<string, unknown>): HarnessEvent {
  return {
    schemaVersion: 2,
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    timestamp: `2026-08-21T00:00:0${sequence}.000Z`,
    type,
    traceId: 'trace',
    spanId: `span-${sequence}`,
    payload,
    previousHash: null,
    hash: '0'.repeat(64),
  };
}

describe('buildRetrospective', () => {
  it('groups only evidence-attributed observations by resource', () => {
    const generated = buildRetrospective('run-1', [
      event(1, 'resource.feedback.recorded', { resourceId: 'skill-a', category: 'missing-fact', summary: 'A fact was missing.' }),
      event(2, 'node.failed', { resourceIds: ['skill-a', 'rule-b'], reason: 'The check failed.' }),
      event(3, 'decision.recorded', { resourceId: 'rule-b', result: 'verification_rejected', message: 'Rejected.' }),
      event(4, 'node.succeeded', { resourceId: 'skill-a' }),
    ], {
      'skill-a': { kind: 'skill', digest: 'digest-a' },
      'rule-b': { kind: 'rule', digest: null },
    }, '2026-08-21T00:00:05.000Z');

    expect(generated.retrospective.schemaVersion).toBe(2);
    expect(generated.retrospective.observations).toHaveLength(4);
    expect(generated.proposals).toHaveLength(2);
    expect(generated.proposals.find((proposal) => proposal.resourceId === 'skill-a')).toMatchObject({
      schemaVersion: 2,
      resourceKind: 'skill',
      baseDigest: 'digest-a',
      status: 'proposed',
    });
    expect(generated.proposals.find((proposal) => proposal.resourceId === 'rule-b')?.problem.categories)
      .toEqual(['node.failed', 'verification-rejected']);
  });

  it('stays silent when no event attributes a problem to a resource', () => {
    const generated = buildRetrospective('run-2', [event(1, 'node.succeeded', { resourceId: 'skill-a' })], {}, '2026-08-21T00:00:02.000Z');
    expect(generated.proposals).toEqual([]);
    expect(generated.retrospective.observations).toEqual([]);
  });
});
