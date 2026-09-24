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
    const outbox = { category: null, outcome: 'published', recordedAt } as const
    const affiliation = { outcome: 'scheduled', planned: 2, recordedAt } as const
    expect(decodeOutboxRelayOutcome(encodeOutboxRelayOutcome(outbox))).toStrictEqual(outbox)
    expect(
      decodeAffiliationPlannerOutcome(encodeAffiliationPlannerOutcome(affiliation)),
    ).toStrictEqual(affiliation)
  })

  test('rejects malformed JSON, fields, counts, and timestamps', () => {
    expect(decodeOutboxRelayOutcome('{')).toBeNull()
    expect(
      decodeOutboxRelayOutcome(
        JSON.stringify({ category: null, extra: true, outcome: 'published', recordedAt }),
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
    { category: null, outcome: 'idle', recordedAt },
    { category: null, outcome: 'paused', recordedAt },
    { category: 'queue-unavailable', outcome: 'failed', recordedAt },
    { category: 'invalid-event', outcome: 'partial-failure', recordedAt },
  ] as const)('decodes valid relay outcome $outcome', (outcome) => {
    expect(decodeOutboxRelayOutcome(JSON.stringify(outcome))).toStrictEqual(outcome)
  })

  test.each([
    null,
    '[]',
    '"published"',
    JSON.stringify({ category: null, outcome: 'unknown', recordedAt }),
    JSON.stringify({ category: 'queue-unavailable', outcome: 'published', recordedAt }),
    JSON.stringify({ category: null, outcome: 'failed', recordedAt }),
    JSON.stringify({ category: 'secret-host', outcome: 'failed', recordedAt }),
    JSON.stringify({ category: 'unknown', outcome: 'failed', recordedAt: '2026-09-10' }),
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
      encodeOutboxRelayOutcome({ category: 'unknown', outcome: 'published', recordedAt } as never),
    ).toThrow('Relay failure outcomes and categories must correspond')
    expect(() =>
      encodeAffiliationPlannerOutcome({ outcome: 'idle', planned: 1, recordedAt } as never),
    ).toThrow('Affiliation outcome and planned count must correspond')
  })
})
