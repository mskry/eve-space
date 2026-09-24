import { Redis } from 'ioredis'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
  acquireEsiRequestLease,
  commitEsiFence,
  getCommittedEsiFence,
  getEsiRequestLeaseTtl,
  getEsiResourceRevision,
  incrementEsiResourceRevision,
  initializeCacheNamespace,
  releaseEsiRequestLease,
  renewEsiRequestLease,
} from '../../../src/esi-gateway/internal/coordination.js'
import {
  esiQuotaCoordinationPrefix,
  getEsiRequestCooldowns,
  recordEsiResponse,
} from '../../../src/esi-gateway/internal/cooldowns.js'
import { EsiQuotaError } from '../../../src/esi-gateway/failures.js'
import { acquireEsiRequestPermit } from '../../../src/esi-gateway/internal/permits.js'
import { executeEsiRequestAttempt } from '../../../src/esi-gateway/internal/request-lifecycle.js'
import { createRawEsiTransport } from '../../../src/esi-gateway/internal/transport.js'
import { composeEnvelopeRepresentationVersion } from '../../../src/esi-gateway/internal/envelope.js'
import {
  cacheCoordinationSentinelKey,
  cacheEnvelopeKey,
} from '../../../src/esi-gateway/internal/keys.js'
import { createEsiRepresentationIdentity } from '../../../src/esi-gateway/internal/identity.js'
import { getEsiOperationContract } from '../../../src/esi-gateway/internal/catalog-access.js'
import {
  readEsiRateMeasurement,
  recordEsiRateMeasurement,
} from '../../../src/esi-gateway/internal/rate-measurement.js'

let cacheContainer: StartedTestContainer
let coordinationContainer: StartedTestContainer
let cache: Redis
let coordination: Redis
let authorizationVersion = 1
let lifecycleAuthorizationResolutions = 0
let lifecycleCacheAuthorizationResolutions = 0
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const replacementSubjectLifecycleId = '22222222-2222-4222-8222-222222222222'
let currentSubjectLifecycleId = subjectLifecycleId
const lifecycleInvalidated = new Error('character lifecycle is no longer current')

vi.mock('../../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => cache,
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../../src/esi-gateway/internal/coordination-connection.js', () => ({
  getCoordinationConnection: () => coordination,
}))
vi.mock('../../../src/auth/token-errors.js', () => ({
  TokenRefreshUnavailableError: class TokenRefreshUnavailableError extends Error {},
}))
vi.mock('../../../src/auth/tokens.js', () => ({
  getCharacterAuthorization: async () => ({
    accessToken: 'token',
    tokenVersion: authorizationVersion,
  }),
  getCharacterAuthorizationForLifecycle: async (
    _characterId: number,
    requestedSubjectLifecycleId: string,
  ) => {
    lifecycleAuthorizationResolutions += 1
    assertCurrentSubjectLifecycle(requestedSubjectLifecycleId)
    return { accessToken: 'token', tokenVersion: authorizationVersion }
  },
  getCharacterCacheAuthorization: async () => ({ tokenVersion: authorizationVersion }),
  getCharacterCacheAuthorizationForLifecycle: async (
    _characterId: number,
    requestedSubjectLifecycleId: string,
  ) => {
    lifecycleCacheAuthorizationResolutions += 1
    assertCurrentSubjectLifecycle(requestedSubjectLifecycleId)
    return { tokenVersion: authorizationVersion }
  },
  withCharacterAuthorizationForLifecycle: async (
    _characterId: number,
    requestedSubjectLifecycleId: string,
    _scope: string,
    operation: (authorization: { accessToken: string; tokenVersion: number }) => Promise<unknown>,
  ) => {
    assertCurrentSubjectLifecycle(requestedSubjectLifecycleId)
    const result = await operation({ accessToken: 'token', tokenVersion: authorizationVersion })
    assertCurrentSubjectLifecycle(requestedSubjectLifecycleId)
    return result
  },
}))

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
  vi.restoreAllMocks()
  await Promise.all([cache.flushdb(), coordination.flushdb()])
  authorizationVersion = 1
  lifecycleAuthorizationResolutions = 0
  lifecycleCacheAuthorizationResolutions = 0
  currentSubjectLifecycleId = subjectLifecycleId
  vi.resetModules()
  vi.unstubAllGlobals()
})

afterAll(async () => {
  cache.disconnect()
  coordination.disconnect()
  await Promise.all([cacheContainer.stop(), coordinationContainer.stop()])
})

describe('ESI resilience Redis coordination', () => {
  test('reads ordered operation cooldowns through one bounded mget', async () => {
    const mget = vi.spyOn(coordination, 'mget')
    await recordEsiResponse({
      connection: coordination,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    await expect(
      getEsiRequestCooldowns({
        connection: coordination,
        maximumRequests: 100,
        requests: [
          { operation: 'status' },
          { operation: 'wallet-transactions', principal: 'character-90000001' },
          { operation: 'status' },
        ],
      }),
    ).resolves.toMatchObject([
      { active: false, coordinationAvailable: true },
      { active: true, coordinationAvailable: true, retryAfterSeconds: 12 },
      { active: false, coordinationAvailable: true },
    ])
    expect(mget).toHaveBeenCalledOnce()
  })

  test('uses a local cooldown batch when Redis mget is unavailable', async () => {
    const unavailable = {
      eval: vi.fn().mockRejectedValue(new Error('unavailable')),
      mget: vi.fn().mockRejectedValue(new Error('unavailable')),
    }
    await recordEsiResponse({
      connection: unavailable as never,
      metadata: { headers: {}, retryAfterSeconds: 12, status: 429 },
      operation: 'wallet-balance',
      principal: 'character-90000002',
    })

    await expect(
      getEsiRequestCooldowns({
        connection: unavailable,
        maximumRequests: 100,
        requests: [{ operation: 'wallet-transactions', principal: 'character-90000002' }],
      }),
    ).resolves.toMatchObject([{ active: true, coordinationAvailable: false }])
  })

  test('recovers when an owner commits a fence then dies before publishing an envelope', async () => {
    const representation = await statusRepresentation()
    const resource = representationIdentity('status', {}, 'redis-status')
    const namespace = await initializeCacheNamespace(coordination)
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) {
      throw new Error('owner was not acquired')
    }
    await expect(commitEsiFence(coordination, resource, owner)).resolves.toBe(true)
    await releaseEsiRequestLease(coordination, owner)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse('validated')))
    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'validated' },
      source: 'esi',
    })
    await expect(cache.get(cacheEnvelopeKey(namespace, resource))).resolves.toContain('validated')
  })

  test('reuses a fresh registered representation without another upstream request', async () => {
    const fetch = vi.fn().mockResolvedValue(statusResponse('cached'))
    vi.stubGlobal('fetch', fetch)
    const representation = await statusRepresentation()
    await expect(execute(representation, {})).resolves.toMatchObject({ source: 'esi' })
    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'cached' },
      source: 'cache',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('treats an envelope without a committed identity as a miss', async () => {
    const representation = await statusRepresentation()
    const resource = representationIdentity('status', {}, 'redis-status')
    const namespace = await initializeCacheNamespace(coordination)
    await cache.set(
      cacheEnvelopeKey(namespace, resource),
      JSON.stringify({
        data: statusData('untrusted'),
        fence: 1,
        freshUntil: Date.now() + 60_000,
        representationVersion: composeEnvelopeRepresentationVersion(
          resource.representationVersion,
          resource.representationName,
        ),
        retainUntil: Date.now() + 60_000,
        staleUntil: Date.now() + 60_000,
        validatedAt: new Date().toISOString(),
        version: 3,
      }),
    )
    const fetch = vi.fn().mockResolvedValue(statusResponse('validated'))
    vi.stubGlobal('fetch', fetch)
    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'validated' },
      source: 'esi',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('preserves an absolute freshness deadline across executor recreation', async () => {
    const representation = await statusRepresentation()
    const resource = representationIdentity('status', {}, 'redis-status')
    const namespace = await initializeCacheNamespace(coordination)
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) {
      throw new Error('owner was not acquired')
    }
    await commitEsiFence(coordination, resource, owner)
    const freshUntil = Date.now() + 250
    await cache.set(
      cacheEnvelopeKey(namespace, resource),
      JSON.stringify({
        data: { name: 'cached' },
        etag: '"absolute"',
        fence: owner.fence,
        freshUntil,
        representationVersion: composeEnvelopeRepresentationVersion(
          resource.representationVersion,
          resource.representationName,
        ),
        retainUntil: freshUntil + 3000,
        staleUntil: freshUntil,
        validatedAt: new Date().toISOString(),
        version: 3,
      }),
      'PX',
      3250,
    )
    await releaseEsiRequestLease(coordination, owner)
    const fetch = vi.fn().mockResolvedValue(statusResponse('validated'))
    vi.stubGlobal('fetch', fetch)
    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'cached' },
      source: 'cache',
    })
    expect(fetch).not.toHaveBeenCalled()

    await wait(300)
    vi.resetModules()
    const nextRepresentation = await statusRepresentation()
    await expect(execute(nextRepresentation, {})).resolves.toMatchObject({
      data: { name: 'validated' },
      source: 'esi',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('shares private representations only for the current lifecycle and token generation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(esiResponse(10))
      .mockResolvedValueOnce(esiResponse(20))
      .mockResolvedValueOnce(esiResponse(30))
    vi.stubGlobal('fetch', fetch)
    let representation = await walletRepresentation()
    await expect(
      execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({
      data: 10,
      source: 'esi',
    })
    vi.resetModules()
    representation = await walletRepresentation()
    await expect(
      execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({
      data: 10,
      source: 'cache',
    })

    authorizationVersion = 2
    vi.resetModules()
    representation = await walletRepresentation()
    await expect(
      execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({
      data: 20,
      source: 'esi',
    })
    currentSubjectLifecycleId = replacementSubjectLifecycleId
    await expect(
      execute(
        representation,
        { characterId: 90_000_001 },
        { subjectLifecycleId: replacementSubjectLifecycleId },
      ),
    ).resolves.toMatchObject({
      data: 30,
      source: 'esi',
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('serves cached platform wire data without resolving token material again', async () => {
    const operation = 'organization-activity-character-jobs'
    const authorization = {
      characterId: 90_000_001,
      generation: 1,
      kind: 'character-lifecycle' as const,
      lifecycleId: '11111111-1111-4111-8111-111111111111',
    }
    const inputs = { path: { character_id: authorization.characterId } }
    const fetch = vi.fn().mockResolvedValue(esiResponse({ freelance_jobs: [] }))
    vi.stubGlobal('fetch', fetch)
    let platformExecutionModule = await import('../../../src/esi-gateway/platform-execution.js')

    await expect(
      platformExecutionModule.executePlatformEsiOperation({
        authorization,
        inputs,
        operation,
      }),
    ).resolves.toMatchObject({ data: { freelance_jobs: [] }, source: 'esi' })

    vi.resetModules()
    platformExecutionModule = await import('../../../src/esi-gateway/platform-execution.js')
    await expect(
      platformExecutionModule.executePlatformEsiOperation({
        authorization,
        inputs,
        operation,
      }),
    ).resolves.toMatchObject({ data: { freelance_jobs: [] }, source: 'cache' })

    expect(fetch).toHaveBeenCalledOnce()
    expect(lifecycleAuthorizationResolutions).toBe(1)
  })

  test('collapses revision-sensitive mail reads across executor instances', async () => {
    const pendingResponses: Array<(response: Response) => void> = []
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve)
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const representation = await mailRepresentation()
    const owner = execute(
      representation,
      { characterId: 90_000_001, mailId: 7 },
      { subjectLifecycleId },
    )
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    vi.resetModules()
    const followerRepresentation = await mailRepresentation()
    const follower = execute(
      followerRepresentation,
      {
        characterId: 90_000_001,
        mailId: 7,
      },
      { subjectLifecycleId },
    )
    await wait(20)
    expect(fetch).toHaveBeenCalledOnce()
    pendingResponses[0]?.(esiResponse({ body: 'owner' }, 30))

    await expect(Promise.all([owner, follower])).resolves.toStrictEqual([
      expect.objectContaining({ data: { body: 'owner' }, source: 'esi' }),
      expect.objectContaining({ data: { body: 'owner' }, source: 'cache' }),
    ])
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('rejects every same-process collapsed caller when its lifecycle changes in flight', async () => {
    const pendingResponses: Array<(response: Response) => void> = []
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve)
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const representation = await mailRepresentation()
    const callers = Array.from({ length: 3 }, () =>
      execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId }),
    )
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(lifecycleCacheAuthorizationResolutions).toBe(3))
    currentSubjectLifecycleId = replacementSubjectLifecycleId
    pendingResponses[0]?.(esiResponse({ body: 'former' }, 30))

    await Promise.all(callers.map((caller) => expect(caller).rejects.toBe(lifecycleInvalidated)))
    expect(fetch).toHaveBeenCalledOnce()
  })

  test.each(['l1', 'shared'] as const)(
    'rejects an old %s outage-stale result when lifecycle rotation races Cache Redis failure',
    async (source) => {
      let rejectRefresh!: (error: Error) => void
      const refreshFailed = new Promise<Response>((_resolve, reject) => {
        rejectRefresh = reject
      })
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(esiResponse(10, 0))
        .mockImplementationOnce(() => refreshFailed)
        .mockResolvedValueOnce(esiResponse(20, 0))
      vi.stubGlobal('fetch', fetch)
      let representation = await walletRepresentation()

      await expect(
        execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
      ).resolves.toMatchObject({ data: 10, source: 'esi' })
      const namespace = await initializeCacheNamespace(coordination)
      const key = cacheEnvelopeKey(
        namespace,
        representationIdentity(
          'wallet-balance',
          { characterId: 90_000_001 },
          'redis-wallet-balance',
        ),
      )
      await expect(cache.get(key)).resolves.toContain(subjectLifecycleId)

      if (source === 'shared') {
        vi.resetModules()
        representation = await walletRepresentation()
      }
      const cacheRead = vi.spyOn(cache, 'get')
      if (source === 'l1') {
        cacheRead.mockRejectedValue(new Error('Cache Redis unavailable'))
      }

      try {
        const formerRequest = execute(
          representation,
          { characterId: 90_000_001 },
          { subjectLifecycleId },
        )
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        if (source === 'shared') {
          cacheRead.mockRejectedValue(new Error('Cache Redis unavailable'))
        }
        currentSubjectLifecycleId = replacementSubjectLifecycleId
        rejectRefresh(new TypeError('ESI unavailable'))

        await expect(formerRequest).rejects.toBe(lifecycleInvalidated)
        await expect(
          execute(
            representation,
            { characterId: 90_000_001 },
            { subjectLifecycleId: replacementSubjectLifecycleId },
          ),
        ).resolves.toMatchObject({ data: 20, source: 'esi' })
        expect(fetch).toHaveBeenCalledTimes(3)
      } finally {
        cacheRead.mockRestore()
      }
    },
  )

  test('rejects prior authorization generations and mailbox revisions', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(esiResponse({ body: 'first' }, 30))
      .mockResolvedValueOnce(esiResponse({ body: 'reauthorized' }, 30))
      .mockResolvedValueOnce(esiResponse({ body: 'organized' }, 30))
    vi.stubGlobal('fetch', fetch)
    let representation = await mailRepresentation()
    await execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId })

    authorizationVersion = 2
    vi.resetModules()
    representation = await mailRepresentation()
    await execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId })
    await incrementEsiResourceRevision(coordination, 'mailbox', 'character-90000001')

    vi.resetModules()
    representation = await mailRepresentation()
    await expect(
      execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({ data: { body: 'organized' }, source: 'esi' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('advances the mailbox revision after a registered mutation succeeds', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('7001', {
        headers: { 'content-type': 'application/json' },
        status: 201,
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const representation = await mailSendRepresentation()
    await expect(
      execute(
        representation,
        {
          body: 'Body',
          characterId: 90_000_001,
          subject: 'Subject',
        },
        { subjectLifecycleId },
      ),
    ).resolves.toBe(7001)
    await expect(
      getEsiResourceRevision(coordination, 'mailbox', 'character-90000001'),
    ).resolves.toBe(1)
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('owner-checked Lua release cannot delete another owner lease', async () => {
    const resource = identity('public-character', { characterId: 90_000_001 })
    const lease = await acquireEsiRequestLease(coordination, resource)
    expect(lease).toBeDefined()
    if (!lease) {
      throw new Error('lease was not acquired')
    }

    await expect(
      releaseEsiRequestLease(coordination, { ...lease, ownerToken: 'not-the-owner' }),
    ).resolves.toBe(false)
    await expect(releaseEsiRequestLease(coordination, lease)).resolves.toBe(true)
  })

  test('renews only the current lease owner and reports its remaining lifetime', async () => {
    const resource = identity('public-character', { characterId: 90_000_001 })
    const lease = await acquireEsiRequestLease(coordination, resource, 100)
    if (!lease) {
      throw new Error('lease was not acquired')
    }

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
    if (!characterLease || !historyLease) {
      throw new Error('operation leases were not acquired')
    }

    expect(characterLease.key).not.toBe(historyLease.key)
    expect(characterLease.key).toContain('eve-space:v2:esi-resilience:lease:public-character:')
    await expect(commitEsiFence(coordination, character, characterLease)).resolves.toBe(true)
    await expect(getCommittedEsiFence(coordination, history)).resolves.toBeUndefined()
  })

  test('rejects a late owner publication after a newer fence commits', async () => {
    const resource = identity(
      'mail-message',
      { characterId: 90_000_001, mailId: 7 },
      { namespace: 'mailbox', value: 0 },
    )
    const first = await acquireEsiRequestLease(coordination, resource, 40)
    if (!first) {
      throw new Error('first owner was not acquired')
    }
    await wait(60)
    const second = await acquireEsiRequestLease(coordination, resource, 1000)
    if (!second) {
      throw new Error('second owner was not acquired')
    }

    await expect(commitEsiFence(coordination, resource, second)).resolves.toBe(true)
    await expect(commitEsiFence(coordination, resource, first)).resolves.toBe(false)
    await expect(getCommittedEsiFence(coordination, resource)).resolves.toBe(second.fence)
  })

  test('stores bounded mailbox revisions by stable character principal', async () => {
    await expect(
      getEsiResourceRevision(coordination, 'mailbox', 'character-90000001'),
    ).resolves.toBe(0)
    await expect(
      incrementEsiResourceRevision(coordination, 'mailbox', 'character-90000001'),
    ).resolves.toBe(1)
    await expect(
      incrementEsiResourceRevision(coordination, 'mailbox', 'character-90000001'),
    ).resolves.toBe(2)
    await expect(
      getEsiResourceRevision(coordination, 'mailbox', 'character-90000002'),
    ).resolves.toBe(0)
    await expect(
      getEsiResourceRevision(coordination, 'mailbox', 'invalid-principal'),
    ).rejects.toThrow('Invalid ESI resource revision identity')
  })

  test('reuses lease and fence keys across mailbox revisions', async () => {
    const firstIdentity = identity(
      'mail-message',
      { characterId: 90_000_001, mailId: 7 },
      { namespace: 'mailbox', value: 0 },
    )
    const secondIdentity = identity(
      'mail-message',
      { characterId: 90_000_001, mailId: 7 },
      { namespace: 'mailbox', value: 1 },
    )
    const first = await acquireEsiRequestLease(coordination, firstIdentity)
    if (!first) {
      throw new Error('first owner was not acquired')
    }
    await releaseEsiRequestLease(coordination, first)
    const second = await acquireEsiRequestLease(coordination, secondIdentity)
    if (!second) {
      throw new Error('second owner was not acquired')
    }

    expect(first.key).toBe(second.key)
    expect(second.fence).toBeGreaterThan(first.fence)
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
    if (!lease) {
      throw new Error('lease was not acquired')
    }
    await cache.set('disposable-envelope', 'value')
    await cache.flushdb()

    await expect(coordination.get(lease.key)).resolves.not.toBeNull()
    await expect(initializeCacheNamespace(coordination)).resolves.toBe(namespace)
  })

  test('aggregates fixed-window call rates without retaining enumerable principals', async () => {
    const now = Date.now()
    await Promise.all([
      recordEsiRateMeasurement(cache, {
        now,
        operation: 'wallet-balance',
        principal: 'character-90000001',
        status: 200,
      }),
      recordEsiRateMeasurement(cache, {
        now,
        operation: 'status',
        status: 200,
      }),
      recordEsiRateMeasurement(cache, {
        now,
        operation: 'wallet-transactions',
        principal: 'character-90000001',
        status: 304,
      }),
      recordEsiRateMeasurement(cache, {
        now,
        operation: 'wallet-balance',
        principal: 'character-90000002',
        status: 404,
      }),
    ])

    const measurement = await readEsiRateMeasurement(cache, { now, windowOffset: 0 })
    expect(measurement.groups).toContainEqual({
      averageWeightedTokensPerCharacter: 4,
      capacityUsedPercent: 2.6667,
      distinctCharacters: 2,
      group: 'char-wallet',
      maximumTokens: 150,
      requests: 3,
      scope: 'character',
      weightedTokens: 8,
      window: '15m',
    })
    expect(measurement.groups).toContainEqual({
      averageWeightedTokensPerCharacter: null,
      capacityUsedPercent: 0.3333,
      distinctCharacters: null,
      group: 'status',
      maximumTokens: 600,
      requests: 1,
      scope: 'public',
      weightedTokens: 2,
      window: '15m',
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
        metadata: { errorLimit: { remaining: 0, reset: 30 }, headers: {}, status: 500 },
        operation: 'status',
      })
      await expect(
        acquireEsiRequestPermit({
          concurrency: 2,
          connection: follower,
          operation: 'wallet-balance',
          principal: 'character-90000001',
          queueTimeoutMs: 30_000,
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
      metadata: {
        headers: {},
        retryAfterSeconds: 30,
        routeRateLimit: { group: 'unexpected-wallet-group' },
        status: 429,
      },
      operation: 'wallet-balance',
      principal: 'character-90000001',
    })

    const follower = createClient(coordinationContainer)
    try {
      await expect(
        acquireEsiRequestPermit({
          concurrency: 2,
          connection: follower,
          operation: 'wallet-transactions',
          principal: 'character-90000001',
          queueTimeoutMs: 30_000,
        }),
      ).rejects.toBeInstanceOf(EsiQuotaError)
      const isolated = await acquireEsiRequestPermit({
        concurrency: 2,
        connection: follower,
        operation: 'wallet-transactions',
        principal: 'character-90000002',
        queueTimeoutMs: 30_000,
      })
      await isolated.release()
    } finally {
      follower.disconnect()
    }
  })

  test('bounds distributed operation permits and releases them by owner token', async () => {
    const first = await acquireEsiRequestPermit({
      concurrency: 1,
      connection: coordination,
      operation: 'status',
      queueTimeoutMs: 30_000,
    })
    await expect(
      acquireEsiRequestPermit({
        concurrency: 1,
        connection: coordination,
        operation: 'status',
        queueTimeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(EsiQuotaError)
    await first.release()
    await expect(
      acquireEsiRequestPermit({
        concurrency: 1,
        connection: coordination,
        operation: 'status',
        queueTimeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({ coordinationAvailable: true })
  })

  test('renews and finally releases a real Redis permit through the request lifecycle', async () => {
    const clock = await createTestClock()
    const renewed = vi.fn()
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                bodyController = controller
              },
            }),
          ),
        ),
      ),
    )
    const key = `${esiQuotaCoordinationPrefix}:concurrency:status`
    const pending = executeRedisLifecycleAttempt({ clock, onRenew: renewed })
    await vi.waitFor(() => expect(bodyController).toBeDefined())
    await expect(coordination.zcard(key)).resolves.toBe(1)

    await Effect.runPromise(clock.adjust(20_000))
    await vi.waitFor(() => expect(renewed).toHaveBeenCalledOnce())
    await expect(coordination.zcard(key)).resolves.toBe(1)

    bodyController?.enqueue(new TextEncoder().encode('complete'))
    bodyController?.close()
    await expect(pending).resolves.toBe('complete')
    await expect(coordination.zcard(key)).resolves.toBe(0)
  })

  test('aborts consumption and finalizes after real Redis permit ownership loss', async () => {
    const clock = await createTestClock()
    let transportSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        transportSignal = init?.signal ?? undefined
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                transportSignal?.addEventListener(
                  'abort',
                  () => controller.error(transportSignal?.reason),
                  { once: true },
                )
              },
            }),
          ),
        )
      }),
    )
    const key = `${esiQuotaCoordinationPrefix}:concurrency:status`
    const pending = executeRedisLifecycleAttempt({ clock }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(transportSignal).toBeDefined())
    await coordination.del(key)

    await Effect.runPromise(clock.adjust(20_000))

    await expect(pending).resolves.toMatchObject({
      message: 'ESI concurrency permit ownership lost',
      name: 'AbortError',
    })
    expect(transportSignal?.aborted).toBe(true)
    await expect(coordination.zcard(key)).resolves.toBe(0)
  })
})

function assertCurrentSubjectLifecycle(requestedSubjectLifecycleId: string) {
  if (requestedSubjectLifecycleId !== currentSubjectLifecycleId) {
    throw lifecycleInvalidated
  }
}

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

function executeRedisLifecycleAttempt(options: {
  readonly clock: Awaited<ReturnType<typeof createTestClock>>
  readonly onRenew?: () => void
}) {
  return executeEsiRequestAttempt({
    acquirePermit: async (signal) => {
      const permit = await acquireEsiRequestPermit({
        connection: coordination,
        operation: 'status',
        concurrency: 1,
        queueTimeoutMs: 30_000,
        signal,
      })
      return {
        ...permit,
        renew: async () => {
          options.onRenew?.()
          return permit.renew()
        },
      }
    },
    attempt: async (transport) => {
      const response = await transport('https://esi.evetech.net/latest/status')
      return response.text()
    },
    clock: options.clock,
    createTransport: (lifecycle) =>
      createRawEsiTransport(
        { userAgent: 'EveSpace/Test', compatibilityDate: '2026-09-01' },
        lifecycle,
      ),
  })
}

async function createTestClock() {
  return Effect.runPromise(Effect.scoped(TestClock.make({ warningDelay: '1 hour' })))
}

async function statusRepresentation() {
  const [{ operationRegistry }, { createPublicEsiRead }] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-gateway/feature-execution.js'),
  ])
  return createPublicEsiRead({
    cacheSchema: z.object({ name: z.string() }),
    descriptor: operationRegistry.GetStatus.transport,
    encodeRequest: () => ({}),
    map: ({ data }) => ({ name: data.server_version }),
    name: 'redis-status',
    operation: 'status',
  })
}

async function walletRepresentation() {
  const [{ operationRegistry }, { createCharacterEsiRead }] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-gateway/feature-execution.js'),
  ])
  return createCharacterEsiRead({
    cacheSchema: operationRegistry.GetCharactersCharacterIdWallet.responseSchema,
    descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
    encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
      path: { character_id: input.characterId },
    }),
    map: ({ data }) => data,
    name: 'redis-wallet-balance',
    operation: 'wallet-balance',
  })
}

async function mailRepresentation() {
  const [{ operationRegistry }, { createCharacterEsiRead }] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-gateway/feature-execution.js'),
  ])
  return createCharacterEsiRead({
    cacheSchema: operationRegistry.GetCharactersCharacterIdMailMailId.responseSchema,
    descriptor: operationRegistry.GetCharactersCharacterIdMailMailId.transport,
    encodeRequest: (input: {
      characterId: number
      mailId: number
      subjectLifecycleId: string
    }) => ({
      path: { character_id: input.characterId, mail_id: input.mailId },
    }),
    map: ({ data }) => data,
    name: 'redis-mail-message',
    operation: 'mail-message',
  })
}

async function mailSendRepresentation() {
  const [{ operationRegistry }, { createCharacterEsiMutation }] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-gateway/feature-execution.js'),
  ])
  return createCharacterEsiMutation({
    descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
    encodeRequest: (input: {
      characterId: number
      body: string
      subject: string
      subjectLifecycleId: string
    }) => ({
      path: { character_id: input.characterId },
      body: {
        approved_cost: 0,
        body: input.body,
        recipients: [{ recipient_id: 90_000_002, recipient_type: 'character' as const }],
        subject: input.subject,
      },
    }),
    map: ({ data }) => data,
    name: 'redis-mail-send',
    operation: 'mail-send',
  })
}

function execute(
  representation: { execute(input: never): Promise<unknown> },
  input: Record<string, unknown>,
  options?: { readonly subjectLifecycleId?: string },
) {
  return representation.execute({ ...input, ...options } as never)
}

function statusResponse(name: string) {
  return esiResponse(statusData(name))
}

function statusData(name: string) {
  return {
    players: 1,
    server_version: name,
    start_time: '2026-08-23T11:00:00Z',
    vip: false,
  }
}

function esiResponse(data: unknown, maximumAgeSeconds = 60) {
  return new Response(JSON.stringify(data), {
    headers: {
      'cache-control': `max-age=${maximumAgeSeconds}`,
      'content-type': 'application/json',
    },
    status: 200,
  })
}

function identity(
  operation: Parameters<typeof createEsiRepresentationIdentity>[0]['operation'],
  inputs: Readonly<Record<string, unknown>>,
  resourceRevision?: Parameters<typeof createEsiRepresentationIdentity>[0]['resourceRevision'],
) {
  return createEsiRepresentationIdentity({
    compatibilityDate: '2026-08-23',
    inputs,
    operation,
    representationVersion: getEsiOperationContract(operation).representationVersion,
    resourceRevision,
  })
}

function representationIdentity(
  operation: Parameters<typeof createEsiRepresentationIdentity>[0]['operation'],
  inputs: Readonly<Record<string, unknown>>,
  representationName: string,
) {
  return createEsiRepresentationIdentity({
    compatibilityDate: '2026-08-23',
    inputs,
    operation,
    representationName,
    representationVersion: getEsiOperationContract(operation).representationVersion,
  })
}
