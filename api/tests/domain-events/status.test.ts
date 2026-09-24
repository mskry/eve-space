import { describe, expect, test, vi } from 'vitest'
import { probeDomainEventStatus } from '../../src/domain-events/status.js'

const now = new Date('2026-08-20T12:00:00.000Z')
type RelayFacts = Parameters<typeof probeDomainEventStatus>[0]

describe('domain event status probe', () => {
  test('reports healthy aggregate telemetry without exposing event rows', async () => {
    const aggregateProbe = vi.fn().mockResolvedValue({
      oldestPendingAt: new Date('2026-08-20T11:59:00.000Z'),
      pendingCount: 2,
    })

    await expect(
      probeDomainEventStatus(relayFacts(), aggregateProbe, now.getTime()),
    ).resolves.toStrictEqual({
      latestRelayOutcome: null,
      oldestPendingAgeSeconds: 60,
      pendingCount: 2,
      relayPaused: false,
      status: 'operational',
    })
  })

  test('degrades when the oldest pending event exceeds the lag threshold', async () => {
    const aggregateProbe = vi.fn().mockResolvedValue({
      oldestPendingAt: new Date('2026-08-20T11:54:59.000Z'),
      pendingCount: 1,
    })

    await expect(
      probeDomainEventStatus(relayFacts(), aggregateProbe, now.getTime()),
    ).resolves.toMatchObject({
      oldestPendingAgeSeconds: 301,
      pendingCount: 1,
      status: 'degraded',
    })
  })

  test('reports a queue admission pause and latest sanitized outcome', async () => {
    const latestRelayOutcome = {
      category: null,
      outcome: 'paused' as const,
      recordedAt: now.toISOString(),
    }

    await expect(
      probeDomainEventStatus(
        relayFacts({ latestOutboxRelayOutcome: latestRelayOutcome, outboxRelayPaused: true }),
        vi.fn().mockResolvedValue({ oldestPendingAt: null, pendingCount: 0 }),
        now.getTime(),
      ),
    ).resolves.toStrictEqual({
      latestRelayOutcome,
      oldestPendingAgeSeconds: null,
      pendingCount: 0,
      relayPaused: true,
      status: 'degraded',
    })
  })

  test('retains PostgreSQL aggregates when Redis relay facts are unavailable', async () => {
    await expect(
      probeDomainEventStatus(
        relayFacts({ status: 'unavailable' }),
        vi.fn().mockResolvedValue({ oldestPendingAt: now, pendingCount: 4 }),
        now.getTime(),
      ),
    ).resolves.toStrictEqual({
      latestRelayOutcome: null,
      oldestPendingAgeSeconds: 0,
      pendingCount: 4,
      relayPaused: false,
      status: 'unavailable',
    })
  })

  test('returns payload-free unavailable telemetry when the aggregate query fails', async () => {
    await expect(
      probeDomainEventStatus(
        relayFacts(),
        vi.fn().mockRejectedValue(new Error('postgres://private-host/events payload')),
        now.getTime(),
      ),
    ).resolves.toStrictEqual({
      latestRelayOutcome: null,
      oldestPendingAgeSeconds: null,
      pendingCount: null,
      relayPaused: false,
      status: 'unavailable',
    })
  })
})

function relayFacts(overrides: Partial<RelayFacts> = {}): RelayFacts {
  return {
    latestOutboxRelayOutcome: null,
    outboxRelayPaused: false,
    status: 'operational' as const,
    ...overrides,
  }
}
