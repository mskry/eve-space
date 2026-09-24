import { EsiTransportError } from '@evespace/esi-client'
import { operationRegistry } from '@evespace/esi-client/operations'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

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
    release: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn().mockResolvedValue(true),
    ttlMs: 30_000,
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
        cache: { cacheControl: 'max-age=60', maxAgeSeconds: 60 },
        errorLimit: { remaining: 99, reset: 45 },
        headers: {},
        routeRateLimit: { group: 'status', limit: 100, remaining: 98, used: 2 },
        status: 200,
      },
    })
    const status = createPublicEsiRead({
      cacheSchema: z.object({ playerCount: z.number() }),
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => ({ playerCount: data.players }),
      name: 'callable-status',
      operation: 'status',
    })

    await expect(status.execute(undefined)).resolves.toStrictEqual({
      cachedUntil: '2026-09-01T11:01:00.000Z',
      data: { playerCount: 12 },
      quota: {
        errorRemaining: 99,
        errorResetSeconds: 45,
        group: 'status',
        limit: '100',
        remaining: 98,
        used: 2,
      },
      source: 'esi',
      stale: false,
      validatedAt: '2026-09-01T11:00:00.000Z',
    })
    expect(status.operation).toBe('status')
    expect(status.requiredScope).toBeNull()
    expect(Object.isFrozen(status)).toBe(true)
    expect(Object.keys(status).toSorted()).toStrictEqual(['execute', 'operation', 'requiredScope'])
  })

  test('forwards public read cancellation without encoding the signal into the request', async () => {
    const cancellation = new Error('cancelled')
    const controller = new AbortController()
    controller.abort(cancellation)
    const status = createPublicEsiRead({
      cacheSchema: operationRegistry.GetStatus.responseSchema,
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: (_input: { signal?: AbortSignal }) => ({}),
      map: ({ data }) => data,
      name: 'callable-status-cancellation',
      operation: 'status',
    })

    await expect(status.execute({ signal: controller.signal })).rejects.toBe(cancellation)
    expect(mocks.callOperation).not.toHaveBeenCalled()
  })

  test('executes a character read with its exact catalog-derived scope', async () => {
    mocks.callOperation.mockResolvedValue(responseWith({ skills: [], total_sp: 25 }))
    const skills = createCharacterEsiRead({
      cacheSchema: z.object({ totalSp: z.number() }),
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => ({ totalSp: data.total_sp }),
      name: 'callable-skills',
      operation: 'skills',
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
      cacheSchema: z.number(),
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data.total_sp,
      name: 'callable-skills-authorization-rejection',
      operation: 'skills',
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
      cacheSchema: z.object({ id: z.number(), name: z.string() }),
      descriptor: operationRegistry.GetCharactersDetail.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => ({ id: 9, name: data.name }),
      name: 'callable-character-recovery',
      operation: 'public-character',
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
        cache: { cacheControl: 'max-age=60', maxAgeSeconds: 60 },
        headers: {},
        status: 200,
      },
    })
    const wallet = createCharacterEsiRead({
      cacheSchema: operationRegistry.GetCharactersCharacterIdWallet.responseSchema,
      descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
      name: 'callable-wallet-metadata',
      operation: 'wallet-balance',
    })
    const input = { characterId: 7, subjectLifecycleId: lifecycleId }

    await wallet.execute(input)
    vi.setSystemTime(staleTime)
    mocks.callOperation.mockRejectedValueOnce(
      new EsiTransportError({
        cause: new Error('network unavailable'),
        operationId: 'GetCharactersCharacterIdWallet',
        phase: 'request',
        reason: 'network',
      }),
    )
    await expect(wallet.execute(input)).resolves.toStrictEqual({
      authorizationGeneration: 1,
      cachedUntil: '2026-09-02T11:01:00.000Z',
      data: 10,
      quota: {},
      refreshFailureClass: 'esi-unavailable',
      source: 'cache',
      stale: true,
      validatedAt: '2026-09-02T11:00:00.000Z',
    })

    mocks.callOperation.mockRejectedValueOnce(new EsiQuotaError(30, staleTime))
    await expect(wallet.execute(input)).resolves.toMatchObject({
      data: 10,
      quota: {},
      refreshFailureClass: 'esi-cooldown',
      retryAt: '2026-09-02T11:01:30.000Z',
      source: 'cache',
      stale: true,
    })
  })

  test('executes a character mutation with both confirmations hidden behind the factory', async () => {
    mocks.callOperation.mockResolvedValue(responseWith(7001))
    const sendMail = createCharacterEsiMutation({
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
      name: 'callable-mail-send',
      operation: 'mail-send',
    })

    await expect(
      sendMail.execute({ characterId: 7, subject: 'Hello', subjectLifecycleId: lifecycleId }),
    ).resolves.toBe(7001)
    expect(sendMail.requiredScope).toBe('esi-mail.send_mail.v1')
    expect(mocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({ allowGenericMutations: true }),
    )
    expect(mocks.callOperation).toHaveBeenCalledWith(
      'PostCharactersCharacterIdMail',
      {
        body: { approved_cost: 0, body: '', recipients: [], subject: 'Hello' },
        path: { character_id: 7 },
      },
      { confirmMutation: true },
    )
  })

  test('rejects invalid definitions atomically and rejects duplicate names', () => {
    expect(() =>
      createCharacterEsiRead({
        cacheSchema: operationRegistry.GetCharactersCharacterIdAttributes.responseSchema,
        descriptor: { ...operationRegistry.GetCharactersCharacterIdAttributes.transport },
        encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
        name: 'callable-attributes',
        operation: 'attributes',
      }),
    ).toThrow('does not bind the registered SDK descriptor')

    const attributes = createCharacterEsiRead({
      cacheSchema: operationRegistry.GetCharactersCharacterIdAttributes.responseSchema,
      descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
      encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
      name: 'callable-attributes',
      operation: 'attributes',
    })
    expect(attributes.requiredScope).toBe('esi-skills.read_skills.v1')

    expect(() =>
      createCharacterEsiRead({
        cacheSchema: operationRegistry.GetCharactersCharacterIdAttributes.responseSchema,
        descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
        encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
        name: 'callable-attributes',
        operation: 'attributes',
      }),
    ).toThrow('representation callable-attributes is already registered')
  })

  test('rejects authorization, execution, operation, and descriptor inconsistencies', () => {
    expect(() =>
      createPublicEsiRead({
        cacheSchema: operationRegistry.GetCharactersCharacterIdSkills.responseSchema,
        descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
        encodeRequest: () => ({ path: { character_id: 1 } }),
        map: ({ data }) => data,
        name: 'callable-skills-public',
        operation: 'skills' as never,
      }),
    ).toThrow('declares public authorization but operation skills requires character')

    expect(() =>
      createCharacterEsiMutation({
        descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
        encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
          path: { character_id: input.characterId },
        }),
        map: ({ data }) => data,
        name: 'callable-skills-mutation',
        operation: 'skills' as never,
      }),
    ).toThrow(
      'declares mutation execution but SDK operation GetCharactersCharacterIdSkills is read',
    )

    expect(() =>
      createPublicEsiRead({
        cacheSchema: operationRegistry.GetStatus.responseSchema,
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
        name: 'callable-unknown',
        operation: 'not-an-operation' as never,
      }),
    ).toThrow('references unregistered ESI operation not-an-operation')

    expect(() =>
      createPublicEsiRead({
        cacheSchema: operationRegistry.GetStatus.responseSchema,
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
        name: 'callable-wrong-descriptor',
        operation: 'universe-races',
      }),
    ).toThrow('binds SDK operation GetStatus instead of GetUniverseRaces')
  })
})

function responseWith<Data>(data: Data) {
  return { data, meta: { headers: {}, status: 200 } }
}
