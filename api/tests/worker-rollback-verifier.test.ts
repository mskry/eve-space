import { describe, expect, test } from 'vitest'
import {
  parseExpectedRecoverySnapshot,
  verifyQueueDiscardRecovery,
  verifyRollbackJobRegistry,
  type DomainEventRecoverySnapshot,
} from '../src/worker-rollback-verifier.js'

const snapshot: DomainEventRecoverySnapshot = {
  eventCount: 3,
  publishedCount: 2,
  unpublishedCount: 1,
  earliestPublishedAt: '2026-08-01T00:00:00.000Z',
  latestPublishedAt: '2026-08-02T00:00:00.000Z',
}

describe('worker rollback verifier', () => {
  test('permits authoritative jobs only when registry verification confirms outbox recovery', () => {
    expect(
      verifyRollbackJobRegistry([
        { name: 'derived', durability: 'derived' },
        { name: 'event', durability: 'authoritative', recovery: 'outbox' },
      ]),
    ).toEqual({ authoritativeCount: 1 })
    expect(() =>
      verifyRollbackJobRegistry([{ name: 'event', durability: 'authoritative' } as never]),
    ).toThrow('requires outbox recovery')
    expect(() => verifyRollbackJobRegistry([{ name: 'unclassified' }])).toThrow('must declare')
  })

  test('parses a retained snapshot and rejects malformed verifier input', () => {
    expect(parseExpectedRecoverySnapshot([])).toBeUndefined()
    expect(
      parseExpectedRecoverySnapshot(['--expected-snapshot', JSON.stringify(snapshot)]),
    ).toEqual(snapshot)
    expect(() => parseExpectedRecoverySnapshot(['--other', '{}'])).toThrow('Expected only')
    expect(() => parseExpectedRecoverySnapshot(['--expected-snapshot', '{'])).toThrow('valid JSON')
    expect(() =>
      parseExpectedRecoverySnapshot([
        '--expected-snapshot',
        JSON.stringify({ ...snapshot, eventCount: -1 }),
      ]),
    ).toThrow('eventCount')
    expect(() =>
      parseExpectedRecoverySnapshot([
        '--expected-snapshot',
        JSON.stringify({ ...snapshot, earliestPublishedAt: null }),
      ]),
    ).toThrow('publication range')
  })

  test('requires explicit confirmation and retained PostgreSQL events', () => {
    expect(() => verifyQueueDiscardRecovery({ confirmation: undefined, snapshot })).toThrow(
      'must be 1',
    )
    expect(() =>
      verifyQueueDiscardRecovery({
        confirmation: '1',
        snapshot: {
          eventCount: 0,
          publishedCount: 0,
          unpublishedCount: 0,
          earliestPublishedAt: null,
          latestPublishedAt: null,
        },
      }),
    ).toThrow('at least one retained')
  })

  test('proves PostgreSQL recovery remained unchanged across queue discard', () => {
    expect(
      verifyQueueDiscardRecovery({ confirmation: '1', snapshot, expectedSnapshot: snapshot }),
    ).toEqual(snapshot)
    expect(() =>
      verifyQueueDiscardRecovery({
        confirmation: '1',
        snapshot: { ...snapshot, publishedCount: 1, unpublishedCount: 2 },
        expectedSnapshot: snapshot,
      }),
    ).toThrow('changed during queue discard')
    expect(() =>
      verifyQueueDiscardRecovery({
        confirmation: '1',
        snapshot: { ...snapshot, unpublishedCount: 0 },
      }),
    ).toThrow('counts are inconsistent')
  })
})
