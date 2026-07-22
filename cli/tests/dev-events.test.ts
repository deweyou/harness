import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  createDevEvent,
  parseDevEventKind,
  parseDevEventLog,
  parseDevEventPayload,
  renderDevSummary,
  summarizeDevEvents,
  validateDevEventSequence,
} from '../src/cli/dev-events.ts'
import type { DevEventKind } from '../src/cli/types.ts'

describe('DDev event protocol', () => {
  it('validates every event payload kind and preserves optional fields', () => {
    const payloads: Array<[DevEventKind, Record<string, unknown>]> = [
      ['requirement', {
        status: 'confirmation_not_required',
        acceptance_source: 'existing_contract',
        unresolved_decisions: ['Confirm rollout timing.'],
      }],
      ['node', {
        node_id: 'implement',
        node_type: 'implementation',
        status: 'running',
        depends_on: ['design'],
        evidence_ids: ['test-1'],
        input: { files: ['src/main.ts'] },
        output: { changed: true },
      }],
      ['evidence', {
        evidence_id: 'test-1',
        claim_id: 'tests-pass',
        evidence_type: 'command',
        status: 'verified',
        summary: 'Tests passed.',
        command: 'npm test',
        exit_code: 0,
        artifact: 'report.json',
      }],
      ['failure', {
        failure_id: 'failure-1',
        node_id: 'implement',
        failure_class: 'implementation',
        summary: 'Compilation failed.',
        evidence_ids: ['test-1'],
        restart_from: 'implement',
        retryable: false,
      }],
      ['review', {
        review_id: 'review-1',
        scope: 'implementation',
        verdict: 'approved',
        findings: [],
        evidence_ids: ['test-1'],
        restart_from: 'implement',
      }],
      ['recovery', {
        recovery_id: 'recovery-1',
        source_event_id: 'evt-source',
        restart_from: 'implement',
        reason: 'Only implementation is affected.',
        status: 'completed',
      }],
      ['delivery', {
        delivery_id: 'delivery-1',
        status: 'not_requested',
        summary: 'Delivery was not requested.',
        evidence_ids: [],
      }],
    ]

    for (const [kind, payload] of payloads) {
      assert.equal(parseDevEventKind(kind), kind)
      assert.deepEqual(parseDevEventPayload(kind, JSON.stringify(payload)), payload)
    }
  })

  it('rejects malformed kinds, JSON, payloads, enums, and optional fields', () => {
    assert.throws(() => parseDevEventKind(undefined), /missing/)
    assert.throws(() => parseDevEventKind('unknown'), /unknown/)
    assert.throws(() => parseDevEventPayload('node', undefined), /Missing DDev event data/)
    assert.throws(() => parseDevEventPayload('node', '{bad'), /Invalid DDev event data JSON/)
    assert.throws(() => parseDevEventPayload('node', '[]'), /must be a JSON object/)

    const invalid: Array<[DevEventKind, Record<string, unknown>, RegExp]> = [
      ['requirement', { status: 'bad', acceptance_source: 'user' }, /status must be one of/],
      ['requirement', { status: 'confirmed', acceptance_source: 'bad' }, /acceptance_source/],
      ['requirement', { status: 'confirmed', acceptance_source: 'user', unresolved_decisions: [1] }, /unresolved_decisions/],
      ['node', { node_id: '', node_type: 'implementation', status: 'running' }, /node_id/],
      ['node', { node_id: 'n', node_type: 'implementation', status: 'bad' }, /status must be one of/],
      ['node', { node_id: 'n', node_type: 'implementation', status: 'running', depends_on: [1] }, /depends_on/],
      ['node', { node_id: 'n', node_type: 'implementation', status: 'running', evidence_ids: [1] }, /evidence_ids/],
      ['node', { node_id: 'n', node_type: 'implementation', status: 'running', input: [] }, /input/],
      ['node', { node_id: 'n', node_type: 'implementation', status: 'running', output: 'bad' }, /output/],
      ['evidence', { evidence_id: 'e', claim_id: 'c', evidence_type: 'command', status: 'bad', summary: 'x' }, /status must be one of/],
      ['evidence', { evidence_id: 'e', claim_id: 'c', evidence_type: 'command', status: 'verified', summary: 'x', command: 1 }, /command/],
      ['evidence', { evidence_id: 'e', claim_id: 'c', evidence_type: 'command', status: 'verified', summary: 'x', exit_code: '0' }, /exit_code/],
      ['evidence', { evidence_id: 'e', claim_id: 'c', evidence_type: 'command', status: 'verified', summary: 'x', artifact: 1 }, /artifact/],
      ['failure', { failure_id: 'f', node_id: 'n', failure_class: 'environment', summary: 'x', retryable: 'yes' }, /retryable/],
      ['failure', { failure_id: 'f', node_id: 'n', failure_class: 'bad', summary: 'x' }, /failure_class must be one of/],
      ['review', { review_id: 'r', scope: 'code', verdict: 'bad' }, /verdict/],
      ['recovery', { recovery_id: 'r', source_event_id: 'e', restart_from: 'n', reason: 'x', status: 'bad' }, /status must be one of/],
      ['delivery', { delivery_id: 'd', status: 'bad', summary: 'x' }, /status must be one of/],
    ]

    for (const [kind, payload, expected] of invalid) {
      assert.throws(() => parseDevEventPayload(kind, JSON.stringify(payload)), expected)
    }
  })

  it('rejects invalid persisted envelopes and accepts blank log lines', () => {
    assert.deepEqual(parseDevEventLog('\n\r\n'), [])
    assert.throws(() => parseDevEventLog('[]\n'), /event envelope does not match/)
    assert.throws(
      () => parseDevEventLog(JSON.stringify({
        schema_version: 1,
        event_id: 'evt-1',
        occurred_at: '2026-07-21T00:00:00.000Z',
        kind: 'node',
        branch: 'main',
        payload: { node_id: 'n', node_type: 'implementation', status: 'bad' },
      })),
      /status must be one of/,
    )
  })

  it('summarizes latest entity state and renders every empty and open section', () => {
    const at = new Date('2026-07-21T00:00:00.000Z')
    const events = [
      createDevEvent('requirement', 'main', {
        status: 'alignment_required',
        acceptance_source: 'inferred',
        unresolved_decisions: ['Confirm persistence.'],
      }, at),
      createDevEvent('node', 'main', { node_id: 'pending', node_type: 'design', status: 'pending' }, at),
      createDevEvent('node', 'main', { node_id: 'skipped', node_type: 'demo', status: 'skipped' }, at),
      createDevEvent('node', 'main', { node_id: 'blocked', node_type: 'verification', status: 'blocked' }, at),
      createDevEvent('evidence', 'main', {
        evidence_id: 'e-1', claim_id: 'claim-1', evidence_type: 'command', status: 'unverified', summary: 'Not run.',
      }, at),
      createDevEvent('failure', 'main', {
        failure_id: 'failure-no-retry', node_id: 'blocked', failure_class: 'environment', summary: 'Environment unavailable.',
      }, at),
      createDevEvent('review', 'main', { review_id: 'review-change', scope: 'code', verdict: 'changes_requested' }, at),
      createDevEvent('review', 'main', { review_id: 'review-blocked', scope: 'security', verdict: 'blocked' }, at),
      createDevEvent('review', 'main', { review_id: 'review-change', scope: 'code', verdict: 'approved' }, at),
      createDevEvent('recovery', 'main', {
        recovery_id: 'recovery-1', source_event_id: 'evt-source', restart_from: 'blocked', reason: 'Retry verification.', status: 'resumed',
      }, at),
      createDevEvent('delivery', 'main', { delivery_id: 'delivery-1', status: 'pending', summary: 'Awaiting request.' }, at),
    ]

    const summary = summarizeDevEvents('main', events, at)
    const markdown = renderDevSummary(summary)
    const empty = renderDevSummary(summarizeDevEvents('main', [], at))

    assert.equal(summary.reviews.find((review) => review.review_id === 'review-change')?.verdict, 'approved')
    assert.match(summary.open_issues.join('\n'), /Requirement alignment is still required/)
    assert.match(summary.open_issues.join('\n'), /Node `pending` is pending/)
    assert.match(summary.open_issues.join('\n'), /Node `blocked` is blocked/)
    assert.doesNotMatch(summary.open_issues.join('\n'), /skipped/)
    assert.match(summary.open_issues.join('\n'), /Claim `claim-1` is unverified/)
    assert.match(summary.open_issues.join('\n'), /Review `review-blocked` is blocked/)
    assert.match(summary.open_issues.join('\n'), /Recovery `recovery-1` is resumed/)
    assert.match(summary.open_issues.join('\n'), /Delivery `delivery-1` is pending/)
    assert.match(markdown, /Unresolved: Confirm persistence/)
    assert.match(markdown, /## Delivery/)
    assert.match(empty, /No requirement event recorded/)
    assert.match(empty, /No node events recorded/)
    assert.match(empty, /No evidence events recorded/)
    assert.match(empty, /No failure or recovery events recorded/)
    assert.match(empty, /No review events recorded/)
    assert.match(empty, /No delivery events recorded/)
    assert.match(empty, /No events recorded; session evidence is incomplete/)
  })

  it('validates event identity, references, state transitions, and delivery consistency', () => {
    const at = new Date('2026-07-21T00:00:00.000Z')
    const requirement = createDevEvent(
      'requirement',
      'main',
      { status: 'confirmed', acceptance_source: 'user' },
      at,
      'session-1',
    )
    const nodeRunning = createDevEvent(
      'node',
      'main',
      { node_id: 'implement', node_type: 'implementation', status: 'running' },
      at,
      'session-1',
    )
    const evidence = createDevEvent(
      'evidence',
      'main',
      {
        evidence_id: 'test-1',
        claim_id: 'tests-pass',
        evidence_type: 'command',
        status: 'verified',
        summary: 'Tests passed.',
      },
      at,
      'session-1',
    )
    const nodeCompleted = createDevEvent(
      'node',
      'main',
      {
        node_id: 'implement',
        node_type: 'implementation',
        status: 'completed',
        evidence_ids: ['test-1'],
      },
      at,
      'session-1',
    )
    const delivery = createDevEvent(
      'delivery',
      'main',
      {
        delivery_id: 'delivery-1',
        status: 'completed',
        summary: 'Ready.',
        evidence_ids: ['test-1'],
      },
      at,
      'session-1',
    )

    assert.doesNotThrow(() => validateDevEventSequence(
      [requirement, nodeRunning, evidence, nodeCompleted, delivery],
      { expectedBranch: 'main', expectedSessionId: 'session-1' },
    ))
    assert.throws(
      () => validateDevEventSequence([requirement, { ...requirement }]),
      /Duplicate DDev event id/,
    )
    assert.throws(
      () => validateDevEventSequence([nodeCompleted]),
      /Unknown DDev node evidence: test-1/,
    )
    assert.throws(
      () => validateDevEventSequence([nodeRunning, evidence, nodeCompleted, {
        ...nodeRunning,
        event_id: 'evt-regression',
      }]),
      /completed -> running/,
    )
    assert.throws(
      () => validateDevEventSequence([{ ...requirement, occurred_at: 'yesterday' }]),
      /invalid ISO timestamp/,
    )
    assert.throws(
      () => validateDevEventSequence([requirement, nodeRunning, {
        ...delivery,
        payload: { ...delivery.payload, evidence_ids: [] },
      }]),
      /incomplete nodes/,
    )
    assert.throws(
      () => validateDevEventSequence([evidence, delivery]),
      /requires confirmed requirement alignment/,
    )
    const selfReferentialRecovery = createDevEvent(
      'recovery',
      'main',
      {
        recovery_id: 'self-reference',
        source_event_id: 'placeholder',
        restart_from: 'implement',
        reason: 'Invalid self reference.',
        status: 'planned',
      },
      at,
      'session-1',
    )
    selfReferentialRecovery.payload.source_event_id = selfReferentialRecovery.event_id
    assert.throws(
      () => validateDevEventSequence([nodeRunning, selfReferentialRecovery]),
      /Unknown DDev recovery source event/,
    )
  })
})
