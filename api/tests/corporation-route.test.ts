import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CorporationEsiCooldownError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI corporation data is temporarily rate limited')
    }
  }

  return {
    CorporationEsiCooldownError,
    getCorporationAllianceHistory: vi.fn(),
    getCorporationPublic: vi.fn(),
    getNpcCorporations: vi.fn(),
  }
})

vi.mock('../src/corporation-service.js', () => ({
  CorporationEsiCooldownError: mocks.CorporationEsiCooldownError,
  getCorporationAllianceHistory: mocks.getCorporationAllianceHistory,
  getCorporationPublic: mocks.getCorporationPublic,
  getNpcCorporations: mocks.getNpcCorporations,
}))

import { corporationRoutes } from '../src/routes/corporations.js'

let testTime = new Date('2026-08-22T12:00:00.000Z').getTime()

function request(path: string, address?: string) {
  const environment = address
    ? {
        incoming: {
          socket: { remoteAddress: address, remotePort: 1, remoteFamily: 'IPv4' },
        },
      }
    : undefined
  return corporationRoutes.fetch(new Request(`http://localhost${path}`), environment)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(testTime)
  testTime += 61_000
  mocks.getCorporationPublic.mockReset().mockResolvedValue({ corporationId: 1 })
  mocks.getCorporationAllianceHistory.mockReset().mockResolvedValue([])
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
      await expect(response.json()).resolves.toEqual({
        code: 'CORPORATION_NOT_FOUND',
        message: 'Corporation not found.',
      })
    },
  )

  test('returns a typed ESI cooldown before another public request is sent', async () => {
    mocks.getCorporationPublic.mockRejectedValue(new mocks.CorporationEsiCooldownError(30))

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
    await expect(response.json()).resolves.toEqual({
      message: 'Corporation data is temporarily unavailable.',
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
    for (let index = 0; index <= 1_000; index += 1) {
      await request(`/${30_000 + index}`, `198.51.100.${index}`)
    }

    await expect(request('/99999999', '198.51.100.0')).resolves.toMatchObject({ status: 200 })
  })

  test('returns the cooldown response for NPC list requests', async () => {
    mocks.getNpcCorporations.mockRejectedValue(new mocks.CorporationEsiCooldownError(15))

    const response = await request('/npc')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('15')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
