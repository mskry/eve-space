import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createStatusClient: vi.fn(),
  getStatus: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/status', () => ({
  createStatusClient: mocks.createStatusClient,
}))

vi.mock('../src/db/client.js', () => ({
  sql: mocks.sql,
}))

vi.mock('../src/esi-fetch.js', () => ({
  esiFetch: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
  mocks.createStatusClient.mockReturnValue({
    withMetadata: () => ({ get: mocks.getStatus }),
  })
  mocks.sql.mockResolvedValue([{ '?column?': 1 }])
  mocks.getStatus.mockResolvedValue(statusResponse())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('system status service', () => {
  test('collapses concurrent probes and serves fresh cached status', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    mocks.getStatus.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)))
    const { getSystemStatus } = await import('../src/system-status-service.js')

    const first = getSystemStatus()
    const second = getSystemStatus()
    resolveRequest?.(statusResponse())

    await expect(first).resolves.toMatchObject({
      status: 'operational',
      services: {
        api: { status: 'operational' },
        database: { status: 'operational' },
        esi: { status: 'operational', players: 31_337 },
      },
    })
    await expect(second).resolves.toEqual(await first)
    await expect(getSystemStatus()).resolves.toEqual(await first)
    expect(mocks.sql).toHaveBeenCalledOnce()
    expect(mocks.getStatus).toHaveBeenCalledOnce()
  })

  test('reports degraded status for database failure and a low ESI budget', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    mocks.getStatus.mockResolvedValue(statusResponse({ remaining: 10, reset: 20 }))
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'degraded',
      services: {
        database: { status: 'unavailable' },
        esi: {
          status: 'degraded',
          errorBudgetRemaining: 10,
          errorBudgetResetSeconds: 20,
        },
      },
    })
  })

  test('marks previous ESI data stale when a refresh fails', async () => {
    mocks.getStatus
      .mockResolvedValueOnce(statusResponse())
      .mockRejectedValueOnce(new Error('ESI unavailable'))
    const { getSystemStatus } = await import('../src/system-status-service.js')

    const initial = await getSystemStatus()
    await vi.advanceTimersByTimeAsync(30_001)
    const refreshed = await getSystemStatus()

    expect(refreshed).toMatchObject({
      status: 'degraded',
      services: {
        database: { status: 'operational' },
        esi: {
          status: 'stale',
          checkedAt: initial.services.esi.checkedAt,
          players: 31_337,
        },
      },
    })
    expect(mocks.getStatus).toHaveBeenCalledTimes(2)
  })

  test('reports unavailable when database and ESI are both unavailable', async () => {
    mocks.sql.mockRejectedValue(new Error('Database unavailable'))
    mocks.getStatus.mockRejectedValue(new Error('ESI unavailable'))
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'unavailable',
      services: {
        database: { status: 'unavailable' },
        esi: {
          status: 'unavailable',
          players: null,
          errorBudgetRemaining: null,
        },
      },
    })
  })

  test('reports ESI VIP mode as degraded', async () => {
    mocks.getStatus.mockResolvedValue({
      ...statusResponse(),
      data: { ...statusResponse().data, vip: true },
    })
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'degraded',
      services: { esi: { status: 'degraded', vip: true } },
    })
  })

  test('reports zero-player Tranquility downtime as degraded', async () => {
    mocks.getStatus.mockResolvedValue({
      ...statusResponse(),
      data: { ...statusResponse().data, players: 0 },
    })
    const { getSystemStatus } = await import('../src/system-status-service.js')

    await expect(getSystemStatus()).resolves.toMatchObject({
      status: 'degraded',
      services: { esi: { status: 'degraded', players: 0 } },
    })
  })
})

function statusResponse(errorLimit = { remaining: 99, reset: 10 }) {
  return {
    data: {
      players: 31_337,
      server_version: '2.5.7',
      start_time: '2026-08-20T11:00:00Z',
      vip: false,
    },
    meta: {
      status: 200,
      headers: {},
      errorLimit,
    },
  }
}
