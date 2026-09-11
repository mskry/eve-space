import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
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
} from '../../../src/esi-resilience/coordination.js'
import {
  EsiQuotaError,
  getEsiRequestCooldowns,
  recordEsiResponse,
} from '../../../src/esi-resilience/cooldowns.js'
import { acquireEsiRequestPermit } from '../../../src/esi-resilience/permits.js'
import { composeEnvelopeRepresentationVersion } from '../../../src/esi-resilience/envelope.js'
import { cacheCoordinationSentinelKey, cacheEnvelopeKey } from '../../../src/esi-resilience/keys.js'
import { createEsiRepresentationIdentity } from '../../../src/esi-resilience/identity.js'
import { getEsiOperationContract } from '../../../src/esi-resilience/catalog-access.js'
import {
  readEsiRateMeasurement,
  recordEsiRateMeasurement,
} from '../../../src/esi-resilience/rate-measurement.js'

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

vi.mock('../../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => cache,
}))
vi.mock('../../../src/esi-resilience/coordination-connection.js', () => ({
  getCoordinationConnection: () => coordination,
}))
vi.mock('../../../src/auth/tokens.js', () => ({
  TokenRefreshUnavailableError: class TokenRefreshUnavailableError extends Error {},
  getCharacterAuthorization: async () => ({
    accessToken: 'token',
    tokenVersion: authorizationVersion,
  }),
  getCharacterCacheAuthorization: async () => ({ tokenVersion: authorizationVersion }),
  getCharacterAuthorizationForLifecycle: async (
    _characterId: number,
    requestedSubjectLifecycleId: string,
  ) => {
    lifecycleAuthorizationResolutions += 1
    assertCurrentSubjectLifecycle(requestedSubjectLifecycleId)
    return { accessToken: 'token', tokenVersion: authorizationVersion }
  },
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
      operation: 'wallet-balance',
      principal: 'character-90000001',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      getEsiRequestCooldowns({
        connection: coordination,
        requests: [
          { operation: 'status' },
          { operation: 'wallet-transactions', principal: 'character-90000001' },
          { operation: 'status' },
        ],
      }),
    ).resolves.toMatchObject([
      { active: false, coordinationAvailable: true },
      { active: true, retryAfterSeconds: 12, coordinationAvailable: true },
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
      operation: 'wallet-balance',
      principal: 'character-90000002',
      status: 429,
      headers: new Headers({ 'retry-after': '12' }),
    })

    await expect(
      getEsiRequestCooldowns({
        connection: unavailable,
        requests: [{ operation: 'wallet-transactions', principal: 'character-90000002' }],
      }),
    ).resolves.toMatchObject([{ active: true, coordinationAvailable: false }])
  })

  test('recovers when an owner commits a fence then dies before publishing an envelope', async () => {
    const representation = await statusRepresentation()
    const resource = representationIdentity('status', {}, representation.name)
    const namespace = await initializeCacheNamespace(coordination)
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) throw new Error('owner was not acquired')
    await expect(commitEsiFence(coordination, resource, owner)).resolves.toBe(true)
    await releaseEsiRequestLease(coordination, owner)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse('validated')))
    const { execute } = await import('../../../src/esi-resilience/execute.js')

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
    const { execute } = await import('../../../src/esi-resilience/execute.js')

    await expect(execute(representation, {})).resolves.toMatchObject({ source: 'esi' })
    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'cached' },
      source: 'cache',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('treats an envelope without a committed identity as a miss', async () => {
    const representation = await statusRepresentation()
    const resource = representationIdentity('status', {}, representation.name)
    const namespace = await initializeCacheNamespace(coordination)
    await cache.set(
      cacheEnvelopeKey(namespace, resource),
      JSON.stringify({
        version: 3,
        representationVersion: composeEnvelopeRepresentationVersion(
          resource.representationVersion,
          resource.representationName,
        ),
        data: statusData('untrusted'),
        freshUntil: Date.now() + 60_000,
        staleUntil: Date.now() + 60_000,
        retainUntil: Date.now() + 60_000,
        validatedAt: new Date().toISOString(),
        fence: 1,
      }),
    )
    const fetch = vi.fn().mockResolvedValue(statusResponse('validated'))
    vi.stubGlobal('fetch', fetch)
    const { execute } = await import('../../../src/esi-resilience/execute.js')

    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'validated' },
      source: 'esi',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('preserves an absolute freshness deadline across executor recreation', async () => {
    const representation = await statusRepresentation()
    const resource = representationIdentity('status', {}, representation.name)
    const namespace = await initializeCacheNamespace(coordination)
    const owner = await acquireEsiRequestLease(coordination, resource)
    if (!owner) throw new Error('owner was not acquired')
    await commitEsiFence(coordination, resource, owner)
    const freshUntil = Date.now() + 250
    await cache.set(
      cacheEnvelopeKey(namespace, resource),
      JSON.stringify({
        version: 3,
        representationVersion: composeEnvelopeRepresentationVersion(
          resource.representationVersion,
          resource.representationName,
        ),
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
    const fetch = vi.fn().mockResolvedValue(statusResponse('validated'))
    vi.stubGlobal('fetch', fetch)
    const { execute } = await import('../../../src/esi-resilience/execute.js')

    await expect(execute(representation, {})).resolves.toMatchObject({
      data: { name: 'cached' },
      source: 'cache',
    })
    expect(fetch).not.toHaveBeenCalled()

    await wait(300)
    vi.resetModules()
    const nextRepresentation = await statusRepresentation()
    const { execute: executeNext } = await import('../../../src/esi-resilience/execute.js')
    await expect(executeNext(nextRepresentation, {})).resolves.toMatchObject({
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
    let { execute } = await import('../../../src/esi-resilience/execute.js')

    await expect(
      execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({
      data: 10,
      source: 'esi',
    })
    vi.resetModules()
    representation = await walletRepresentation()
    ;({ execute } = await import('../../../src/esi-resilience/execute.js'))
    await expect(
      execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({
      data: 10,
      source: 'cache',
    })

    authorizationVersion = 2
    vi.resetModules()
    representation = await walletRepresentation()
    ;({ execute } = await import('../../../src/esi-resilience/execute.js'))
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
      kind: 'character-lifecycle' as const,
      characterId: 90_000_001,
      lifecycleId: '11111111-1111-4111-8111-111111111111',
      generation: 1,
    }
    const inputs = { path: { character_id: authorization.characterId } }
    const fetch = vi.fn().mockResolvedValue(esiResponse({ freelance_jobs: [] }))
    vi.stubGlobal('fetch', fetch)
    let [{ executePlatformEsiOperation }, { installedModuleEsiOperationDefinitions }] =
      await Promise.all([
        import('../../../src/esi-resilience/platform-execute.js'),
        import('../../../src/generated/platform/installed-module-esi.js'),
      ])

    await expect(
      executePlatformEsiOperation({
        operation,
        definition: installedModuleEsiOperationDefinitions[operation],
        inputs,
        authorization,
      }),
    ).resolves.toMatchObject({ data: { freelance_jobs: [] }, source: 'esi' })

    vi.resetModules()
    ;[{ executePlatformEsiOperation }, { installedModuleEsiOperationDefinitions }] =
      await Promise.all([
        import('../../../src/esi-resilience/platform-execute.js'),
        import('../../../src/generated/platform/installed-module-esi.js'),
      ])
    await expect(
      executePlatformEsiOperation({
        operation,
        definition: installedModuleEsiOperationDefinitions[operation],
        inputs,
        authorization,
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
    const { execute } = await import('../../../src/esi-resilience/execute.js')
    const owner = execute(
      representation,
      { characterId: 90_000_001, mailId: 7 },
      { subjectLifecycleId },
    )
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    vi.resetModules()
    const followerRepresentation = await mailRepresentation()
    const { execute: executeFollower } = await import('../../../src/esi-resilience/execute.js')
    const follower = executeFollower(
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

    await expect(Promise.all([owner, follower])).resolves.toEqual([
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
    const { execute } = await import('../../../src/esi-resilience/execute.js')
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
      let { execute } = await import('../../../src/esi-resilience/execute.js')

      await expect(
        execute(representation, { characterId: 90_000_001 }, { subjectLifecycleId }),
      ).resolves.toMatchObject({ data: 10, source: 'esi' })
      const namespace = await initializeCacheNamespace(coordination)
      const key = cacheEnvelopeKey(
        namespace,
        representationIdentity('wallet-balance', { characterId: 90_000_001 }, representation.name),
      )
      await expect(cache.get(key)).resolves.toContain(subjectLifecycleId)

      if (source === 'shared') {
        vi.resetModules()
        representation = await walletRepresentation()
        ;({ execute } = await import('../../../src/esi-resilience/execute.js'))
      }
      const cacheRead = vi.spyOn(cache, 'get')
      if (source === 'l1') cacheRead.mockRejectedValue(new Error('Cache Redis unavailable'))

      try {
        const formerRequest = execute(
          representation,
          { characterId: 90_000_001 },
          { subjectLifecycleId },
        )
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        if (source === 'shared') cacheRead.mockRejectedValue(new Error('Cache Redis unavailable'))
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
    let { execute } = await import('../../../src/esi-resilience/execute.js')
    await execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId })

    authorizationVersion = 2
    vi.resetModules()
    representation = await mailRepresentation()
    ;({ execute } = await import('../../../src/esi-resilience/execute.js'))
    await execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId })
    await incrementEsiResourceRevision(coordination, 'mailbox', 'character-90000001')

    vi.resetModules()
    representation = await mailRepresentation()
    ;({ execute } = await import('../../../src/esi-resilience/execute.js'))
    await expect(
      execute(representation, { characterId: 90_000_001, mailId: 7 }, { subjectLifecycleId }),
    ).resolves.toMatchObject({ data: { body: 'organized' }, source: 'esi' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('advances the mailbox revision after a registered mutation succeeds', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('7001', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const representation = await mailSendRepresentation()
    const { executeMutation } = await import('../../../src/esi-resilience/execute.js')

    await expect(
      executeMutation(
        representation,
        {
          characterId: 90_000_001,
          body: 'Body',
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
    const resource = identity(
      'mail-message',
      { characterId: 90_000_001, mailId: 7 },
      { namespace: 'mailbox', value: 0 },
    )
    const first = await acquireEsiRequestLease(coordination, resource, 40)
    if (!first) throw new Error('first owner was not acquired')
    await wait(60)
    const second = await acquireEsiRequestLease(coordination, resource, 1_000)
    if (!second) throw new Error('second owner was not acquired')

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
    if (!first) throw new Error('first owner was not acquired')
    await releaseEsiRequestLease(coordination, first)
    const second = await acquireEsiRequestLease(coordination, secondIdentity)
    if (!second) throw new Error('second owner was not acquired')

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
    if (!lease) throw new Error('lease was not acquired')
    await cache.set('disposable-envelope', 'value')
    await cache.flushdb()

    await expect(coordination.get(lease.key)).resolves.not.toBeNull()
    await expect(initializeCacheNamespace(coordination)).resolves.toBe(namespace)
  })

  test('aggregates fixed-window call rates without retaining enumerable principals', async () => {
    const now = Date.now()
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

function assertCurrentSubjectLifecycle(requestedSubjectLifecycleId: string) {
  if (requestedSubjectLifecycleId !== currentSubjectLifecycleId) throw lifecycleInvalidated
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

async function statusRepresentation() {
  const [{ operationRegistry }, { registerEsiRepresentation }, { definePublicEsiRepresentation }] =
    await Promise.all([
      import('@evespace/esi-client/operations'),
      import('../../../src/esi-resilience/representation-registry.js'),
      import('../../../src/esi-resilience/representations.js'),
    ])
  return registerEsiRepresentation(
    definePublicEsiRepresentation({
      operation: 'status',
      name: 'redis-status',
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => ({ name: data.server_version }),
    }),
  )
}

async function walletRepresentation() {
  const [
    { operationRegistry },
    { registerEsiRepresentation },
    { defineCharacterEsiRepresentation },
  ] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-resilience/representation-registry.js'),
    import('../../../src/esi-resilience/representations.js'),
  ])
  return registerEsiRepresentation(
    defineCharacterEsiRepresentation({
      operation: 'wallet-balance',
      name: 'redis-wallet-balance',
      descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    }),
  )
}

async function mailRepresentation() {
  const [
    { operationRegistry },
    { registerEsiRepresentation },
    { defineCharacterEsiRepresentation },
  ] = await Promise.all([
    import('@evespace/esi-client/operations'),
    import('../../../src/esi-resilience/representation-registry.js'),
    import('../../../src/esi-resilience/representations.js'),
  ])
  return registerEsiRepresentation(
    defineCharacterEsiRepresentation({
      operation: 'mail-message',
      name: 'redis-mail-message',
      descriptor: operationRegistry.GetCharactersCharacterIdMailMailId.transport,
      encodeRequest: (input: { characterId: number; mailId: number }) => ({
        path: { character_id: input.characterId, mail_id: input.mailId },
      }),
      map: ({ data }) => data,
    }),
  )
}

async function mailSendRepresentation() {
  const [{ operationRegistry }, { registerEsiRepresentation }, { defineCharacterEsiMutation }] =
    await Promise.all([
      import('@evespace/esi-client/operations'),
      import('../../../src/esi-resilience/representation-registry.js'),
      import('../../../src/esi-resilience/representations.js'),
    ])
  return registerEsiRepresentation(
    defineCharacterEsiMutation({
      operation: 'mail-send',
      name: 'redis-mail-send',
      descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
      encodeRequest: (input: { characterId: number; body: string; subject: string }) => ({
        path: { character_id: input.characterId },
        body: {
          approved_cost: 0,
          body: input.body,
          recipients: [{ recipient_id: 90_000_002, recipient_type: 'character' as const }],
          subject: input.subject,
        },
      }),
      map: ({ data }) => data,
    }),
  )
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
    status: 200,
    headers: {
      'cache-control': `max-age=${maximumAgeSeconds}`,
      'content-type': 'application/json',
    },
  })
}

function identity(
  operation: Parameters<typeof createEsiRepresentationIdentity>[0]['operation'],
  inputs: Readonly<Record<string, unknown>>,
  resourceRevision?: Parameters<typeof createEsiRepresentationIdentity>[0]['resourceRevision'],
) {
  return createEsiRepresentationIdentity({
    operation,
    inputs,
    compatibilityDate: '2026-08-23',
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
    operation,
    inputs,
    compatibilityDate: '2026-08-23',
    representationVersion: getEsiOperationContract(operation).representationVersion,
    representationName,
  })
}
