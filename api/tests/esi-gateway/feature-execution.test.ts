import { EsiTransportError } from '@evespace/esi-client'
import { operationRegistry } from '@evespace/esi-client/operations'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquirePermit: vi.fn(),
  authorize: vi.fn(),
  authorizeCache: vi.fn(),
  callOperation: vi.fn(),
  clientOptions: vi.fn(),
  incrementRevision: vi.fn(),
  withAuthorization: vi.fn(),
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
  getCharacterAuthorizationForLifecycle: mocks.authorize,
  getCharacterCacheAuthorizationForLifecycle: mocks.authorizeCache,
  withCharacterAuthorizationForLifecycle: mocks.withAuthorization,
}))
vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/coordination.js', () => ({
  acquireEsiRequestLease: vi.fn().mockResolvedValue(undefined),
  commitEsiFence: vi.fn().mockResolvedValue(false),
  getCommittedEsiFence: vi.fn().mockResolvedValue(undefined),
  getEsiRequestLeaseTtl: vi.fn().mockResolvedValue(0),
  getEsiResourceRevision: vi.fn().mockResolvedValue(0),
  incrementEsiResourceRevision: mocks.incrementRevision,
  initializeCacheNamespace: vi.fn().mockRejectedValue(new Error('coordination unavailable')),
  releaseEsiRequestLease: vi.fn().mockResolvedValue(true),
  renewEsiRequestLease: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/permits.js', () => ({
  acquireEsiRequestPermit: mocks.acquirePermit,
}))
vi.mock('../../src/esi-gateway/internal/coordination-connection.js', () => ({
  getCoordinationConnection: () => ({}),
}))
vi.mock('../../src/esi-gateway/internal/transport.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-gateway/internal/transport.js')>()),
  createRawEsiTransport: vi.fn(() => vi.fn()),
}))

import { getEsiOperationContract } from '../../src/esi-gateway/internal/catalog-access.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import {
  createCharacterEsiMutation,
  createCharacterEsiRead,
  createPublicEsiRead,
} from '../../src/esi-gateway/feature-execution.js'

const lifecycleId = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.acquirePermit.mockResolvedValue({
    ttlMs: 30_000,
    release: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn().mockResolvedValue(true),
  })
  mocks.authorize.mockResolvedValue({ accessToken: 'access-token', tokenVersion: 1 })
  mocks.authorizeCache.mockResolvedValue({ tokenVersion: 1 })
  mocks.incrementRevision.mockResolvedValue(1)
  mocks.withAuthorization.mockImplementation(
    async (characterId, subjectLifecycleId, scope, operation) =>
      operation(await mocks.authorize(characterId, subjectLifecycleId, scope)),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('callable ESI feature execution', () => {
  test('executes a public read and preserves intentional result metadata', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-01T11:00:00.000Z')
    mocks.callOperation.mockResolvedValue({
      data: { players: 12 },
      meta: {
        status: 200,
        headers: {},
        cache: { cacheControl: 'max-age=60', maxAgeSeconds: 60 },
        errorLimit: { remaining: 99, reset: 45 },
        routeRateLimit: { group: 'status', limit: 100, remaining: 98, used: 2 },
      },
    })
    const status = createPublicEsiRead({
      operation: 'status',
      name: 'callable-status',
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => ({ playerCount: data.players }),
    })

    await expect(status.execute(undefined)).resolves.toStrictEqual({
      data: { playerCount: 12 },
      source: 'esi',
      validatedAt: '2026-09-01T11:00:00.000Z',
      cachedUntil: '2026-09-01T11:01:00.000Z',
      stale: false,
      quota: {
        group: 'status',
        limit: '100',
        remaining: 98,
        used: 2,
        errorRemaining: 99,
        errorResetSeconds: 45,
      },
    })
    expect(status.operation).toBe('status')
    expect(status.requiredScope).toBeNull()
    expect(Object.isFrozen(status)).toBe(true)
    expect(Object.keys(status).toSorted()).toEqual(['execute', 'operation', 'requiredScope'])
  })

  test('forwards public read cancellation without encoding the signal into the request', async () => {
    const cancellation = new Error('cancelled')
    const controller = new AbortController()
    controller.abort(cancellation)
    const status = createPublicEsiRead({
      operation: 'status',
      name: 'callable-status-cancellation',
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: (_input: { signal?: AbortSignal }) => ({}),
      map: ({ data }) => data,
    })

    await expect(status.execute({ signal: controller.signal })).rejects.toBe(cancellation)
    expect(mocks.callOperation).not.toHaveBeenCalled()
  })

  test('executes a character read with its exact catalog-derived scope', async () => {
    mocks.callOperation.mockResolvedValue(responseWith({ total_sp: 25, skills: [] }))
    const skills = createCharacterEsiRead({
      operation: 'skills',
      name: 'callable-skills',
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => ({ totalSp: data.total_sp }),
    })

    await expect(
      skills.execute({ characterId: 7, subjectLifecycleId: lifecycleId }),
    ).resolves.toMatchObject({
      data: { totalSp: 25 },
      source: 'esi',
    })
    const contract = getEsiOperationContract(skills.operation)
    expect(skills.requiredScope).toBe('esi-skills.read_skills.v1')
    expect(skills.requiredScope).toBe(
      contract.authorization.kind === 'character' ? contract.authorization.scope : undefined,
    )
    expect(mocks.authorize).toHaveBeenCalledWith(7, lifecycleId, skills.requiredScope)
  })

  test('rejects character authorization before acquiring a request permit', async () => {
    const failure = new Error('authorization unavailable')
    mocks.authorize.mockRejectedValueOnce(failure)
    const skills = createCharacterEsiRead({
      operation: 'skills',
      name: 'callable-skills-authorization-rejection',
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data.total_sp,
    })

    await expect(skills.execute({ characterId: 7, subjectLifecycleId: lifecycleId })).rejects.toBe(
      failure,
    )
    expect(mocks.callOperation).not.toHaveBeenCalled()
    expect(mocks.acquirePermit).not.toHaveBeenCalled()
  })

  test('returns a mapped recovery through the public read interface', async () => {
    mocks.callOperation.mockRejectedValue(new Error('definitive missing character'))
    const character = createPublicEsiRead({
      operation: 'public-character',
      name: 'callable-character-recovery',
      descriptor: operationRegistry.GetCharactersDetail.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => ({ id: 9, name: data.name }),
      recover: (_error, input) => ({
        data: { id: input.characterId, name: 'Unknown character' },
        meta: { status: 404, headers: {} },
      }),
    })

    await expect(character.execute({ characterId: 9 })).resolves.toMatchObject({
      data: { id: 9, name: 'Unknown character' },
      source: 'esi',
      stale: false,
    })
  })

  test('preserves stale recovery and cooldown metadata', async () => {
    vi.useFakeTimers()
    const initialTime = Date.parse('2026-09-02T11:00:00.000Z')
    const staleTime = Date.parse('2026-09-02T11:01:00.000Z')
    vi.setSystemTime(initialTime)
    mocks.callOperation.mockResolvedValueOnce({
      data: 10,
      meta: {
        status: 200,
        headers: {},
        cache: { cacheControl: 'max-age=60', maxAgeSeconds: 60 },
      },
    })
    const wallet = createCharacterEsiRead({
      operation: 'wallet-balance',
      name: 'callable-wallet-metadata',
      descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    })
    const input = { characterId: 7, subjectLifecycleId: lifecycleId }

    await wallet.execute(input)
    vi.setSystemTime(staleTime)
    mocks.callOperation.mockRejectedValueOnce(
      new EsiTransportError({
        operationId: 'GetCharactersCharacterIdWallet',
        reason: 'network',
        phase: 'request',
        cause: new Error('network unavailable'),
      }),
    )
    await expect(wallet.execute(input)).resolves.toStrictEqual({
      data: 10,
      source: 'cache',
      validatedAt: '2026-09-02T11:00:00.000Z',
      cachedUntil: '2026-09-02T11:01:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
      quota: {},
    })

    mocks.callOperation.mockRejectedValueOnce(new EsiQuotaError(30, staleTime))
    await expect(wallet.execute(input)).resolves.toMatchObject({
      data: 10,
      source: 'cache',
      stale: true,
      retryAt: '2026-09-02T11:01:30.000Z',
      refreshFailureClass: 'esi-cooldown',
      quota: {},
    })
  })

  test('executes a character mutation with both confirmations hidden behind the factory', async () => {
    mocks.callOperation.mockResolvedValue(responseWith(7001))
    const sendMail = createCharacterEsiMutation({
      operation: 'mail-send',
      name: 'callable-mail-send',
      descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
      encodeRequest: (input: {
        characterId: number
        subjectLifecycleId: string
        subject: string
      }) => ({
        path: { character_id: input.characterId },
        body: { approved_cost: 0, body: '', recipients: [], subject: input.subject },
      }),
      map: ({ data }) => data,
    })

    await expect(
      sendMail.execute({ characterId: 7, subjectLifecycleId: lifecycleId, subject: 'Hello' }),
    ).resolves.toBe(7001)
    expect(sendMail.requiredScope).toBe('esi-mail.send_mail.v1')
    expect(mocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({ allowGenericMutations: true }),
    )
    expect(mocks.callOperation).toHaveBeenCalledWith(
      'PostCharactersCharacterIdMail',
      {
        path: { character_id: 7 },
        body: { approved_cost: 0, body: '', recipients: [], subject: 'Hello' },
      },
      { confirmMutation: true },
    )
  })

  test('rejects invalid definitions atomically and rejects duplicate names', () => {
    expect(() =>
      createCharacterEsiRead({
        operation: 'attributes',
        name: 'callable-attributes',
        descriptor: { ...operationRegistry.GetCharactersCharacterIdAttributes.transport },
        encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
      }),
    ).toThrow('does not bind the registered SDK descriptor')

    const attributes = createCharacterEsiRead({
      operation: 'attributes',
      name: 'callable-attributes',
      descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    })
    expect(attributes.requiredScope).toBe('esi-skills.read_skills.v1')

    expect(() =>
      createCharacterEsiRead({
        operation: 'attributes',
        name: 'callable-attributes',
        descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
        encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
      }),
    ).toThrow('representation callable-attributes is already registered')
  })

  test('rejects authorization, execution, operation, and descriptor inconsistencies', () => {
    expect(() =>
      createPublicEsiRead({
        operation: 'skills' as never,
        name: 'callable-skills-public',
        descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
        encodeRequest: () => ({ path: { character_id: 1 } }),
        map: ({ data }) => data,
      }),
    ).toThrow('declares public authorization but operation skills requires character')

    expect(() =>
      createCharacterEsiMutation({
        operation: 'skills' as never,
        name: 'callable-skills-mutation',
        descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
        encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
      }),
    ).toThrow(
      'declares mutation execution but SDK operation GetCharactersCharacterIdSkills is read',
    )

    expect(() =>
      createPublicEsiRead({
        operation: 'not-an-operation' as never,
        name: 'callable-unknown',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    ).toThrow('references unregistered ESI operation not-an-operation')

    expect(() =>
      createPublicEsiRead({
        operation: 'universe-races',
        name: 'callable-wrong-descriptor',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    ).toThrow('binds SDK operation GetStatus instead of GetUniverseRaces')
  })
})

function responseWith<Data>(data: Data) {
  return { data, meta: { status: 200, headers: {} } }
}
