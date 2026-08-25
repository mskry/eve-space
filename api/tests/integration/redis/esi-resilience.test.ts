import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  acquireEsiRequestLease,
  commitEsiFence,
  getCommittedEsiFence,
  getEsiRequestLeaseTtl,
  initializeCacheNamespace,
  releaseEsiRequestLease,
  renewEsiRequestLease,
} from '../../../src/esi-resilience/coordination.js'
import {
  acquireEsiRequestPermit,
  EsiQuotaError,
  recordEsiResponse,
} from '../../../src/esi-resilience/cooldowns.js'
import { EsiResilienceLayer } from '../../../src/esi-resilience/resilience.js'
import {
  cacheCoordinationSentinelKey,
  cacheEnvelopeKey,
} from '../../../src/esi-resilience/namespaces.js'
import { createEsiRepresentationIdentity } from '../../../src/esi-resilience/identity.js'
import { getEsiOperationContract } from '../../../src/esi-resilience/catalog.js'
import type { EsiLoadResult, EsiRevalidation } from '../../../src/esi-resilience/types.js'
import {
  readEsiRateMeasurement,
  recordEsiRateMeasurement,
} from '../../../src/esi-resilience/rate-measurement.js'

let cacheContainer: StartedTestContainer
let coordinationContainer: StartedTestContainer
let cache: Redis
let coordination: Redis

beforeAll(async () => {
  ;[cacheContainer, coordinationContainer] = await Promise.all([
    new GenericContainer('redis:7.4.7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('redis:7.4.7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ])
  cache = createClient(cacheContainer)
  coordination = createClient(coordinationContainer)
})

afterEach(async () => {
  await Promise.all([cache.flushdb(), coordination.flushdb()])
})

afterAll(async () => {
  cache.disconnect()
  coordination.disconnect()
  await Promise.all([cacheContainer.stop(), coordinationContainer.stop()])
})

describe('ESI resilience Redis coordination', () => {
  test('owner-checked Lua release cannot delete another owner lease', async () => {
    const resource = identity('public-character', { characterId: 90_000_001 })
    const lease = await acquireEsiRequestLease(coordination, resource)
    expect(lease).toBeDefined()
    if (!lease) throw new Error('lease was not acquired')

    await expect(
      releaseEsiRequestLease(coordination, { ...lease, ownerToken: 'not-the-owner' }),
    ).resolves.toBe(false)
    await expect(releaseEsiRequestLease(coordination, lease)).resolves.toBe(true)
  })

  test('renews only the current lease owner and reports its remaining lifetime', async () => {
    const resource = identity('public-character', { characterId: 90_000_001 })
    const lease = await acquireEsiRequestLease(coordination, resource, 100)
    if (!lease) throw new Error('lease was not acquired')

    await expect(getEsiRequestLeaseTtl(coordination, resource)).resolves.toBeGreaterThan(0)
    await expect(renewEsiRequestLease(coordination, lease)).resolves.toBe(true)
    await expect(
      renewEsiRequestLease(coordination, { ...lease, ownerToken: 'not-the-owner' }),
    ).resolves.toBe(false)
  })

  test('collapses concurrent replicas and permits takeover after owner expiry', async () => {
    const resource = identity('public-character', { characterId: 90_000_001 })
    const [first, second] = await Promise.all([
      acquireEsiRequestLease(coordination, resource, 50),
      acquireEsiRequestLease(coordination, resource, 50),
    ])
    const owner = first ?? second
    expect(owner).toBeDefined()
    expect(Boolean(first) && Boolean(second)).toBe(false)

    await wait(75)
    const takeover = await acquireEsiRequestLease(coordination, resource, 50)
    expect(takeover?.fence).toBeGreaterThan(owner!.fence)
  })

  test('separates leases and committed fences for different operations with the same inputs', async () => {
    const character = identity('public-character', { characterId: 90_000_001 })
    const history = identity('employment-history', { characterId: 90_000_001 })
    const [characterLease, historyLease] = await Promise.all([
      acquireEsiRequestLease(coordination, character),
      acquireEsiRequestLease(coordination, history),
    ])
    if (!characterLease || !historyLease) throw new Error('operation leases were not acquired')

    expect(characterLease.key).not.toBe(historyLease.key)
    expect(characterLease.key).toContain('eve-space:v2:esi-resilience:lease:public-character:')
    await expect(commitEsiFence(coordination, character, characterLease)).resolves.toBe(true)
    await expect(getCommittedEsiFence(coordination, history)).resolves.toBeUndefined()
  })

  test('rejects a late owner publication after a newer fence commits', async () => {
    const resource = identity('public-character', { characterId: 90_000_001 })
    const first = await acquireEsiRequestLease(coordination, resource, 40)
    if (!first) throw new Error('first owner was not acquired')
    await wait(60)
    const second = await acquireEsiRequestLease(coordination, resource, 1_000)
    if (!second) throw new Error('second owner was not acquired')

    await expect(commitEsiFence(coordination, resource, second)).resolves.toBe(true)
    await expect(commitEsiFence(coordination, resource, first)).resolves.toBe(false)
    await expect(getCommittedEsiFence(coordination, resource)).resolves.toBe(second.fence)
  })

  test('recovers when an owner commits a fence then dies before publishing an envelope', async () => {
    const namespace = await initializeCacheNamespace(coordination)
    const resource = identity('public-corporation', { corporationId: 90_000_001 })
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) throw new Error('owner was not acquired')
    await expect(commitEsiFence(coordination, resource, owner)).resolves.toBe(true)
    await releaseEsiRequestLease(coordination, owner)

    const layer = new EsiResilienceLayer(cache, coordination, 2)
    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load: loadValidated,
      }),
    ).resolves.toMatchObject({ data: { name: 'validated' }, source: 'esi' })
    await expect(cache.get(cacheEnvelopeKey(namespace, resource))).resolves.toContain('validated')
  })

  test('treats an envelope without a committed identity as a miss', async () => {
    const namespace = await initializeCacheNamespace(coordination)
    const resource = identity('public-corporation', { corporationId: 90_000_001 })
    const key = cacheEnvelopeKey(namespace, resource)
    await cache.set(
      key,
      JSON.stringify({
        version: 1,
        data: { name: 'untrusted' },
        freshUntil: Date.now() + 60_000,
        retainUntil: Date.now() + 60_000,
        validatedAt: new Date().toISOString(),
        quota: {},
        fence: 1,
      }),
    )
    const layer = new EsiResilienceLayer(cache, coordination, 2)
    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load: loadValidated,
      }),
    ).resolves.toMatchObject({
      data: { name: 'validated' },
      source: 'esi',
    })
  })

  test('rejects an old envelope even when its fence is committed', async () => {
    const namespace = await initializeCacheNamespace(coordination)
    const resource = identity('public-corporation', { corporationId: 90_000_001 })
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) throw new Error('owner was not acquired')
    await commitEsiFence(coordination, resource, owner)
    await cache.set(
      cacheEnvelopeKey(namespace, resource),
      JSON.stringify({
        version: 1,
        data: { name: 'old' },
        freshUntil: Date.now() + 60_000,
        retainUntil: Date.now() + 60_000,
        validatedAt: new Date().toISOString(),
        fence: owner.fence,
      }),
    )
    await releaseEsiRequestLease(coordination, owner)

    const layer = new EsiResilienceLayer(cache, coordination, 2)
    await expect(
      layer.getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load: loadValidated,
      }),
    ).resolves.toMatchObject({ data: { name: 'validated' }, source: 'esi' })
  })

  test('preserves an absolute freshness deadline across layer recreation', async () => {
    const namespace = await initializeCacheNamespace(coordination)
    const resource = identity('public-corporation', { corporationId: 90_000_001 })
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) throw new Error('owner was not acquired')
    await commitEsiFence(coordination, resource, owner)
    const freshUntil = Date.now() + 250
    await cache.set(
      cacheEnvelopeKey(namespace, resource),
      JSON.stringify({
        version: 2,
        representationVersion: resource.representationVersion,
        data: { name: 'cached' },
        freshUntil,
        staleUntil: freshUntil,
        retainUntil: freshUntil + 3_000,
        validatedAt: new Date().toISOString(),
        etag: '"absolute"',
        fence: owner.fence,
      }),
      'PX',
      3_250,
    )
    await releaseEsiRequestLease(coordination, owner)
    const firstLoad = vi.fn(loadValidated)

    await expect(
      new EsiResilienceLayer(cache, coordination, 2).getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load: firstLoad,
      }),
    ).resolves.toMatchObject({ data: { name: 'cached' }, source: 'cache' })
    expect(firstLoad).not.toHaveBeenCalled()

    await wait(300)
    const secondLoad = vi.fn(loadValidated)
    await expect(
      new EsiResilienceLayer(cache, coordination, 2).getPublic({
        operation: 'public-corporation',
        inputs: { corporationId: 90_000_001 },
        load: secondLoad,
      }),
    ).resolves.toMatchObject({ data: { name: 'validated' }, source: 'esi' })
    expect(secondLoad).toHaveBeenCalledWith({ ifNoneMatch: '"absolute"' })
  })

  test('shares private DTOs only for the current character token generation', async () => {
    const firstLoad = vi.fn().mockResolvedValue({
      data: 10,
      meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=60' } },
    })
    await new EsiResilienceLayer(cache, coordination, 2, authorize(1)).getCharacter(
      privateResource(90_000_001, firstLoad),
    )

    const replicaLoad = vi.fn()
    await expect(
      new EsiResilienceLayer(cache, coordination, 2, authorize(1)).getCharacter(
        privateResource(90_000_001, replicaLoad),
      ),
    ).resolves.toMatchObject({ data: 10, source: 'cache' })
    expect(replicaLoad).not.toHaveBeenCalled()

    const replacementLoad = vi.fn().mockResolvedValue({
      data: 20,
      meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=60' } },
    })
    await expect(
      new EsiResilienceLayer(cache, coordination, 2, authorize(2)).getCharacter(
        privateResource(90_000_001, replacementLoad),
      ),
    ).resolves.toMatchObject({ data: 20, source: 'esi' })

    const otherCharacterLoad = vi.fn().mockResolvedValue({
      data: 30,
      meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=60' } },
    })
    await expect(
      new EsiResilienceLayer(cache, coordination, 2, authorize(2)).getCharacter(
        privateResource(90_000_002, otherCharacterLoad),
      ),
    ).resolves.toMatchObject({ data: 30, source: 'esi' })
  })

  test('advances cache namespace after coordination state is flushed', async () => {
    const first = await initializeCacheNamespace(coordination)
    const resource = identity('public-character', { characterId: 90_000_001 })
    await cache.set(cacheEnvelopeKey(first, resource), 'old')
    await coordination.flushdb()

    const second = await initializeCacheNamespace(coordination)
    expect(second).not.toBe(first)
    await expect(cache.get(cacheEnvelopeKey(second, resource))).resolves.toBeNull()
  })

  test('reuses the namespace while its coordination sentinel remains present', async () => {
    const first = await initializeCacheNamespace(coordination)
    await expect(initializeCacheNamespace(coordination)).resolves.toBe(first)
  })

  test('concurrent initializers converge on one namespace after coordination loss', async () => {
    await coordination.flushdb()
    const other = createClient(coordinationContainer)
    try {
      const namespaces = await Promise.all([
        initializeCacheNamespace(coordination),
        initializeCacheNamespace(other),
      ])
      expect(new Set(namespaces)).toHaveLength(1)
    } finally {
      await other.quit()
    }
  })

  test('replaces the persisted legacy sentinel with an opaque namespace', async () => {
    await coordination.set(cacheCoordinationSentinelKey, '1')

    const namespace = await initializeCacheNamespace(coordination)

    expect(namespace).toMatch(/^[0-9a-f-]{36}$/)
    expect(namespace).not.toBe('1')
  })

  test('disposing cache keys cannot remove coordination state', async () => {
    const namespace = await initializeCacheNamespace(coordination)
    const lease = await acquireEsiRequestLease(
      coordination,
      identity('public-character', { characterId: 90_000_001 }),
    )
    if (!lease) throw new Error('lease was not acquired')
    await cache.set('disposable-envelope', 'value')
    await cache.flushdb()

    await expect(coordination.get(lease.key)).resolves.not.toBeNull()
    await expect(initializeCacheNamespace(coordination)).resolves.toBe(namespace)
  })

  test('aggregates fixed-window call rates without retaining enumerable principals', async () => {
    const now = Date.parse('2026-08-25T12:07:00.000Z')
    await Promise.all([
      recordEsiRateMeasurement(cache, {
        operation: 'wallet-balance',
        principal: 'character-90000001',
        status: 200,
        now,
      }),
      recordEsiRateMeasurement(cache, {
        operation: 'status',
        status: 200,
        now,
      }),
      recordEsiRateMeasurement(cache, {
        operation: 'wallet-transactions',
        principal: 'character-90000001',
        status: 304,
        now,
      }),
      recordEsiRateMeasurement(cache, {
        operation: 'wallet-balance',
        principal: 'character-90000002',
        status: 404,
        now,
      }),
    ])

    const measurement = await readEsiRateMeasurement(cache, { now, windowOffset: 0 })
    expect(measurement.groups).toContainEqual({
      group: 'char-wallet',
      scope: 'character',
      maximumTokens: 150,
      window: '15m',
      requests: 3,
      weightedTokens: 8,
      distinctCharacters: 2,
      averageWeightedTokensPerCharacter: 4,
      capacityUsedPercent: 2.6667,
    })
    expect(measurement.groups).toContainEqual({
      group: 'status',
      scope: 'public',
      maximumTokens: 600,
      window: '15m',
      requests: 1,
      weightedTokens: 2,
      distinctCharacters: null,
      averageWeightedTokensPerCharacter: null,
      capacityUsedPercent: 0.3333,
    })
    const values = await cache.scan(0, 'MATCH', '*', 'COUNT', 100)
    const serialized = await Promise.all(values[1].map((key) => cache.dump(key)))
    expect(serialized.filter((value) => value !== null).join('')).not.toContain(
      'character-90000001',
    )
  })

  test('shares global cooldown visibility between independent clients', async () => {
    const reporter = createClient(coordinationContainer)
    const follower = createClient(coordinationContainer)
    try {
      await recordEsiResponse({
        connection: reporter,
        operation: 'status',
        status: 500,
        headers: new Headers({ 'x-esi-error-limit-remain': '0', 'x-esi-error-limit-reset': '30' }),
      })
      await expect(
        acquireEsiRequestPermit({
          connection: follower,
          operation: 'wallet-balance',
          principal: 'character-90000001',
          concurrency: 2,
        }),
      ).rejects.toBeInstanceOf(EsiQuotaError)
    } finally {
      reporter.disconnect()
      follower.disconnect()
    }
  })

  test('shares declared route-group cooldowns across operations and cold clients by principal', async () => {
    await recordEsiResponse({
      connection: coordination,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '30', 'x-ratelimit-group': 'unexpected-wallet-group' }),
    })

    const follower = createClient(coordinationContainer)
    try {
      await expect(
        acquireEsiRequestPermit({
          connection: follower,
          operation: 'wallet-transactions',
          principal: 'character-90000001',
          concurrency: 2,
        }),
      ).rejects.toBeInstanceOf(EsiQuotaError)
      const isolated = await acquireEsiRequestPermit({
        connection: follower,
        operation: 'wallet-transactions',
        principal: 'character-90000002',
        concurrency: 2,
      })
      await isolated.release()
    } finally {
      follower.disconnect()
    }
  })

  test('bounds distributed operation permits and releases them by owner token', async () => {
    const first = await acquireEsiRequestPermit({
      connection: coordination,
      operation: 'status',
      concurrency: 1,
    })
    await expect(
      acquireEsiRequestPermit({
        connection: coordination,
        operation: 'status',
        concurrency: 1,
        queueTimeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
    await first.release()
    await expect(
      acquireEsiRequestPermit({
        connection: coordination,
        operation: 'status',
        concurrency: 1,
      }),
    ).resolves.toMatchObject({ coordinationAvailable: true })
  })
})

function createClient(container: StartedTestContainer) {
  const connection = new Redis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`, {
    maxRetriesPerRequest: 1,
  })
  connection.on('error', () => {})
  return connection
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function authorize(tokenVersion: number) {
  return async () => ({ accessToken: 'token', tokenVersion })
}

function privateResource(
  characterId: number,
  load: (
    authority: { accessToken: string; principal: string },
    revalidation: EsiRevalidation,
  ) => Promise<EsiLoadResult<number>>,
) {
  return { operation: 'wallet-balance' as const, inputs: { characterId }, load }
}

async function loadValidated() {
  return { data: { name: 'validated' }, meta: { headers: {}, status: 200 } }
}

function identity(
  operation: Parameters<typeof createEsiRepresentationIdentity>[0]['operation'],
  inputs: Readonly<Record<string, unknown>>,
) {
  return createEsiRepresentationIdentity({
    operation,
    inputs,
    compatibilityDate: '2026-08-23',
    representationVersion: getEsiOperationContract(operation).representationVersion,
  })
}
