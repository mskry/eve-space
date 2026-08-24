import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  commit: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  initialize: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
}))

vi.mock('../src/esi-resilience/coordination.js', () => ({
  acquireEsiRequestLease: mocks.acquire,
  commitEsiFence: mocks.commit,
  getCommittedEsiFence: mocks.getCommitted,
  getEsiRequestLeaseTtl: mocks.getLeaseTtl,
  initializeCacheNamespace: mocks.initialize,
  releaseEsiRequestLease: mocks.release,
  renewEsiRequestLease: mocks.renew,
}))

import { EsiQuotaError } from '../src/esi-resilience/cooldowns.js'
import { EsiResilienceLayer } from '../src/esi-resilience/resilience.js'

const now = Date.parse('2026-08-20T12:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }

describe('ESI resilience layer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.acquire.mockResolvedValue(lease)
    mocks.commit.mockResolvedValue(true)
    mocks.getCommitted.mockResolvedValue(undefined)
    mocks.getLeaseTtl.mockResolvedValue(0)
    mocks.initialize.mockResolvedValue(1)
    mocks.release.mockResolvedValue(true)
    mocks.renew.mockResolvedValue(true)
  })

  test('serves a fresh L1 value without another upstream request', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'Bandera' }))
    const resource = {
      operation: 'public-character' as const,
      resource: 'character-90000001',
      load,
    }

    await expect(layer.get(resource)).resolves.toMatchObject({ source: 'esi', stale: false })
    await expect(layer.get(resource)).resolves.toMatchObject({
      data: { name: 'Bandera' },
      source: 'cache',
    })
    expect(load).toHaveBeenCalledOnce()
    expect(cache.set).toHaveBeenCalledOnce()
  })

  test('renews a long-running owner lease and releases it after publication', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    let finish: ((value: ReturnType<typeof result>) => void) | undefined
    const load = vi.fn(
      () =>
        new Promise<ReturnType<typeof result>>((resolve) => {
          finish = resolve
        }),
    )
    const pending = layer.get({
      operation: 'public-character',
      resource: 'character-90000001',
      load,
    })

    await vi.advanceTimersByTimeAsync(7_500)
    expect(mocks.renew).toHaveBeenCalledWith(expect.anything(), lease)
    finish?.(result({ name: 'Bandera' }))
    await pending
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), lease)
  })

  test('revalidates expired data and preserves its DTO after a 304', async () => {
    const cache = redis()
    const envelope = serializedEnvelope({
      freshUntil: now - 1,
      retainUntil: now + 60_000,
      fence: 7,
    })
    cache.get.mockResolvedValue(envelope)
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const notModified = Object.assign(new Error('Not modified'), {
      status: 304,
      metadata: { status: 304, headers: {}, cache: { cacheControl: 'max-age=30' } },
    })
    const load = vi.fn().mockRejectedValue(notModified)

    await expect(
      layer.get({ operation: 'public-character', resource: 'character-90000001', load }),
    ).resolves.toMatchObject({ data: { name: 'cached' }, source: 'not-modified', stale: false })
    expect(load).toHaveBeenCalledWith({ ifNoneMatch: '"etag"', ifModifiedSince: 'yesterday' })
  })

  test('rejects obsolete envelope versions before a stale DTO can be read', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(serializedEnvelope({ version: 0, fence: 7 }))
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'replacement' }))

    await expect(
      layer.get({ operation: 'public-character', resource: 'character-90000001', load }),
    ).resolves.toMatchObject({ data: { name: 'replacement' }, source: 'esi' })
  })

  test('serves only policy-permitted retained stale data during a cooldown', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(
      serializedEnvelope({ freshUntil: now - 1, retainUntil: now + 60_000, fence: 7 }),
    )
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockRejectedValue(new EsiQuotaError(15))

    await expect(
      layer.get({ operation: 'public-character', resource: 'character-90000001', load }),
    ).resolves.toMatchObject({ data: { name: 'cached' }, source: 'cache', stale: true })
  })

  test('retains a private entry for conditional revalidation without serving it stale', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(
      serializedEnvelope({ freshUntil: now - 1, retainUntil: now + 60_000, fence: 7 }),
    )
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockRejectedValue(new EsiQuotaError(15))

    await expect(
      layer.get({ operation: 'wallet-balance', resource: 'wallet-balance-character-1', load }),
    ).rejects.toEqual(new EsiQuotaError(15))
    expect(load).toHaveBeenCalledWith({ ifNoneMatch: '"etag"', ifModifiedSince: 'yesterday' })
  })

  test('initializes the cache namespace once while both Redis dependencies remain healthy', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'cached' }))

    await layer.get({ operation: 'public-character', resource: 'character-1', load })
    await layer.get({ operation: 'public-character', resource: 'character-2', load })
    expect(mocks.initialize).toHaveBeenCalledOnce()
  })

  test('waits against the owner lease TTL before attempting a follower takeover', async () => {
    const cache = redis()
    mocks.acquire.mockResolvedValueOnce(undefined).mockResolvedValue(lease)
    mocks.getLeaseTtl.mockResolvedValue(0)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'replacement' }))

    await expect(
      layer.get({ operation: 'public-character', resource: 'character-90000001', load }),
    ).resolves.toMatchObject({ source: 'esi' })
    expect(mocks.getLeaseTtl).toHaveBeenCalled()
    expect(mocks.acquire).toHaveBeenCalledTimes(2)
  })

  test('does not cache a no-value operation while still loading it', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result([{ character_id: 90_000_001 }]))

    await expect(
      layer.get({ operation: 'bulk-affiliation', resource: 'affiliations-1', load }),
    ).resolves.toMatchObject({ source: 'esi' })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  test('does not pass validators for a non-revalidating operation', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result([{ character_id: 90_000_001 }]))

    await layer.get({ operation: 'bulk-affiliation', resource: 'affiliations-2', load })
    expect(load).toHaveBeenCalledWith({})
  })

  test('uses L1 or a controlled reload when cache or coordination is unavailable', async () => {
    const cache = redis()
    cache.ping.mockRejectedValue(new Error('cache unavailable'))
    const coordination = redis()
    const layer = new EsiResilienceLayer(cache as never, coordination as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'fallback' }))

    await expect(
      layer.get({ operation: 'public-character', resource: 'character-90000001', load }),
    ).resolves.toMatchObject({ data: { name: 'fallback' } })
    expect(mocks.acquire).toHaveBeenCalled()

    cache.ping.mockResolvedValue('PONG')
    mocks.initialize.mockRejectedValueOnce(new Error('coordination unavailable'))
    await expect(
      layer.get({ operation: 'public-character', resource: 'character-90000002', load }),
    ).resolves.toMatchObject({ data: { name: 'fallback' } })
  })
})

function redis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    ping: vi.fn().mockResolvedValue('PONG'),
    set: vi.fn().mockResolvedValue('OK'),
  }
}

function result<Data>(data: Data) {
  return { data, meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=60' } } }
}

function serializedEnvelope(overrides: Partial<Record<string, unknown>>) {
  return JSON.stringify({
    version: 1,
    data: { name: 'cached' },
    freshUntil: now + 60_000,
    retainUntil: now + 60_000,
    validatedAt: new Date(now).toISOString(),
    etag: '"etag"',
    lastModified: 'yesterday',
    quota: {},
    fence: 7,
    ...overrides,
  })
}
