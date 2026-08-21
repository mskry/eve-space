import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EsiResponseMetadata } from '@evespace/esi-client'

const mocks = vi.hoisted(() => ({ getCharacterAccessToken: vi.fn() }))

vi.mock('../src/token-service.js', () => ({
  getCharacterAccessToken: mocks.getCharacterAccessToken,
  ScopeRequiredError: class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  },
}))

import { createCharacterResourceCache, EsiQuotaError } from '../src/esi-cache.js'

const characterId = 1404328063
const scope = 'esi-test.read.v1'

function meta(overrides: Partial<EsiResponseMetadata> = {}): EsiResponseMetadata {
  return { status: 200, headers: {}, ...overrides }
}

function freshMeta(seconds = 300, etag = '"v1"') {
  return meta({ cache: { expires: new Date(Date.now() + seconds * 1000).toUTCString(), etag } })
}

// resolveExpiry falls back to 60s when `expires` is already past, so force expiry via max-age.
function expiredMeta(etag = '"v1"') {
  return meta({ cache: { cacheControl: 'max-age=0', etag } })
}

function esiError(status: number, metadata?: Partial<EsiResponseMetadata>) {
  return Object.assign(new Error(`ESI ${status}`), {
    status,
    metadata: metadata ? meta(metadata) : undefined,
  })
}

beforeEach(() => {
  mocks.getCharacterAccessToken.mockReset()
  mocks.getCharacterAccessToken.mockResolvedValue('access-token')
})

describe('character resource cache', () => {
  test('serves a fresh entry without re-requesting ESI', async () => {
    const load = vi.fn().mockResolvedValue({ data: 42, meta: freshMeta() })
    const cache = createCharacterResourceCache<number>({ scope, load })

    const first = await cache.get(characterId)
    const second = await cache.get(characterId)

    expect(first).toMatchObject({ data: 42, source: 'esi', stale: false })
    expect(second).toMatchObject({ data: 42, source: 'cache', stale: false })
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('de-duplicates concurrent loads for the same character', async () => {
    const load = vi.fn().mockResolvedValue({ data: 7, meta: freshMeta() })
    const cache = createCharacterResourceCache<number>({ scope, load })

    const [a, b] = await Promise.all([cache.get(characterId), cache.get(characterId)])

    expect(a.data).toBe(7)
    expect(b.data).toBe(7)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('revalidates with the stored etag and keeps data on 304', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: 99, meta: expiredMeta('"v1"') })
      .mockRejectedValueOnce(
        esiError(304, { cache: { expires: new Date(Date.now() + 300_000).toUTCString() } }),
      )
    const cache = createCharacterResourceCache<number>({ scope, load })

    await cache.get(characterId)
    const revalidated = await cache.get(characterId)

    expect(revalidated).toMatchObject({ data: 99, source: 'not-modified', stale: false })
    expect(load).toHaveBeenNthCalledWith(2, characterId, 'access-token', {
      ifNoneMatch: '"v1"',
      ifModifiedSince: undefined,
    })
  })

  test('throws a quota error on 429 when nothing is cached', async () => {
    const load = vi.fn().mockRejectedValue(esiError(429, { headers: { 'retry-after': '30' } }))
    const cache = createCharacterResourceCache<number>({ scope, load })

    await expect(cache.get(characterId)).rejects.toBeInstanceOf(EsiQuotaError)
  })

  test('serves stale data instead of failing when a 429 follows a cached read', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: 5, meta: expiredMeta() })
      .mockRejectedValueOnce(esiError(429, { headers: { 'retry-after': '30' } }))
    const cache = createCharacterResourceCache<number>({ scope, load })

    await cache.get(characterId)
    const stale = await cache.get(characterId)

    expect(stale).toMatchObject({ data: 5, source: 'cache', stale: true })
    expect(stale.retryAt).toBeDefined()
  })

  test('requests the access token with the configured scope', async () => {
    const load = vi.fn().mockResolvedValue({ data: 1, meta: freshMeta() })
    const cache = createCharacterResourceCache<number>({ scope, load })

    await cache.get(characterId)

    expect(mocks.getCharacterAccessToken).toHaveBeenCalledWith(characterId, scope)
  })
})
