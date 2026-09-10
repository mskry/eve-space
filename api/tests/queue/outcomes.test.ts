import { describe, expect, test } from 'vitest'
import {
  decodeAffiliationPlannerOutcome,
  decodeOutboxRelayOutcome,
  encodeAffiliationPlannerOutcome,
  encodeOutboxRelayOutcome,
} from '../../src/queue/outcomes.js'

const recordedAt = '2026-09-10T12:00:00.000Z'

describe('queue outcome codecs', () => {
  test('round trips strict outbox and affiliation outcomes', () => {
    const outbox = { outcome: 'published', category: null, recordedAt } as const
    const affiliation = { outcome: 'scheduled', planned: 2, recordedAt } as const
    expect(decodeOutboxRelayOutcome(encodeOutboxRelayOutcome(outbox))).toEqual(outbox)
    expect(decodeAffiliationPlannerOutcome(encodeAffiliationPlannerOutcome(affiliation))).toEqual(
      affiliation,
    )
  })

  test('rejects malformed JSON, fields, counts, and timestamps', () => {
    expect(decodeOutboxRelayOutcome('{')).toBeNull()
    expect(
      decodeOutboxRelayOutcome(
        JSON.stringify({ outcome: 'published', category: null, recordedAt, extra: true }),
      ),
    ).toBeNull()
    expect(
      decodeAffiliationPlannerOutcome(
        JSON.stringify({ outcome: 'scheduled', planned: -1, recordedAt }),
      ),
    ).toBeNull()
    expect(
      decodeAffiliationPlannerOutcome(
        JSON.stringify({ outcome: 'scheduled', planned: 1, recordedAt: 'invalid' }),
      ),
    ).toBeNull()
  })

  test.each([
    { outcome: 'idle', category: null, recordedAt },
    { outcome: 'paused', category: null, recordedAt },
    { outcome: 'failed', category: 'queue-unavailable', recordedAt },
    { outcome: 'partial-failure', category: 'invalid-event', recordedAt },
  ] as const)('decodes valid relay outcome $outcome', (outcome) => {
    expect(decodeOutboxRelayOutcome(JSON.stringify(outcome))).toEqual(outcome)
  })

  test.each([
    null,
    '[]',
    '"published"',
    JSON.stringify({ outcome: 'unknown', category: null, recordedAt }),
    JSON.stringify({ outcome: 'published', category: 'queue-unavailable', recordedAt }),
    JSON.stringify({ outcome: 'failed', category: null, recordedAt }),
    JSON.stringify({ outcome: 'failed', category: 'secret-host', recordedAt }),
    JSON.stringify({ outcome: 'failed', category: 'unknown', recordedAt: '2026-09-10' }),
  ])('rejects invalid relay representation %#', (value) => {
    expect(decodeOutboxRelayOutcome(value)).toBeNull()
  })

  test.each([
    { outcome: 'idle', planned: 1, recordedAt },
    { outcome: 'cooldown', planned: 1, recordedAt },
    { outcome: 'scheduled', planned: 0, recordedAt },
    { outcome: 'scheduled', planned: 1.5, recordedAt },
    { outcome: 'scheduled', planned: Number.MAX_SAFE_INTEGER + 1, recordedAt },
    { outcome: 'scheduled', planned: 1, recordedAt, secret: 'redis://private-host' },
  ])('rejects invalid affiliation representation %#', (outcome) => {
    expect(decodeAffiliationPlannerOutcome(JSON.stringify(outcome))).toBeNull()
  })

  test('rejects invalid runtime values before encoding', () => {
    expect(() =>
      encodeOutboxRelayOutcome({ outcome: 'published', category: 'unknown', recordedAt } as never),
    ).toThrow('Relay failure outcomes and categories must correspond')
    expect(() =>
      encodeAffiliationPlannerOutcome({ outcome: 'idle', planned: 1, recordedAt } as never),
    ).toThrow('Affiliation outcome and planned count must correspond')
  })
})
