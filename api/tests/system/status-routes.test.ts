import { testClient } from 'hono/testing'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
}))

vi.mock('../../src/system/status.js', () => ({
  getSystemStatus: mocks.getSystemStatus,
}))

import { statusRoutes } from '../../src/system/status-routes.js'

const client = testClient(statusRoutes)
const checkedAt = '2026-08-20T12:00:00.000Z'
const esiResilience = {
  cache: { checkedAt, status: 'operational' },
  checkedAt,
  cooldown: {
    activeOperations: [],
    checkedAt,
    globalRetryAt: null,
    status: 'inactive',
  },
  coordination: { checkedAt, status: 'operational' },
  upstream: {
    checkedAt,
    operations: [{ operation: 'status' }],
    status: 'operational',
  },
}

describe('system status route', () => {
  test('returns replica-local private telemetry', async () => {
    mocks.getSystemStatus.mockResolvedValue({
      cachedUntil: '2026-08-20T12:00:30.000Z',
      checkedAt: '2026-08-20T12:00:00.000Z',
      services: {
        api: { status: 'operational', uptimeSeconds: 120 },
        database: { latencyMs: 3, status: 'operational' },
        esi: {
          checkedAt: '2026-08-20T12:00:00.000Z',
          errorBudgetRemaining: 99,
          errorBudgetResetSeconds: 10,
          latencyMs: 80,
          players: 31_337,
          serverVersion: '2.5.7',
          startedAt: '2026-08-20T11:00:00Z',
          status: 'operational',
          vip: false,
        },
        esiResilience,
        eventRelay: {
          latestRelayOutcome: {
            category: null,
            outcome: 'published',
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
          oldestPendingAgeSeconds: null,
          pendingCount: 0,
          relayPaused: false,
          status: 'operational',
        },
        queue: {
          active: 0,
          depth: 0,
          failed: 0,
          latestAffiliationPlannerOutcome: {
            outcome: 'scheduled',
            planned: 2,
            recordedAt: '2026-08-20T12:00:00.000Z',
          },
          latestOutboxRelayOutcome: {
            category: null,
            outcome: 'published',
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
          latestSchedulerOutcome: 'registered',
          memoryMaxBytes: 536_870_912,
          memoryUsedBytes: 53_687_091,
          memoryUsedPercent: 10,
          oldestWaitingAgeSeconds: null,
          outboxRelayPaused: false,
          plannerPaused: false,
          retrying: 0,
          status: 'operational',
          workerHeartbeatAt: '2026-08-20T12:00:00.000Z',
          workers: 1,
        },
        sde: {
          buildNumber: 3_503_375,
          checkedAt: '2026-08-20T12:00:00.000Z',
          ingestVersion: 4,
          ingestedAt: '2026-08-20T11:30:00.000Z',
          latencyMs: 5,
          status: 'operational',
        },
      },
      status: 'operational',
    })

    const response = await client.index.$get()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=15, stale-while-revalidate=30',
    )
    expect(await response.json()).toStrictEqual({
      cachedUntil: '2026-08-20T12:00:30.000Z',
      checkedAt: '2026-08-20T12:00:00.000Z',
      services: {
        api: { status: 'operational', uptimeSeconds: 120 },
        database: { latencyMs: 3, status: 'operational' },
        esi: {
          checkedAt: '2026-08-20T12:00:00.000Z',
          errorBudgetRemaining: 99,
          errorBudgetResetSeconds: 10,
          latencyMs: 80,
          players: 31_337,
          serverVersion: '2.5.7',
          startedAt: '2026-08-20T11:00:00Z',
          status: 'operational',
          vip: false,
        },
        esiResilience: {
          cache: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'operational' },
          checkedAt: '2026-08-20T12:00:00.000Z',
          cooldown: {
            activeOperations: [],
            checkedAt: '2026-08-20T12:00:00.000Z',
            globalRetryAt: null,
            status: 'inactive',
          },
          coordination: { checkedAt: '2026-08-20T12:00:00.000Z', status: 'operational' },
          upstream: {
            checkedAt: '2026-08-20T12:00:00.000Z',
            status: 'operational',
          },
        },
        eventRelay: {
          latestRelayOutcome: {
            category: null,
            outcome: 'published',
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
          oldestPendingAgeSeconds: null,
          pendingCount: 0,
          relayPaused: false,
          status: 'operational',
        },
        queue: {
          active: 0,
          depth: 0,
          failed: 0,
          latestAffiliationPlannerOutcome: {
            outcome: 'scheduled',
            planned: 2,
            recordedAt: '2026-08-20T12:00:00.000Z',
          },
          latestOutboxRelayOutcome: {
            category: null,
            outcome: 'published',
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
          latestSchedulerOutcome: 'registered',
          memoryMaxBytes: 536_870_912,
          memoryUsedBytes: 53_687_091,
          memoryUsedPercent: 10,
          oldestWaitingAgeSeconds: null,
          outboxRelayPaused: false,
          plannerPaused: false,
          retrying: 0,
          status: 'operational',
          workerHeartbeatAt: '2026-08-20T12:00:00.000Z',
          workers: 1,
        },
        sde: {
          buildNumber: 3_503_375,
          checkedAt: '2026-08-20T12:00:00.000Z',
          ingestVersion: 4,
          ingestedAt: '2026-08-20T11:30:00.000Z',
          latencyMs: 5,
          status: 'operational',
        },
      },
      status: 'operational',
    })
  })

  test.each([
    {
      eventRelay: {
        latestRelayOutcome: null,
        oldestPendingAgeSeconds: 301,
        pendingCount: 4,
        relayPaused: false,
        status: 'degraded',
      },
      name: 'lagged',
    },
    {
      eventRelay: {
        latestRelayOutcome: {
          category: null,
          outcome: 'paused',
          recordedAt: '2026-08-20T12:00:00.000Z',
        },
        oldestPendingAgeSeconds: 2,
        pendingCount: 1,
        relayPaused: true,
        status: 'degraded',
      },
      name: 'paused',
    },
    {
      eventRelay: {
        latestRelayOutcome: null,
        oldestPendingAgeSeconds: 20,
        pendingCount: 7,
        relayPaused: false,
        status: 'unavailable',
      },
      name: 'unavailable',
    },
  ])('preserves the $name event relay DTO', async ({ eventRelay }) => {
    mocks.getSystemStatus.mockResolvedValue({
      cachedUntil: '2026-08-20T12:00:30.000Z',
      checkedAt: '2026-08-20T12:00:00.000Z',
      services: {
        api: { status: 'operational', uptimeSeconds: 120 },
        database: { latencyMs: 3, status: 'operational' },
        esi: { status: 'operational' },
        esiResilience,
        eventRelay,
        queue: { status: 'operational' },
      },
      status: 'degraded',
    })

    const response = await client.index.$get()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      services: { eventRelay },
      status: 'degraded',
    })
  })
})
