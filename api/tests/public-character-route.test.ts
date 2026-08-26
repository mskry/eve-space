import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI character data is temporarily rate limited')
    }
  }

  return {
    EsiQuotaError,
    getCharacterProfile: vi.fn(),
  }
})

vi.mock('../src/character-profile.js', () => ({
  getCharacterProfile: mocks.getCharacterProfile,
}))

vi.mock('../src/esi-resilience/cooldowns.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))

import { publicCharacterRoutes } from '../src/routes/public-characters.js'

let testTime = new Date('2026-08-26T12:00:00.000Z').getTime()

function request(path: string, address?: string) {
  const environment = address
    ? {
        incoming: {
          socket: { remoteAddress: address, remotePort: 1, remoteFamily: 'IPv4' },
        },
      }
    : undefined
  return publicCharacterRoutes.fetch(new Request(`http://localhost${path}`), environment)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(testTime)
  testTime += 61_000
  mocks.getCharacterProfile.mockReset().mockResolvedValue({ id: 90_000_001, name: 'Capsuleer' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('public character routes', () => {
  test('returns the public character profile with private response headers', async () => {
    const response = await request('/90000001')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
    expect(mocks.getCharacterProfile).toHaveBeenCalledWith(90_000_001)
    await expect(response.json()).resolves.toEqual({
      profile: { id: 90_000_001, name: 'Capsuleer' },
    })
  })

  test.each(['not-a-number', '0', '-1', '1.5', '2147483648'])(
    'rejects invalid character ID %s before loading a profile',
    async (characterId) => {
      const response = await request(`/${characterId}`)

      expect(response.status).toBe(400)
      expect(mocks.getCharacterProfile).not.toHaveBeenCalled()
    },
  )

  test.each([404, 422])(
    'maps ESI %i character failures to the typed 404 outcome',
    async (status) => {
      mocks.getCharacterProfile.mockRejectedValue({ status })

      const response = await request('/90000001')

      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      await expect(response.json()).resolves.toEqual({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      })
    },
  )

  test('returns a typed ESI cooldown before another public request is sent', async () => {
    mocks.getCharacterProfile.mockRejectedValue(new mocks.EsiQuotaError(30))

    const response = await request('/90000001')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_COOLDOWN',
      message: 'Character data is temporarily rate limited by ESI.',
      retryAfterSeconds: 30,
    })
  })

  test('preserves controlled 502 outcomes for transient upstream failures', async () => {
    mocks.getCharacterProfile.mockRejectedValue(new Error('upstream details'))

    const response = await request('/90000001')

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      message: 'Character data is temporarily unavailable.',
    })
  })

  test('keeps direct peer fixed windows isolated', async () => {
    for (let index = 0; index < 60; index += 1) {
      await request(`/${90_000_000 + index}`, '198.51.100.10')
    }

    await expect(request('/90000100', '198.51.100.11')).resolves.toMatchObject({ status: 200 })
    await expect(request('/90000101', '198.51.100.10')).resolves.toMatchObject({ status: 429 })
    expect(mocks.getCharacterProfile).toHaveBeenCalledTimes(61)
  })

  test('uses one shared fallback identity and stops calls before route handlers', async () => {
    let response: Response | undefined
    for (let index = 0; index <= 60; index += 1) {
      response = await request(`/${90_001_000 + index}`)
    }

    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('60')
    expect(mocks.getCharacterProfile).toHaveBeenCalledTimes(60)
  })

  test('bounds retained direct-peer limit state', async () => {
    for (let index = 0; index <= 1_000; index += 1) {
      await request(`/${90_100_000 + index}`, `198.51.100.${index}`)
    }

    await expect(request('/99999999', '198.51.100.0')).resolves.toMatchObject({ status: 200 })
  })
})
