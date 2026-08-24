import { describe, expect, test, vi } from 'vitest'
import { probeDomainEventStatus } from '../src/domain-event-status.js'

const now = new Date('2026-08-20T12:00:00.000Z')
type RelayFacts = Parameters<typeof probeDomainEventStatus>[0]

describe('domain event status probe', () => {
  test('reports healthy aggregate telemetry without exposing event rows', async () => {
    const aggregateProbe = vi.fn().mockResolvedValue({
      pendingCount: 2,
      oldestPendingAt: new Date('2026-08-20T11:59:00.000Z'),
    })

    await expect(
      probeDomainEventStatus(relayFacts(), aggregateProbe, now.getTime()),
    ).resolves.toEqual({
      status: 'operational',
      pendingCount: 2,
      oldestPendingAgeSeconds: 60,
      relayPaused: false,
      latestRelayOutcome: null,
    })
  })

  test('degrades when the oldest pending event exceeds the lag threshold', async () => {
    const aggregateProbe = vi.fn().mockResolvedValue({
      pendingCount: 1,
      oldestPendingAt: new Date('2026-08-20T11:54:59.000Z'),
    })

    await expect(
      probeDomainEventStatus(relayFacts(), aggregateProbe, now.getTime()),
    ).resolves.toMatchObject({
      status: 'degraded',
      pendingCount: 1,
      oldestPendingAgeSeconds: 301,
    })
  })

  test('reports a queue admission pause and latest sanitized outcome', async () => {
    const latestRelayOutcome = {
      outcome: 'paused' as const,
      category: null,
      recordedAt: now.toISOString(),
    }

    await expect(
      probeDomainEventStatus(
        relayFacts({ outboxRelayPaused: true, latestOutboxRelayOutcome: latestRelayOutcome }),
        vi.fn().mockResolvedValue({ pendingCount: 0, oldestPendingAt: null }),
        now.getTime(),
      ),
    ).resolves.toEqual({
      status: 'degraded',
      pendingCount: 0,
      oldestPendingAgeSeconds: null,
      relayPaused: true,
      latestRelayOutcome,
    })
  })

  test('retains PostgreSQL aggregates when Redis relay facts are unavailable', async () => {
    await expect(
      probeDomainEventStatus(
        relayFacts({ status: 'unavailable' }),
        vi.fn().mockResolvedValue({ pendingCount: 4, oldestPendingAt: now }),
        now.getTime(),
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      pendingCount: 4,
      oldestPendingAgeSeconds: 0,
      relayPaused: false,
      latestRelayOutcome: null,
    })
  })

  test('returns payload-free unavailable telemetry when the aggregate query fails', async () => {
    await expect(
      probeDomainEventStatus(
        relayFacts(),
        vi.fn().mockRejectedValue(new Error('postgres://private-host/events payload')),
        now.getTime(),
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      pendingCount: null,
      oldestPendingAgeSeconds: null,
      relayPaused: false,
      latestRelayOutcome: null,
    })
  })
})

function relayFacts(overrides: Partial<RelayFacts> = {}): RelayFacts {
  return {
    status: 'operational' as const,
    outboxRelayPaused: false,
    latestOutboxRelayOutcome: null,
    ...overrides,
  }
}
