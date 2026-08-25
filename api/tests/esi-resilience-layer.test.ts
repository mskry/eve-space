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
    mocks.initialize.mockResolvedValue('namespace-one')
    mocks.release.mockResolvedValue(true)
    mocks.renew.mockResolvedValue(true)
  })

  test('serves a fresh L1 value without another upstream request', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'Bandera' }))
    const resource = {
      operation: 'public-corporation' as const,
      inputs: { corporationId: 90_000_001 },
      load,
    }

    await expect(layer.getPublic(resource)).resolves.toMatchObject({ source: 'esi', stale: false })
    await expect(layer.getPublic(resource)).resolves.toMatchObject({
      data: { name: 'Bandera' },
      source: 'cache',
    })
    expect(load).toHaveBeenCalledOnce()
    expect(cache.set).toHaveBeenCalledOnce()
    expect(cache.ping).not.toHaveBeenCalled()
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
    const pending = layer.getPublic({
      operation: 'public-corporation',
      inputs: { corporationId: 90_000_001 },
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
      fence: 6,
    })
    cache.get.mockResolvedValue(envelope)
    mocks.getCommitted.mockResolvedValue(6)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const notModified = Object.assign(new Error('Not modified'), {
      status: 304,
      metadata: { status: 304, headers: {}, cache: { cacheControl: 'max-age=30' } },
    })
    const load = vi.fn().mockRejectedValue(notModified)

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ data: { name: 'cached' }, source: 'not-modified', stale: false })
    expect(load).toHaveBeenCalledWith({ ifNoneMatch: '"etag"', ifModifiedSince: 'yesterday' })
    expect(JSON.parse(cache.set.mock.calls[0]?.[1] as string)).toMatchObject({ fence: lease.fence })
  })

  test('rejects obsolete envelope versions before a stale DTO can be read', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(serializedEnvelope({ version: 0, fence: 7 }))
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'replacement' }))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ data: { name: 'replacement' }, source: 'esi' })
  })

  test('rejects malformed envelope validators before revalidation', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(serializedEnvelope({ etag: 42, fence: 7 }))
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'replacement' }))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ data: { name: 'replacement' }, source: 'esi' })
    expect(load).toHaveBeenCalledWith({})
  })

  test('serves only policy-permitted retained stale data during a cooldown', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(
      serializedEnvelope({ freshUntil: now - 1, retainUntil: now + 60_000, fence: 7 }),
    )
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockRejectedValue(esiRateLimited(15))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({
      data: { name: 'cached' },
      source: 'cache',
      stale: true,
      retryAt: new Date(now + 15_000).toISOString(),
    })
    expect(load).toHaveBeenCalledOnce()
  })

  test('serves usable stale data after the first retryable refresh failure', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(
      serializedEnvelope({ freshUntil: now - 1, retainUntil: now + 60_000, fence: 7 }),
    )
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockRejectedValue(Object.assign(new Error('Unavailable'), { status: 503 }))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ data: { name: 'cached' }, source: 'cache', stale: true })
    expect(load).toHaveBeenCalledOnce()
  })

  test('does not serve a retained public value beyond its declared stale duration', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(
      serializedEnvelope({
        freshUntil: now - 3_600_001,
        staleUntil: now - 1,
        retainUntil: now + 60_000,
        fence: 7,
      }),
    )
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const failure = Object.assign(new Error('Unavailable'), { status: 503 })
    const load = vi.fn().mockRejectedValue(failure)

    const pending = layer.getPublic({
      operation: 'public-corporation',
      inputs: { corporationId: 90_000_001 },
      load,
    })
    const caught = pending.catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await caught).toBe(failure)
    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledWith({ ifNoneMatch: '"etag"', ifModifiedSince: 'yesterday' })
  })

  test('rejects a representation-incompatible envelope and its validators', async () => {
    const cache = redis()
    cache.get.mockResolvedValue(serializedEnvelope({ representationVersion: 'old', fence: 7 }))
    mocks.getCommitted.mockResolvedValue(7)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'replacement' }))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ data: { name: 'replacement' }, source: 'esi' })
    expect(load).toHaveBeenCalledWith({})
  })

  test('rejects a private envelope populated under another token generation', async () => {
    let generation = 1
    const authorizeCharacter = vi.fn(async () => ({
      accessToken: 'token',
      tokenVersion: generation,
    }))
    const layer = new EsiResilienceLayer(redis() as never, redis() as never, 2, authorizeCharacter)
    const load = vi.fn().mockResolvedValue(result(1))
    const resource = {
      operation: 'wallet-balance' as const,
      inputs: { characterId: 1 },
      load,
    }

    await layer.getCharacter(resource)
    generation = 2
    await layer.getCharacter(resource)

    expect(load).toHaveBeenCalledTimes(2)
  })

  test('resolves current character authorization before cache access', async () => {
    const cache = redis()
    const scopeError = new Error('Scope revoked')
    const authorizeCharacter = vi.fn().mockRejectedValue(scopeError)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2, authorizeCharacter)

    await expect(
      layer.getCharacter({
        operation: 'wallet-balance',
        inputs: { characterId: 2 },
        load: vi.fn(),
      }),
    ).rejects.toBe(scopeError)
    expect(authorizeCharacter).toHaveBeenCalledWith(2, 'esi-wallet.read_character_wallet.v1')
    expect(cache.ping).not.toHaveBeenCalled()
  })

  test('retries eligible network failures with bounded attempts', async () => {
    const layer = new EsiResilienceLayer(redis() as never, redis() as never, 2)
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockRejectedValueOnce(Object.assign(new Error('upstream unavailable'), { status: 503 }))
      .mockResolvedValueOnce(result({ name: 'recovered' }))

    const pending = layer.getPublic({
      operation: 'public-corporation',
      inputs: { corporationId: 90_000_001 },
      load,
    })
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toMatchObject({ data: { name: 'recovered' }, source: 'esi' })
    expect(load).toHaveBeenCalledTimes(3)
  })

  test('retains a private entry for conditional revalidation without serving it stale', async () => {
    const layer = new EsiResilienceLayer(redis() as never, redis() as never, 2, authorize())
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        ...result({ name: 'cached' }),
        meta: {
          status: 200,
          headers: {},
          cache: { cacheControl: 'max-age=60', etag: '"etag"', lastModified: 'yesterday' },
        },
      })
      .mockRejectedValueOnce(esiRateLimited(12))

    await layer.getCharacter({
      operation: 'wallet-balance',
      inputs: { characterId: 1 },
      load,
    })
    await vi.advanceTimersByTimeAsync(60_001)
    await expect(
      layer.getCharacter({
        operation: 'wallet-balance',
        inputs: { characterId: 1 },
        load,
      }),
    ).rejects.toEqual(new EsiQuotaError(12))
    expect(load).toHaveBeenLastCalledWith(
      { accessToken: 'token', principal: 'character-1' },
      { ifNoneMatch: '"etag"', ifModifiedSince: 'yesterday' },
    )
  })

  test('reuses a validated cache namespace for one second', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'cached' }))

    await layer.getPublic({ operation: 'public-corporation', inputs: { corporationId: 1 }, load })
    await layer.getPublic({ operation: 'public-corporation', inputs: { corporationId: 2 }, load })
    expect(mocks.initialize).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_001)
    await layer.getPublic({ operation: 'public-corporation', inputs: { corporationId: 3 }, load })
    expect(mocks.initialize).toHaveBeenCalledTimes(2)
  })

  test('drops warm L1 values when the coordination namespace changes', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'cached' }))
    const resource = {
      operation: 'public-corporation' as const,
      inputs: { corporationId: 1 },
      load,
    }

    await layer.getPublic(resource)
    await vi.advanceTimersByTimeAsync(1_001)
    mocks.initialize.mockResolvedValueOnce('namespace-two')
    await layer.getPublic(resource)

    expect(load).toHaveBeenCalledTimes(2)
  })

  test('waits against the owner lease TTL before attempting a follower takeover', async () => {
    const cache = redis()
    mocks.acquire.mockResolvedValueOnce(undefined).mockResolvedValue(lease)
    mocks.getLeaseTtl.mockResolvedValue(0)
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'replacement' }))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ source: 'esi' })
    expect(mocks.getLeaseTtl).toHaveBeenCalled()
    expect(mocks.acquire).toHaveBeenCalledTimes(2)
  })

  test('reports request-owner wait timeout as dependency failure rather than ESI quota', async () => {
    mocks.acquire.mockResolvedValue(undefined)
    mocks.getLeaseTtl.mockResolvedValue(100)
    const layer = new EsiResilienceLayer(redis() as never, redis() as never, 2)
    const pending = layer.getPublic({
      operation: 'public-corporation',
      inputs: { corporationId: 90_000_001 },
      load: vi.fn(),
    })
    const caught = pending.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(30_001)
    const error = await caught
    expect(error).toMatchObject({ name: 'EsiRequestWaitTimeoutError' })
    expect(error).not.toBeInstanceOf(EsiQuotaError)
  })

  test('does not cache a no-value operation while still loading it', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result([{ character_id: 90_000_001 }]))

    await expect(
      layer.executeNoValue({ operation: 'bulk-affiliation', inputs: { characterIds: [1] }, load }),
    ).resolves.toMatchObject({ source: 'esi' })
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  test('publishes private values to the shared cache after authorization binding', async () => {
    const cache = redis()
    const coordination = redis()
    const layer = new EsiResilienceLayer(cache as never, coordination as never, 2, authorize())
    const load = vi.fn().mockResolvedValue(result({ balance: 1 }))
    const resource = {
      operation: 'wallet-balance' as const,
      inputs: { characterId: 1 },
      load,
    }

    await layer.getCharacter(resource)
    await layer.getCharacter(resource)

    expect(load).toHaveBeenCalledOnce()
    expect(cache.get).toHaveBeenCalledOnce()
    expect(cache.set).toHaveBeenCalledOnce()
    expect(JSON.parse(cache.set.mock.calls[0]?.[1] as string)).toMatchObject({
      authorization: { kind: 'character', principal: 'character-1', generation: 1 },
    })
  })

  test('evicts private values from the bounded shared-cache L1', async () => {
    const layer = new EsiResilienceLayer(redis() as never, redis() as never, 2, authorize())
    const load = vi.fn().mockResolvedValue(result({ balance: 1 }))
    const resource = (characterId: number) => ({
      operation: 'wallet-balance' as const,
      inputs: { characterId },
      load,
    })

    for (const characterId of Array.from({ length: 101 }, (_, index) => index + 1))
      await layer.getCharacter(resource(characterId))
    await layer.getCharacter(resource(1))

    expect(load).toHaveBeenCalledTimes(102)
  })

  test('does not pass validators for a non-revalidating operation', async () => {
    const cache = redis()
    const layer = new EsiResilienceLayer(cache as never, redis() as never, 2)
    const load = vi.fn().mockResolvedValue(result([{ character_id: 90_000_001 }]))

    await layer.executeNoValue({
      operation: 'bulk-affiliation',
      inputs: { characterIds: [2] },
      load,
    })
    expect(load).toHaveBeenCalledWith({})
  })

  test('uses L1 or a controlled reload when cache or coordination is unavailable', async () => {
    const cache = redis()
    cache.get.mockRejectedValue(new Error('cache unavailable'))
    const coordination = redis()
    const layer = new EsiResilienceLayer(cache as never, coordination as never, 2)
    const load = vi.fn().mockResolvedValue(result({ name: 'fallback' }))

    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load,
      }),
    ).resolves.toMatchObject({ data: { name: 'fallback' } })
    expect(mocks.acquire).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_001)
    mocks.initialize.mockRejectedValueOnce(new Error('coordination unavailable'))
    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_002 },
        load,
      }),
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

function authorize(tokenVersion = 1) {
  return vi.fn(async () => ({ accessToken: 'token', tokenVersion }))
}

function serializedEnvelope(overrides: Partial<Record<string, unknown>>) {
  return JSON.stringify({
    version: 2,
    representationVersion: 'v2',
    data: { name: 'cached' },
    freshUntil: now + 60_000,
    staleUntil: now + 60_000,
    retainUntil: now + 60_000,
    validatedAt: new Date(now).toISOString(),
    etag: '"etag"',
    lastModified: 'yesterday',
    fence: 7,
    ...overrides,
  })
}

function esiRateLimited(retryAfterSeconds: number) {
  return Object.assign(new Error('Rate limited'), {
    status: 429,
    metadata: { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
  })
}
