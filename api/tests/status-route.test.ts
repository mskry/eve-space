import { testClient } from 'hono/testing'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSystemStatus: vi.fn(),
}))

vi.mock('../src/system-status-service.js', () => ({
  getSystemStatus: mocks.getSystemStatus,
}))

import { statusRoutes } from '../src/routes/status.js'

const client = testClient(statusRoutes)

describe('system status route', () => {
  test('returns cached public telemetry', async () => {
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
      },
    })

    const response = await client.index.$get()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=15, stale-while-revalidate=30',
    )
    expect(await response.json()).toMatchObject({
      status: 'operational',
      services: { esi: { players: 31_337 } },
    })
  })
})
