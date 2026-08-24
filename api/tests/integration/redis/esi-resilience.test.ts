import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
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
import { cacheEnvelopeKey } from '../../../src/esi-resilience/namespaces.js'

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
    const lease = await acquireEsiRequestLease(coordination, 'character-90000001')
    expect(lease).toBeDefined()
    if (!lease) throw new Error('lease was not acquired')

    await expect(
      releaseEsiRequestLease(coordination, { ...lease, ownerToken: 'not-the-owner' }),
    ).resolves.toBe(false)
    await expect(releaseEsiRequestLease(coordination, lease)).resolves.toBe(true)
  })

  test('renews only the current lease owner and reports its remaining lifetime', async () => {
    const lease = await acquireEsiRequestLease(coordination, 'character-90000001', 100)
    if (!lease) throw new Error('lease was not acquired')

    await expect(
      getEsiRequestLeaseTtl(coordination, 'character-90000001'),
    ).resolves.toBeGreaterThan(0)
    await expect(renewEsiRequestLease(coordination, lease)).resolves.toBe(true)
    await expect(
      renewEsiRequestLease(coordination, { ...lease, ownerToken: 'not-the-owner' }),
    ).resolves.toBe(false)
  })

  test('collapses concurrent replicas and permits takeover after owner expiry', async () => {
    const [first, second] = await Promise.all([
      acquireEsiRequestLease(coordination, 'character-90000001', 50),
      acquireEsiRequestLease(coordination, 'character-90000001', 50),
    ])
    const owner = first ?? second
    expect(owner).toBeDefined()
    expect(Boolean(first) && Boolean(second)).toBe(false)

    await wait(75)
    const takeover = await acquireEsiRequestLease(coordination, 'character-90000001', 50)
    expect(takeover?.fence).toBeGreaterThan(owner!.fence)
  })

  test('rejects a late owner publication after a newer fence commits', async () => {
    const first = await acquireEsiRequestLease(coordination, 'character-90000001', 40)
    if (!first) throw new Error('first owner was not acquired')
    await wait(60)
    const second = await acquireEsiRequestLease(coordination, 'character-90000001', 1_000)
    if (!second) throw new Error('second owner was not acquired')

    await expect(commitEsiFence(coordination, 'character-90000001', second)).resolves.toBe(true)
    await expect(commitEsiFence(coordination, 'character-90000001', first)).resolves.toBe(false)
    await expect(getCommittedEsiFence(coordination, 'character-90000001')).resolves.toBe(
      second.fence,
    )
  })

  test('recovers when an owner commits a fence then dies before publishing an envelope', async () => {
    const namespace = await initializeCacheNamespace(cache, coordination)
    const resource = 'character-90000001'
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) throw new Error('owner was not acquired')
    await expect(commitEsiFence(coordination, resource, owner)).resolves.toBe(true)
    await releaseEsiRequestLease(coordination, owner)

    const layer = new EsiResilienceLayer(cache, coordination, 2)
    await expect(
      layer.get({ operation: 'public-character', resource, load: loadValidated }),
    ).resolves.toMatchObject({ data: { name: 'validated' }, source: 'esi' })
    await expect(
      cache.get(cacheEnvelopeKey(namespace, 'public-character', resource)),
    ).resolves.toContain('validated')
  })

  test('treats an envelope without a committed identity as a miss', async () => {
    const namespace = await initializeCacheNamespace(cache, coordination)
    const resource = 'character-90000001'
    const key = cacheEnvelopeKey(namespace, 'public-character', resource)
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
      layer.get({ operation: 'public-character', resource, load: loadValidated }),
    ).resolves.toMatchObject({
      data: { name: 'validated' },
      source: 'esi',
    })
  })

  test('advances cache namespace after coordination state is flushed', async () => {
    const first = await initializeCacheNamespace(cache, coordination)
    await cache.set(cacheEnvelopeKey(first, 'public-character', 'character-90000001'), 'old')
    await coordination.flushdb()

    const second = await initializeCacheNamespace(cache, coordination)
    expect(second).toBe(first + 1)
    await expect(
      cache.get(cacheEnvelopeKey(second, 'public-character', 'character-90000001')),
    ).resolves.toBeNull()
  })

  test('reuses the namespace while its coordination sentinel remains present', async () => {
    const first = await initializeCacheNamespace(cache, coordination)
    await expect(initializeCacheNamespace(cache, coordination)).resolves.toBe(first)
  })

  test('disposing cache keys cannot remove coordination state', async () => {
    const lease = await acquireEsiRequestLease(coordination, 'character-90000001')
    if (!lease) throw new Error('lease was not acquired')
    await cache.set('disposable-envelope', 'value')
    await cache.flushdb()

    await expect(coordination.get(lease.key)).resolves.not.toBeNull()
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

  test('shares route-group cooldowns with operations that use the learned group', async () => {
    await recordEsiResponse({
      connection: coordination,
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '30', 'x-ratelimit-group': 'character_wallet' }),
    })

    await expect(
      acquireEsiRequestPermit({
        connection: coordination,
        operation: 'wallet-balance',
        principal: 'character-90000001',
        concurrency: 2,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
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

async function loadValidated() {
  return { data: { name: 'validated' }, meta: { headers: {}, status: 200 } }
}
