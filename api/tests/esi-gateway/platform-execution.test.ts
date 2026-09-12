import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  authorizeCache: vi.fn(),
  callOperation: vi.fn(),
  clientOptions: vi.fn(),
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
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorization: vi.fn(),
  getCharacterAuthorizationForLifecycle: mocks.authorize,
  getCharacterCacheAuthorization: vi.fn(),
  getCharacterCacheAuthorizationForLifecycle: mocks.authorizeCache,
}))
vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({ get: vi.fn(), set: vi.fn() }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/coordination.js', () => ({
  acquireEsiRequestLease: vi.fn().mockResolvedValue(undefined),
  commitEsiFence: vi.fn(),
  getCommittedEsiFence: vi.fn(),
  getEsiRequestLeaseTtl: vi.fn(),
  getEsiResourceRevision: vi.fn().mockResolvedValue(0),
  incrementEsiResourceRevision: vi.fn(),
  initializeCacheNamespace: vi.fn().mockRejectedValue(new Error('coordination unavailable')),
  releaseEsiRequestLease: vi.fn(),
  renewEsiRequestLease: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/permits.js', () => ({
  acquireEsiRequestPermit: vi.fn(),
}))
vi.mock('../../src/esi-gateway/internal/coordination-connection.js', () => ({
  getCoordinationConnection: () => ({}),
}))
vi.mock('../../src/esi-gateway/internal/transport.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/esi-gateway/internal/transport.js')>()),
  createRawEsiTransport: vi.fn(() => vi.fn()),
}))

import { installedModuleEsiOperationDefinitions } from '../../src/generated/platform/installed-module-esi.js'
import {
  executePlatformEsiOperation,
  PlatformEsiRequestError,
} from '../../src/esi-gateway/platform-execution.js'
import { closeProductionEsiExecutionRuntime } from '../../src/esi-gateway/runtime-lifecycle.js'

const characterId = 1_404_328_063
const lifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
const characterOperation = 'organization-activity-character-jobs'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ accessToken: 'private-token', tokenVersion: 5 })
  mocks.authorizeCache.mockResolvedValue({ tokenVersion: 5 })
  mocks.callOperation.mockResolvedValue({
    data: { freelance_jobs: [{ id: 'job-one' }] },
    meta: { status: 200, headers: {} },
  })
})

describe('platform ESI execution', () => {
  test('executes validated wire data with lifecycle authority and returns its generation', async () => {
    const definition = installedModuleEsiOperationDefinitions[characterOperation]
    const inputs = { path: { character_id: characterId } }

    await expect(
      executePlatformEsiOperation({
        operation: characterOperation,
        inputs,
        authorization: {
          kind: 'character-lifecycle',
          characterId,
          lifecycleId,
          generation: 4,
        },
      }),
    ).resolves.toMatchObject({
      data: { freelance_jobs: [{ id: 'job-one' }] },
      authorizationGeneration: 5,
      source: 'esi',
    })
    expect(mocks.authorize).toHaveBeenCalledWith(
      characterId,
      lifecycleId,
      'esi-characters.read_freelance_jobs.v1',
    )
    expect(mocks.clientOptions).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      requestTimeoutMs: 30_000,
      token: 'private-token',
      validateResponses: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledWith(definition.sdkOperationId, inputs)
  })

  test('returns null authorization generation for public operations', async () => {
    const operation = 'organization-activity-campaign-list'
    mocks.callOperation.mockResolvedValueOnce({
      data: { campaigns: [] },
      meta: { status: 200, headers: {} },
    })

    await expect(
      executePlatformEsiOperation({
        operation,
        inputs: {},
        authorization: { kind: 'public' },
      }),
    ).resolves.toMatchObject({ data: { campaigns: [] }, authorizationGeneration: null })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  test.each(['IF-NONE-MATCH', 'if-modified-since'])(
    'rejects caller-supplied %s before network activity',
    async (headerName) => {
      const operation = 'organization-activity-campaign-list'
      const execution = executePlatformEsiOperation({
        operation,
        inputs: { headers: { [headerName]: 'caller-value' } },
        authorization: { kind: 'public' },
      })

      await expect(execution).rejects.toBeInstanceOf(PlatformEsiRequestError)
      expect(mocks.clientOptions).not.toHaveBeenCalled()
      expect(mocks.callOperation).not.toHaveBeenCalled()
    },
  )

  test('ignores a forged definition because platform execution resolves the canonical binding', async () => {
    const operation = 'organization-activity-campaign-list'
    const canonical = installedModuleEsiOperationDefinitions[operation]
    const forged = { ...canonical, sdkOperationId: 'GetStatus' }

    await closeProductionEsiExecutionRuntime()
    await executePlatformEsiOperation({
      operation,
      inputs: {},
      authorization: { kind: 'public' },
      definition: forged,
    } as never)

    expect(mocks.callOperation).toHaveBeenCalledWith(canonical.sdkOperationId, {})
  })

  test('rejects authorization-kind mismatches before network activity', async () => {
    const operation = 'organization-activity-campaign-list'

    await expect(
      executePlatformEsiOperation({
        operation,
        inputs: {},
        authorization: {
          kind: 'character-lifecycle',
          characterId,
          lifecycleId,
          generation: 4,
        },
      }),
    ).rejects.toThrow('Public platform ESI operation received character authority')
    expect(mocks.callOperation).not.toHaveBeenCalled()
  })

  test('rejects an unregistered operation before SDK construction or network activity', async () => {
    await expect(
      executePlatformEsiOperation({
        operation: 'not-a-registered-operation' as never,
        inputs: {},
        authorization: { kind: 'public' },
      }),
    ).rejects.toThrow('Unregistered ESI operation')
    expect(mocks.clientOptions).not.toHaveBeenCalled()
    expect(mocks.callOperation).not.toHaveBeenCalled()
  })
})
