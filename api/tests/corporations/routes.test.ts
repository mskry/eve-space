import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI corporation data is temporarily rate limited')
    }
  }

  return {
    EsiQuotaError,
    getCorporationAllianceHistory: vi.fn(),
    getCorporationPublic: vi.fn(),
    getNpcCorporations: vi.fn(),
  }
})

vi.mock('../../src/corporations/public-data.js', () => ({
  getCorporationAllianceHistory: mocks.getCorporationAllianceHistory,
  getCorporationAllianceHistoryResult: mocks.getCorporationAllianceHistory,
  getCorporationPublic: mocks.getCorporationPublic,
  getCorporationPublicResult: mocks.getCorporationPublic,
  getNpcCorporations: mocks.getNpcCorporations,
}))

vi.mock('../../src/esi-gateway/failures.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))

import { corporationRoutes } from '../../src/corporations/routes.js'

let testTime = new Date('2026-08-22T12:00:00.000Z').getTime()
const metadata = {
  cachedUntil: '2026-08-22T12:01:00.000Z',
  stale: false,
  validatedAt: '2026-08-22T12:00:00.000Z',
}

function request(path: string, address?: string) {
  const environment = address
    ? {
        incoming: {
          socket: { remoteAddress: address, remoteFamily: 'IPv4', remotePort: 1 },
        },
      }
    : undefined
  return corporationRoutes.fetch(new Request(`http://localhost${path}`), environment)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(testTime)
  testTime += 61_000
  mocks.getCorporationPublic.mockReset().mockResolvedValue(result({ corporationId: 1 }))
  mocks.getCorporationAllianceHistory.mockReset().mockResolvedValue(result([]))
  mocks.getNpcCorporations.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('corporation routes', () => {
  test.each([404, 422])(
    'maps ESI %i corporation failures to the typed 404 outcome',
    async (status) => {
      mocks.getCorporationPublic.mockRejectedValue({ status })

      const response = await request('/1')

      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      await expect(response.json()).resolves.toStrictEqual({
        code: 'CORPORATION_NOT_FOUND',
        message: 'Corporation not found.',
      })
    },
  )

  test('returns a typed ESI cooldown before another public request is sent', async () => {
    mocks.getCorporationPublic.mockRejectedValue(new mocks.EsiQuotaError(30))

    const response = await request('/1')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      code: 'ESI_COOLDOWN',
      retryAfterSeconds: 30,
    })
  })

  test('preserves controlled 502 outcomes for transient upstream failures', async () => {
    mocks.getCorporationPublic.mockRejectedValue({ status: 503 })

    const response = await request('/1')

    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toStrictEqual({
      message: 'Corporation data is temporarily unavailable.',
    })
  })

  test('projects stale corporation metadata onto the response root', async () => {
    mocks.getCorporationPublic.mockResolvedValue(
      staleResult({ corporationId: 1, name: 'Retained corporation' }),
    )

    const response = await request('/1')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      corporation: { corporationId: 1, name: 'Retained corporation' },
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-08-22T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-22T11:55:00.000Z',
    })
  })

  test('composes alliance history routes under the corporation router', async () => {
    const history = [{ allianceId: 99, startDate: '2026-01-01T00:00:00Z' }]
    mocks.getCorporationAllianceHistory.mockResolvedValue(result(history))

    const response = await request('/1/alliance-history')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toStrictEqual({
      corporationId: 1,
      history,
      ...metadata,
    })
  })

  test('projects stale alliance-history metadata onto the response root', async () => {
    mocks.getCorporationAllianceHistory.mockResolvedValue(staleResult([]))

    const response = await request('/1/alliance-history')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      corporationId: 1,
      history: [],
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-08-22T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-22T11:55:00.000Z',
    })
  })

  test.each([404, 422])(
    'maps ESI %i alliance history failures to the typed corporation 404 outcome',
    async (status) => {
      mocks.getCorporationAllianceHistory.mockRejectedValue({ status })

      const response = await request('/1/alliance-history')

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toStrictEqual({
        code: 'CORPORATION_NOT_FOUND',
        message: 'Corporation not found.',
      })
    },
  )

  test('preserves the alliance history transient failure message', async () => {
    mocks.getCorporationAllianceHistory.mockRejectedValue({ status: 503 })

    const response = await request('/1/alliance-history')

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toStrictEqual({
      message: 'Alliance history is temporarily unavailable.',
    })
  })

  test('keeps direct peer fixed windows isolated', async () => {
    for (let index = 0; index < 60; index += 1) {
      await request(`/${10_000 + index}`, '198.51.100.10')
    }

    const separatePeerResponse = await request('/90000001', '198.51.100.11')
    expect(separatePeerResponse.status).toBe(200)
    expect(separatePeerResponse.headers.get('cache-control')).toBe('private, no-store')
    await expect(request('/90000002', '198.51.100.10')).resolves.toMatchObject({ status: 429 })
    expect(mocks.getCorporationPublic).toHaveBeenCalledTimes(61)
  })

  test('uses one shared fallback identity and stops calls before route handlers', async () => {
    let response: Response | undefined
    for (let index = 0; index <= 60; index += 1) {
      response = await request(`/${20_000 + index}`)
    }

    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('60')
    expect(response?.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.getCorporationPublic).toHaveBeenCalledTimes(60)
  })

  test('bounds retained direct-peer limit state', async () => {
    for (let index = 0; index <= 1000; index += 1) {
      await request(`/${30_000 + index}`, `198.51.100.${index}`)
    }

    await expect(request('/99999999', '198.51.100.0')).resolves.toMatchObject({ status: 200 })
  })

  test('returns the cooldown response for NPC list requests', async () => {
    mocks.getNpcCorporations.mockRejectedValue(new mocks.EsiQuotaError(15))

    const response = await request('/npc')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('15')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

function result<Data>(data: Data) {
  return { data, quota: {}, source: 'cache' as const, ...metadata }
}

function staleResult<Data>(data: Data) {
  return {
    ...result(data),
    cachedUntil: '2026-08-22T11:56:00.000Z',
    refreshFailureClass: 'esi-unavailable' as const,
    retryAt: '2026-08-22T12:05:00.000Z',
    stale: true,
    validatedAt: '2026-08-22T11:55:00.000Z',
  }
}
