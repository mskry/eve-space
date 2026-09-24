import { describe, expect, test } from 'vitest'
import {
  parseExpectedRecoverySnapshot,
  verifyQueueDiscardRecovery,
  verifyRollbackJobContracts,
  type DomainEventRecoverySnapshot,
} from '../../src/worker/rollback-verifier.js'
import { listJobContracts } from '../../src/queue/job-contracts.js'

const snapshot: DomainEventRecoverySnapshot = {
  earliestPublishedAt: '2026-08-01T00:00:00.000Z',
  eventCount: 3,
  latestPublishedAt: '2026-08-02T00:00:00.000Z',
  publishedCount: 2,
  unpublishedCount: 1,
}

describe('worker rollback verifier', () => {
  test('counts authoritative contracts only after contract verification', () => {
    expect(verifyRollbackJobContracts(listJobContracts())).toStrictEqual({ authoritativeCount: 1 })
  })

  test('parses a retained snapshot and rejects malformed verifier input', () => {
    expect(parseExpectedRecoverySnapshot([])).toBeUndefined()
    expect(
      parseExpectedRecoverySnapshot(['--expected-snapshot', JSON.stringify(snapshot)]),
    ).toStrictEqual(snapshot)
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
          earliestPublishedAt: null,
          eventCount: 0,
          latestPublishedAt: null,
          publishedCount: 0,
          unpublishedCount: 0,
        },
      }),
    ).toThrow('at least one retained')
  })

  test('proves PostgreSQL recovery remained unchanged across queue discard', () => {
    expect(
      verifyQueueDiscardRecovery({ confirmation: '1', expectedSnapshot: snapshot, snapshot }),
    ).toStrictEqual(snapshot)
    expect(() =>
      verifyQueueDiscardRecovery({
        confirmation: '1',
        expectedSnapshot: snapshot,
        snapshot: { ...snapshot, publishedCount: 1, unpublishedCount: 2 },
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
