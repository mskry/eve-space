import { operationRegistry } from '@evespace/esi-client/operations'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  acquirePermit: vi.fn(),
  authorize: vi.fn(),
  authorizeCache: vi.fn(),
  cacheGet: vi.fn(),
  cacheDelete: vi.fn(),
  cacheSet: vi.fn(),
  callOperation: vi.fn(),
  clientOptions: vi.fn(),
  commitFence: vi.fn(),
  incrementRevision: vi.fn(),
  initializeNamespace: vi.fn(),
  getLeaseTtl: vi.fn(),
  releaseLease: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    constructor(options: unknown) {
      mocks.clientOptions(options)
    }

    callOperation(...arguments_: unknown[]) {
      return mocks.callOperation(...arguments_)
    }
  },
}))
vi.mock('../../src/auth/tokens.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/auth/tokens.js')>()),
  getCharacterAuthorization: mocks.authorize,
  getCharacterCacheAuthorization: mocks.authorizeCache,
}))
vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    del: mocks.cacheDelete,
    get: mocks.cacheGet,
    set: mocks.cacheSet,
  }),
}))
vi.mock('../../src/esi-resilience/coordination.js', () => ({
  acquireEsiRequestLease: mocks.acquireLease,
  commitEsiFence: mocks.commitFence,
  getCommittedEsiFence: vi.fn().mockResolvedValue(undefined),
  getEsiRequestLeaseTtl: mocks.getLeaseTtl,
  getEsiResourceRevision: vi.fn().mockResolvedValue(0),
  incrementEsiResourceRevision: mocks.incrementRevision,
  initializeCacheNamespace: mocks.initializeNamespace,
  releaseEsiRequestLease: mocks.releaseLease,
  renewEsiRequestLease: vi.fn(),
}))
vi.mock('../../src/esi-resilience/permits.js', () => ({
  acquireEsiRequestPermit: mocks.acquirePermit,
}))
vi.mock('../../src/esi-resilience/coordination-connection.js', () => ({
  getCoordinationConnection: () => ({}),
}))
vi.mock('../../src/esi-resilience/transport.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-resilience/transport.js')>()),
  createRawEsiTransport: vi.fn(() => vi.fn()),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.acquireLease.mockResolvedValue(undefined)
  mocks.authorize.mockResolvedValue({ accessToken: 'access-token', tokenVersion: 1 })
  mocks.authorizeCache.mockResolvedValue({ tokenVersion: 1 })
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheDelete.mockResolvedValue(1)
  mocks.cacheSet.mockResolvedValue('OK')
  mocks.commitFence.mockResolvedValue(false)
  mocks.incrementRevision.mockResolvedValue(1)
  mocks.initializeNamespace.mockRejectedValue(new Error('coordination unavailable'))
  mocks.getLeaseTtl.mockResolvedValue(0)
  mocks.releaseLease.mockResolvedValue(true)
  mocks.acquirePermit.mockResolvedValue({
    ttlMs: 30_000,
    release: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn().mockResolvedValue(true),
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ESI representation execution', () => {
  test('owns character authorization, SDK dispatch, revalidation, transport, and mapping', async () => {
    const response = responseWith({ total_sp: 1, skills: [] })
    mocks.callOperation.mockResolvedValue(response)
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn(({ data }) => ({ totalSp: data.total_sp }))
    const representation = registerEsiRepresentation(
      defineCharacterEsiRepresentation({
        operation: 'skills',
        name: 'skills-execute-fixture',
        descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
        }),
        map,
      }),
    )

    await expect(execute(representation, { characterId: 1 })).resolves.toMatchObject({
      data: { totalSp: 1 },
      source: 'esi',
    })

    expect(mocks.authorizeCache).toHaveBeenCalledWith(1, 'esi-skills.read_skills.v1')
    expect(mocks.authorize).toHaveBeenCalledWith(1, 'esi-skills.read_skills.v1')
    expect(mocks.clientOptions).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      requestTimeoutMs: 30_000,
      token: 'access-token',
      validateResponses: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledWith('GetCharactersCharacterIdSkills', {
      path: { character_id: 1 },
    })
    expect(map).toHaveBeenCalledWith(response, { characterId: 1 })
  })

  test('executes public representations without resolving character authorization', async () => {
    mocks.callOperation.mockResolvedValue(
      responseWith([{ category: 'character', id: 1, name: 'Pilot' }]),
    )
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'universe-resolve-names',
        name: 'universe-names-execute-fixture',
        descriptor: operationRegistry.PostUniverseNames.transport,
        encodeRequest: (input: { body: number[] }) => input,
        map: ({ data }) => data,
      }),
    )

    await expect(execute(representation, { body: [1] })).resolves.toMatchObject({
      data: [{ category: 'character', id: 1, name: 'Pilot' }],
    })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.clientOptions).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      requestTimeoutMs: 30_000,
      validateResponses: true,
    })
  })

  test('preserves the catalog response-validation exception during registered execution', async () => {
    mocks.callOperation.mockResolvedValue(responseWith([]))
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'universe-bloodlines',
        name: 'bloodlines-validation-fixture',
        descriptor: operationRegistry.GetUniverseBloodlines.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    )

    await execute(representation, undefined)

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      requestTimeoutMs: 30_000,
      validateResponses: false,
    })
  })

  test('executes a registered mutation, advances its revision, then maps the result', async () => {
    const sequence: string[] = []
    mocks.callOperation.mockImplementation(async () => {
      sequence.push('upstream')
      return responseWith(7001)
    })
    mocks.incrementRevision.mockImplementation(async () => {
      sequence.push('revision')
      return 1
    })
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { executeMutation } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      defineCharacterEsiMutation({
        operation: 'mail-send',
        name: 'mail-send-execute-fixture',
        descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
          body: { approved_cost: 0, body: '', recipients: [], subject: '' },
        }),
        map: ({ data }) => {
          sequence.push('map')
          return data
        },
      }),
    )

    await expect(executeMutation(representation, { characterId: 1 })).resolves.toBe(7001)
    expect(mocks.clientOptions).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      requestTimeoutMs: 30_000,
      token: 'access-token',
      validateResponses: true,
      allowGenericMutations: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledWith(
      'PostCharactersCharacterIdMail',
      {
        path: { character_id: 1 },
        body: { approved_cost: 0, body: '', recipients: [], subject: '' },
      },
      { confirmMutation: true },
    )
    expect(sequence).toEqual(['upstream', 'revision', 'map'])
  })

  test('does not retry or publish an asynchronously rejected mapping', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { EsiTransportError } = await import('../../src/esi-resilience/transport.js')
    const mapperError = new EsiTransportError(new Error('canonical mapping failed'), 503)
    const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 30_000 }
    mocks.initializeNamespace.mockResolvedValue('namespace-mapper-failure')
    mocks.acquireLease.mockResolvedValue(lease)
    mocks.callOperation.mockResolvedValue(responseWith({ players: 1 }))
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn(async () => {
      await Promise.resolve()
      throw mapperError
    })
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-mapper-failure-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map,
      }),
    )

    const pending = execute(representation, undefined).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1_500)
    const failure = await pending

    expect(failure).toBe(mapperError)
    expect(mocks.callOperation).toHaveBeenCalledOnce()
    expect(map).toHaveBeenCalledOnce()
    expect(mocks.acquireLease).toHaveBeenCalledOnce()
    expect(mocks.commitFence).not.toHaveBeenCalled()
    expect(mocks.cacheSet).not.toHaveBeenCalled()
  })

  test('awaits asynchronous canonical mapping exactly once', async () => {
    mocks.callOperation.mockResolvedValue(responseWith({ players: 1 }))
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn(async ({ data }: { data: { players: number } }) => {
      await Promise.resolve()
      return { playerCount: data.players }
    })
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-async-mapper-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map,
      }),
    )

    await expect(execute(representation, undefined)).resolves.toMatchObject({
      data: { playerCount: 1 },
    })
    expect(map).toHaveBeenCalledOnce()
  })

  test('does not replay an outer request when a nested resilient call exhausts retries', async () => {
    vi.useFakeTimers()
    const { EsiTransportError } = await import('../../src/esi-resilience/transport.js')
    const nestedFailure = new EsiTransportError(new Error('nested delivery failed'))
    const mapperFailure = new EsiTransportError(new Error('nested mapping dependency failed'))
    mocks.callOperation.mockImplementation((operationId: string) => {
      if (operationId === 'GetStatus') return responseWith({ players: 1 })
      return Promise.reject(nestedFailure)
    })
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const nested = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'universe-races',
        name: 'races-nested-mapper-fixture',
        descriptor: operationRegistry.GetUniverseRaces.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    )
    const outer = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-outer-mapper-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: async ({ data }) => {
          try {
            await execute(nested, undefined)
          } catch {
            throw mapperFailure
          }
          return data
        },
      }),
    )

    const pending = execute(outer, undefined).catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toBe(mapperFailure)
    expect(
      mocks.callOperation.mock.calls.filter(([operationId]) => operationId === 'GetStatus'),
    ).toHaveLength(1)
    expect(
      mocks.callOperation.mock.calls.filter(([operationId]) => operationId === 'GetUniverseRaces'),
    ).toHaveLength(3)
  })

  test('does not serve retained public data when canonical mapping fails', async () => {
    vi.useFakeTimers()
    const mapperError = Object.assign(new Error('refresh mapping failed'), {
      status: 429,
      metadata: { headers: { 'retry-after': '30' } },
    })
    mocks.callOperation.mockResolvedValue({
      data: { players: 1 },
      meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=1' } },
    })
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { EsiQuotaError } = await import('../../src/esi-resilience/cooldowns.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn().mockResolvedValueOnce({ playerCount: 1 }).mockRejectedValueOnce(mapperError)
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-stale-mapper-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map,
      }),
    )

    await execute(representation, undefined)
    await vi.advanceTimersByTimeAsync(1_001)

    const failure = await execute(representation, undefined).catch((error: unknown) => error)

    expect(failure).toBe(mapperError)
    expect(failure).not.toBeInstanceOf(EsiQuotaError)
    expect(mocks.callOperation).toHaveBeenCalledTimes(2)
    expect(map).toHaveBeenCalledTimes(2)
  })

  test('retries an idempotent registered read with bounded attempts', async () => {
    vi.useFakeTimers()
    const { EsiTransportError } = await import('../../src/esi-resilience/transport.js')
    mocks.callOperation
      .mockRejectedValueOnce(new EsiTransportError(new Error('network unavailable')))
      .mockRejectedValueOnce(new EsiTransportError(new Error('response terminated'), 503))
      .mockResolvedValueOnce(responseWith({ players: 1 }))
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-retry-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    )

    const pending = execute(representation, undefined)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toMatchObject({ data: { players: 1 }, source: 'esi' })
    expect(mocks.callOperation).toHaveBeenCalledTimes(3)
  })

  test('aborts request-collapse polling without starting an upstream request', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    mocks.initializeNamespace.mockResolvedValue('namespace-collapse-cancellation')
    mocks.acquireLease.mockResolvedValue(undefined)
    mocks.getLeaseTtl.mockResolvedValue(15_000)
    const controller = new AbortController()
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-collapse-cancellation-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    )

    const pending = execute(representation, undefined, controller.signal)
    await vi.waitFor(() => expect(mocks.getLeaseTtl).toHaveBeenCalledOnce())
    controller.abort()

    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(mocks.callOperation).not.toHaveBeenCalled()
    vi.setSystemTime(3_000)
  })

  test('aborts an idempotent retry delay before another upstream attempt', async () => {
    vi.useFakeTimers()
    const { EsiTransportError } = await import('../../src/esi-resilience/transport.js')
    mocks.callOperation.mockRejectedValue(new EsiTransportError(new Error('network unavailable')))
    const controller = new AbortController()
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-retry-cancellation-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    )

    const pending = execute(representation, undefined, controller.signal)
    const caught = pending.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.callOperation).toHaveBeenCalledOnce()
    controller.abort()
    await vi.runAllTimersAsync()

    await expect(caught).resolves.toBe(controller.signal.reason)
    expect(mocks.callOperation).toHaveBeenCalledOnce()
  })

  test('serves retained private data after a registered refresh encounters an outage', async () => {
    vi.useFakeTimers()
    const { EsiTransportError } = await import('../../src/esi-resilience/transport.js')
    const outage = new EsiTransportError(new Error('network unavailable'))
    mocks.callOperation
      .mockResolvedValueOnce({
        data: 10,
        meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=60' } },
      })
      .mockRejectedValue(outage)
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      defineCharacterEsiRepresentation({
        operation: 'wallet-balance',
        name: 'wallet-stale-fixture',
        descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
      }),
    )

    await execute(representation, { characterId: 1 })
    await vi.advanceTimersByTimeAsync(60_001)
    const pending = execute(representation, { characterId: 1 })
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toMatchObject({
      data: 10,
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    expect(mocks.callOperation).toHaveBeenCalledTimes(2)
  })

  test('rebinds a registered 304 response to the refreshed authorization generation', async () => {
    vi.useFakeTimers()
    mocks.authorize
      .mockReset()
      .mockResolvedValueOnce({ accessToken: 'token-1', tokenVersion: 1 })
      .mockResolvedValueOnce({ accessToken: 'token-2', tokenVersion: 2 })
    mocks.authorizeCache
      .mockReset()
      .mockResolvedValueOnce({ tokenVersion: 1 })
      .mockResolvedValueOnce({ tokenVersion: 1 })
      .mockResolvedValue({ tokenVersion: 2 })
    const notModified = Object.assign(new Error('Not modified'), {
      status: 304,
      metadata: {
        status: 304,
        headers: {},
        cache: { cacheControl: 'max-age=60', etag: 'wallet-v1' },
      },
    })
    mocks.callOperation
      .mockResolvedValueOnce({
        data: 10,
        meta: {
          status: 200,
          headers: {},
          cache: { cacheControl: 'max-age=1', etag: 'wallet-v1' },
        },
      })
      .mockRejectedValueOnce(notModified)
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const map304 = vi.fn(({ data }) => data)
    const representation = registerEsiRepresentation(
      defineCharacterEsiRepresentation({
        operation: 'wallet-balance',
        name: 'wallet-revalidation-fixture',
        descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
        }),
        map: map304,
      }),
    )

    await execute(representation, { characterId: 1 })
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(execute(representation, { characterId: 1 })).resolves.toMatchObject({
      data: 10,
      source: 'not-modified',
    })
    await expect(execute(representation, { characterId: 1 })).resolves.toMatchObject({
      data: 10,
      source: 'cache',
    })

    expect(mocks.callOperation).toHaveBeenCalledTimes(2)
    expect(map304).toHaveBeenCalledOnce()
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
    expect(mocks.authorizeCache).toHaveBeenCalledTimes(4)
  })

  test('advances the mailbox revision after an ambiguous registered mutation failure', async () => {
    const { EsiTransportError } = await import('../../src/esi-resilience/transport.js')
    const failure = new EsiTransportError(new Error('delivery unknown'))
    mocks.callOperation.mockRejectedValue(failure)
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { executeMutation } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn(({ data }) => data)
    const representation = registerEsiRepresentation(
      defineCharacterEsiMutation({
        operation: 'mail-send',
        name: 'mail-send-ambiguous-fixture',
        descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
          body: {
            approved_cost: 0,
            body: '',
            recipients: [{ recipient_id: 2, recipient_type: 'character' as const }],
            subject: '',
          },
        }),
        map,
      }),
    )

    await expect(executeMutation(representation, { characterId: 1 })).rejects.toBe(failure)
    expect(mocks.callOperation).toHaveBeenCalledOnce()
    expect(mocks.incrementRevision).toHaveBeenCalledWith(
      expect.anything(),
      'mailbox',
      'character-1',
    )
    expect(map).not.toHaveBeenCalled()
  })

  test('advances the mutation revision before propagating a distinct mapper failure', async () => {
    const sequence: string[] = []
    const mapperError = new Error('mutation mapping failed')
    mocks.callOperation.mockImplementation(async () => {
      sequence.push('upstream')
      return responseWith(7001)
    })
    mocks.incrementRevision.mockImplementation(async () => {
      sequence.push('revision')
      return 1
    })
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { executeMutation } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn(async () => {
      await Promise.resolve()
      sequence.push('map')
      throw mapperError
    })
    const representation = registerEsiRepresentation(
      defineCharacterEsiMutation({
        operation: 'mail-send',
        name: 'mail-send-mapper-failure-fixture',
        descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
          body: { approved_cost: 0, body: '', recipients: [], subject: '' },
        }),
        map,
      }),
    )

    await expect(executeMutation(representation, { characterId: 1 })).rejects.toBe(mapperError)
    expect(sequence).toEqual(['upstream', 'revision', 'map'])
    expect(mocks.callOperation).toHaveBeenCalledOnce()
    expect(mocks.incrementRevision).toHaveBeenCalledOnce()
    expect(map).toHaveBeenCalledOnce()
  })

  test('maps once before committing the fence and publishing canonical data', async () => {
    const sequence: string[] = []
    const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 30_000 }
    mocks.initializeNamespace.mockResolvedValue('namespace-one')
    mocks.acquireLease.mockResolvedValue(lease)
    mocks.callOperation.mockImplementation(async () => {
      sequence.push('upstream')
      return responseWith({ players: 1 })
    })
    mocks.commitFence.mockImplementation(async () => {
      sequence.push('fence')
      return true
    })
    mocks.cacheSet.mockImplementation(async () => {
      sequence.push('cache')
      return 'OK'
    })
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const map = vi.fn(async ({ data }) => {
      await Promise.resolve()
      sequence.push('map')
      return { playerCount: data.players }
    })
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-publication-order-fixture',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map,
      }),
    )

    await expect(execute(representation, undefined)).resolves.toMatchObject({
      data: { playerCount: 1 },
    })
    expect(sequence).toEqual(['upstream', 'map', 'fence', 'cache'])
    expect(map).toHaveBeenCalledOnce()
  })

  test.each(['IF-NONE-MATCH', 'if-modified-since'])(
    'rejects executor-owned %s before SDK construction',
    async (headerName) => {
      const { defineCharacterEsiRepresentation } =
        await import('../../src/esi-resilience/representations.js')
      const { registerEsiRepresentation } =
        await import('../../src/esi-resilience/representation-registry.js')
      const { execute } = await import('../../src/esi-resilience/execute.js')
      const representation = registerEsiRepresentation(
        defineCharacterEsiRepresentation({
          operation: 'skills',
          name: `skills-reserved-${headerName.toLowerCase()}`,
          descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
          encodeRequest: (input: { characterId: number }) =>
            ({
              path: { character_id: input.characterId },
              headers: { [headerName]: 'caller-value' },
            }) as never,
          map: ({ data }) => data,
        }),
      )

      await expect(execute(representation, { characterId: 1 })).rejects.toThrow(
        `ESI request header ${headerName} is executor-owned`,
      )
      expect(mocks.clientOptions).not.toHaveBeenCalled()
      expect(mocks.callOperation).not.toHaveBeenCalled()
    },
  )

  test('rejects an unregistered representation before network activity', async () => {
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { executeMutation } = await import('../../src/esi-resilience/execute.js')
    const representation = defineCharacterEsiMutation({
      operation: 'mail-send',
      name: 'mail-send-unregistered',
      descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
        body: { approved_cost: 0, body: '', recipients: [], subject: '' },
      }),
      map: ({ data }) => data,
    })

    await expect(executeMutation(representation, { characterId: 1 })).rejects.toThrow(
      'ESI representation mail-send-unregistered was not registered',
    )
    expect(mocks.clientOptions).not.toHaveBeenCalled()
    expect(mocks.callOperation).not.toHaveBeenCalled()
  })
})

function responseWith<Data>(data: Data) {
  return { data, meta: { status: 200, headers: {} } }
}
