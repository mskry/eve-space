import { operationRegistry } from '@evespace/esi-client/operations'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquirePermit: vi.fn(),
  authorize: vi.fn(),
  authorizeCache: vi.fn(),
  cacheGet: vi.fn(),
  cacheDelete: vi.fn(),
  cacheSet: vi.fn(),
  callOperation: vi.fn(),
  clientOptions: vi.fn(),
  incrementRevision: vi.fn(),
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
  acquireEsiRequestLease: vi.fn().mockResolvedValue(undefined),
  commitEsiFence: vi.fn(),
  getCommittedEsiFence: vi.fn().mockResolvedValue(undefined),
  getEsiRequestLeaseTtl: vi.fn().mockResolvedValue(0),
  getEsiResourceRevision: vi.fn().mockResolvedValue(0),
  incrementEsiResourceRevision: mocks.incrementRevision,
  initializeCacheNamespace: vi.fn().mockRejectedValue(new Error('coordination unavailable')),
  releaseEsiRequestLease: vi.fn(),
  renewEsiRequestLease: vi.fn(),
}))
vi.mock('../../src/esi-resilience/permits.js', () => ({
  acquireEsiRequestPermit: mocks.acquirePermit,
}))
vi.mock('../../src/esi-resilience/transport.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-resilience/transport.js')>()),
  createRawEsiTransport: vi.fn(() => vi.fn()),
  getCoordinationConnection: () => ({}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ accessToken: 'access-token', tokenVersion: 1 })
  mocks.authorizeCache.mockResolvedValue({ tokenVersion: 1 })
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheDelete.mockResolvedValue(1)
  mocks.cacheSet.mockResolvedValue('OK')
  mocks.incrementRevision.mockResolvedValue(1)
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
      validateResponses: false,
    })
  })

  test('executes only a registered catalog mutation with both SDK gates before revision advance', async () => {
    const sequence: string[] = []
    mocks.callOperation.mockResolvedValue(responseWith(7001))
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
    expect(sequence).toEqual(['map', 'revision'])
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
    const representation = registerEsiRepresentation(
      defineCharacterEsiRepresentation({
        operation: 'wallet-balance',
        name: 'wallet-revalidation-fixture',
        descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
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
        map: ({ data }) => data,
      }),
    )

    await expect(executeMutation(representation, { characterId: 1 })).rejects.toBe(failure)
    expect(mocks.callOperation).toHaveBeenCalledOnce()
    expect(mocks.incrementRevision).toHaveBeenCalledWith(
      expect.anything(),
      'mailbox',
      'character-1',
    )
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
