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

describe('system status route', () => {
  test('returns replica-local private telemetry', async () => {
    mocks.getSystemStatus.mockResolvedValue({
      status: 'operational',
      checkedAt: '2026-08-20T12:00:00.000Z',
      cachedUntil: '2026-08-20T12:00:30.000Z',
      services: {
        api: { status: 'operational', uptimeSeconds: 120 },
        database: { status: 'operational', latencyMs: 3 },
        esi: {
          status: 'operational',
          latencyMs: 80,
          checkedAt: '2026-08-20T12:00:00.000Z',
          players: 31_337,
          serverVersion: '2.5.7',
          startedAt: '2026-08-20T11:00:00Z',
          vip: false,
          errorBudgetRemaining: 99,
          errorBudgetResetSeconds: 10,
        },
        queue: {
          status: 'operational',
          workerHeartbeatAt: '2026-08-20T12:00:00.000Z',
          workers: 1,
          depth: 0,
          oldestWaitingAgeSeconds: null,
          active: 0,
          retrying: 0,
          failed: 0,
          memoryUsedBytes: 53_687_091,
          memoryMaxBytes: 536_870_912,
          memoryUsedPercent: 10,
          plannerPaused: false,
          outboxRelayPaused: false,
          latestOutboxRelayOutcome: {
            outcome: 'published',
            category: null,
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
          latestSchedulerOutcome: 'registered',
          latestAffiliationPlannerOutcome: {
            outcome: 'scheduled',
            planned: 2,
            recordedAt: '2026-08-20T12:00:00.000Z',
          },
        },
        eventRelay: {
          status: 'operational',
          pendingCount: 0,
          oldestPendingAgeSeconds: null,
          relayPaused: false,
          latestRelayOutcome: {
            outcome: 'published',
            category: null,
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
        },
        esiResilience: {
          checkedAt: '2026-08-20T12:00:00.000Z',
          cache: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
          coordination: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
          cooldown: {
            status: 'inactive',
            checkedAt: '2026-08-20T12:00:00.000Z',
            globalRetryAt: null,
            activeOperations: [],
          },
          upstream: {
            status: 'operational',
            checkedAt: '2026-08-20T12:00:00.000Z',
            operations: [],
          },
        },
      },
    })

    const response = await client.index.$get()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=15, stale-while-revalidate=30',
    )
    expect(await response.json()).toEqual({
      status: 'operational',
      checkedAt: '2026-08-20T12:00:00.000Z',
      cachedUntil: '2026-08-20T12:00:30.000Z',
      services: {
        api: { status: 'operational', uptimeSeconds: 120 },
        database: { status: 'operational', latencyMs: 3 },
        esi: {
          status: 'operational',
          latencyMs: 80,
          checkedAt: '2026-08-20T12:00:00.000Z',
          players: 31_337,
          serverVersion: '2.5.7',
          startedAt: '2026-08-20T11:00:00Z',
          vip: false,
          errorBudgetRemaining: 99,
          errorBudgetResetSeconds: 10,
        },
        queue: {
          status: 'operational',
          workerHeartbeatAt: '2026-08-20T12:00:00.000Z',
          workers: 1,
          depth: 0,
          oldestWaitingAgeSeconds: null,
          active: 0,
          retrying: 0,
          failed: 0,
          memoryUsedBytes: 53_687_091,
          memoryMaxBytes: 536_870_912,
          memoryUsedPercent: 10,
          plannerPaused: false,
          outboxRelayPaused: false,
          latestOutboxRelayOutcome: {
            outcome: 'published',
            category: null,
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
          latestSchedulerOutcome: 'registered',
          latestAffiliationPlannerOutcome: {
            outcome: 'scheduled',
            planned: 2,
            recordedAt: '2026-08-20T12:00:00.000Z',
          },
        },
        eventRelay: {
          status: 'operational',
          pendingCount: 0,
          oldestPendingAgeSeconds: null,
          relayPaused: false,
          latestRelayOutcome: {
            outcome: 'published',
            category: null,
            recordedAt: '2026-08-20T11:59:58.000Z',
          },
        },
        esiResilience: {
          checkedAt: '2026-08-20T12:00:00.000Z',
          cache: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
          coordination: { status: 'operational', checkedAt: '2026-08-20T12:00:00.000Z' },
          cooldown: {
            status: 'inactive',
            checkedAt: '2026-08-20T12:00:00.000Z',
            globalRetryAt: null,
            activeOperations: [],
          },
          upstream: {
            status: 'operational',
            checkedAt: '2026-08-20T12:00:00.000Z',
            operations: [],
          },
        },
      },
    })
  })

  test.each([
    {
      name: 'lagged',
      eventRelay: {
        status: 'degraded',
        pendingCount: 4,
        oldestPendingAgeSeconds: 301,
        relayPaused: false,
        latestRelayOutcome: null,
      },
    },
    {
      name: 'paused',
      eventRelay: {
        status: 'degraded',
        pendingCount: 1,
        oldestPendingAgeSeconds: 2,
        relayPaused: true,
        latestRelayOutcome: {
          outcome: 'paused',
          category: null,
          recordedAt: '2026-08-20T12:00:00.000Z',
        },
      },
    },
    {
      name: 'unavailable',
      eventRelay: {
        status: 'unavailable',
        pendingCount: 7,
        oldestPendingAgeSeconds: 20,
        relayPaused: false,
        latestRelayOutcome: null,
      },
    },
  ])('preserves the $name event relay DTO', async ({ eventRelay }) => {
    mocks.getSystemStatus.mockResolvedValue({
      status: 'degraded',
      checkedAt: '2026-08-20T12:00:00.000Z',
      cachedUntil: '2026-08-20T12:00:30.000Z',
      services: {
        api: { status: 'operational', uptimeSeconds: 120 },
        database: { status: 'operational', latencyMs: 3 },
        esi: { status: 'operational' },
        queue: { status: 'operational' },
        eventRelay,
      },
    })

    const response = await client.index.$get()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      services: { eventRelay },
    })
  })
})
