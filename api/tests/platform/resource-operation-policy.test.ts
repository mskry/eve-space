import type {
  PlatformCharacterResourceSubject,
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { StableOperationId } from '@evespace/esi-client/operations'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformEsiRequestError } from '../../src/esi-resilience/platform-execute.js'

const mocks = vi.hoisted(() => ({
  getCharacterAuthorizationForLifecycle: vi.fn(),
  getCharacterCacheAuthorizationForLifecycle: vi.fn(),
}))

vi.mock('../../src/auth/tokens.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/auth/tokens.js')>()),
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorizationForLifecycle,
}))
import { assertInstalledResourceDeclarations } from '../../src/platform/resource-declarations.js'
import { getEsiOperationContract } from '../../src/esi-resilience/catalog-access.js'
import { guardInstalledResourceExecution } from '../../src/platform/resource-execution-guard.js'
import { executeInstalledResourceOperation } from '../../src/platform/resource-operation-executor.js'

const identity = {
  moduleId: 'test-feature',
  resourceId: 'wallet-balance',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
  subjectId: '1404328063',
} as const

const implementation = {
  operation: 'wallet-balance',
  request: vi.fn(({ characterId }: { characterId: number }) => ({ characterId })),
  map: vi.fn(({ data }: { data: unknown }) => Number(data)),
  materialize: vi.fn().mockResolvedValue(undefined),
}
const resource = {
  moduleId: identity.moduleId,
  resourceId: identity.resourceId,
  subjectKind: 'character',
  operationId: 'wallet-balance',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation,
} as const satisfies PlatformInstalledResourceDescriptor<PlatformResourceOperationImplementation>

const batchImplementation = {
  ...implementation,
  batch: {
    mode: 'complete-observation',
    operation: 'universe-resolve-names',
    request: vi.fn((subjects: readonly PlatformCharacterResourceSubject[]) => ({
      ids: subjects.map(({ characterId }) => characterId),
    })),
    classify: vi.fn(),
  },
} as const satisfies PlatformResourceOperationImplementation

const batchResource = {
  ...resource,
  batch: { mode: 'complete-observation', operationId: 'universe-resolve-names' },
  implementation: batchImplementation,
} as const satisfies PlatformInstalledResourceDescriptor<PlatformResourceOperationImplementation>

describe('installed resource operation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCharacterCacheAuthorizationForLifecycle.mockResolvedValue({
      scopes: ['esi-wallet.read_character_wallet.v1'],
      tokenVersion: 4,
    })
  })

  test('maps platform executor wire data before returning a resource observation', async () => {
    const definition = executableDefinition('GetCharactersCharacterIdWallet')
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution('123.45', 5))
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource,
      characterId: 1404328063,
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [resource],
        guardExecution,
        definitions: { 'wallet-balance': definition },
        executeEsiOperation,
      }),
    ).resolves.toMatchObject({
      outcome: 'loaded',
      authorizationGeneration: 5,
      result: { data: 123.45 },
    })
    expect(executeEsiOperation).toHaveBeenCalledWith({
      operation: 'wallet-balance',
      definition,
      inputs: { characterId: 1404328063 },
      authorization: {
        kind: 'character-lifecycle',
        characterId: 1404328063,
        lifecycleId: identity.subjectLifecycleId,
        generation: 4,
      },
    })
    expect(implementation.map).toHaveBeenCalledWith({
      subject: {
        kind: 'character',
        characterId: 1404328063,
        lifecycleId: identity.subjectLifecycleId,
      },
      data: '123.45',
    })
  })

  test('does not resolve lifecycle token material for a fresh cached result', async () => {
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution(123.45, 4, 'cache'))
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource,
      characterId: 1404328063,
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [resource],
        guardExecution,
        definitions: { 'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet') },
        executeEsiOperation,
      }),
    ).resolves.toMatchObject({ outcome: 'loaded', authorizationGeneration: 4 })
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })

  test('rejects caller-owned conditional headers before consulting the cache', async () => {
    const executeEsiOperation = vi
      .fn()
      .mockRejectedValue(new PlatformEsiRequestError('Platform ESI request inputs are invalid'))
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource,
      characterId: 1404328063,
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [resource],
        guardExecution,
        definitions: { 'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet') },
        executeEsiOperation,
      }),
    ).rejects.toThrow('Platform resource mapping failed')
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })

  test('does not reach the executor, transport, or module implementation when disabled', async () => {
    const loadCharacterAuthorization = vi.fn()
    const guardExecution = vi.fn((executionIdentity, options) =>
      guardInstalledResourceExecution(executionIdentity, {
        ...options,
        resolveEligibility: vi.fn().mockResolvedValue({ status: 'disabled' }),
        loadCharacterCacheAuthorization: loadCharacterAuthorization,
      }),
    )

    await expect(
      executeInstalledResourceOperation(identity, { resources: [resource], guardExecution }),
    ).resolves.toEqual({ outcome: 'noop', reason: 'disabled' })
    expect(loadCharacterAuthorization).not.toHaveBeenCalled()
    expect(implementation.request).not.toHaveBeenCalled()
    expect(implementation.map).not.toHaveBeenCalled()
  })

  test('validates every installed descriptor without consulting runtime enablement', () => {
    const definitions = {
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
    }
    expect(() => assertInstalledResourceDeclarations([resource], definitions)).not.toThrow()
    expect(() =>
      assertInstalledResourceDeclarations(
        [{ ...resource, operationId: 'unregistered-module-operation' }],
        definitions,
      ),
    ).toThrow('Unregistered ESI operation: unregistered-module-operation')
    expect(() =>
      assertInstalledResourceDeclarations(
        [{ ...resource, implementation: {} } as PlatformInstalledResourceDescriptor],
        definitions,
      ),
    ).toThrow(
      'test-feature/wallet-balance must provide operation, request, map, and materialize functions',
    )
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...resource,
            implementation: { ...implementation, operation: 'wallet-transactions' },
          },
        ],
        definitions,
      ),
    ).toThrow('implements wallet-transactions instead of wallet-balance')
  })

  test('executes bounded dependent requests with the same lifecycle authorization', async () => {
    const collect = vi.fn(
      async (
        context: import('@eve-space/platform-module-contract').PlatformResourceCollectionContext<PlatformCharacterResourceSubject>,
      ): Promise<
        import('@eve-space/platform-module-contract').PlatformResourceCollectionResult<unknown>
      > => ({
        complete: false,
        data: await context.execute('wallet-balance', { characterId: 1404328063 }),
      }),
    )
    const collectingResource = { ...resource, implementation: { ...implementation, collect } }
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource: collectingResource,
      characterId: 1404328063,
      authorization: { tokenVersion: 4 },
    })
    const options = {
      resources: [collectingResource],
      guardExecution,
      definitions: { 'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet') },
      executeEsiOperation: vi.fn().mockResolvedValue(platformExecution(123, 4)),
      loadCollectionContext: vi
        .fn()
        .mockResolvedValue({ organizationVersion: 2, corporationId: 98000001 }),
      createCapabilities: vi.fn().mockReturnValue({}),
    }
    await expect(executeInstalledResourceOperation(identity, options)).resolves.toMatchObject({
      complete: false,
      organizationVersion: 2,
      authorizationGeneration: 4,
      result: { data: { data: 123 } },
    })
    expect(guardExecution).toHaveBeenCalledTimes(2)
    expect(implementation.map).not.toHaveBeenCalled()
    collect.mockImplementation(async (context) => {
      await context.execute('undeclared', {})
      return { complete: false, data: null }
    })
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow('undeclared')
    collect.mockImplementation(async (context) => ({
      complete: true,
      data: await context.execute('wallet-balance', { path: { character_id: 9999 } }),
    }))
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'character is outside',
    )
    collect.mockImplementation(async (context) => ({
      complete: true,
      data: await context.execute('wallet-balance', { path: { corporation_id: 9999 } }),
    }))
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'corporation is outside',
    )
    collect.mockImplementation(async (context) => {
      for (let i = 0; i < 33; i++) await context.execute('wallet-balance', {})
      return { complete: false, data: null }
    })
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'budget exceeded',
    )
    collect.mockImplementation(async (context) => ({
      complete: true,
      data: await context.execute('wallet-balance', {}),
    }))
    options.executeEsiOperation.mockResolvedValue(platformExecution(123, 5))
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'authority changed',
    )
  })

  test('requires batch descriptors and implementations to match a public set operation', () => {
    const definitions = {
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
      'public-character': executableDefinition('GetCharactersDetail'),
    }
    expect(() => assertInstalledResourceDeclarations([batchResource], definitions)).not.toThrow()
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...batchResource,
            batch: { ...batchResource.batch, operationId: 'wallet-balance' },
            implementation: {
              ...batchImplementation,
              batch: { ...batchImplementation.batch, operation: 'wallet-balance' },
            },
          },
        ],
        definitions,
      ),
    ).toThrow('batch operation wallet-balance must use public authorization')
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...batchResource,
            batch: { ...batchResource.batch, operationId: 'public-character' },
            implementation: {
              ...batchImplementation,
              batch: { ...batchImplementation.batch, operation: 'public-character' },
            },
          },
        ],
        definitions,
      ),
    ).toThrow('batch operation public-character must use set identity')
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...batchResource,
            implementation: {
              ...batchImplementation,
              batch: { ...batchImplementation.batch, mode: 'change-hint' },
            },
          },
        ],
        definitions,
      ),
    ).toThrow('implements batch mode change-hint instead of complete-observation')
    expect(() =>
      assertInstalledResourceDeclarations(
        [{ ...batchResource, implementation } as PlatformInstalledResourceDescriptor],
        definitions,
      ),
    ).toThrow('must declare matching batch descriptor and implementation')
  })
})

function executableDefinition<SdkOperation extends StableOperationId>(
  sdkOperationId: SdkOperation,
) {
  return {
    sdkOperationId,
    descriptor: {} as never,
    contract: getEsiOperationContract(
      sdkOperationId === 'GetCharactersCharacterIdWallet'
        ? 'wallet-balance'
        : sdkOperationId === 'PostUniverseNames'
          ? 'universe-resolve-names'
          : 'public-character',
    ),
  } satisfies PlatformExecutableEsiOperationDefinition
}

function cached(data: unknown) {
  return {
    data,
    cachedUntil: '2026-08-26T15:00:00.000Z',
    validatedAt: '2026-08-26T14:58:00.000Z',
    source: 'esi' as const,
    stale: false,
    quota: {},
  }
}

function platformExecution(
  data: unknown,
  authorizationGeneration: number,
  source: 'esi' | 'cache' = 'esi',
) {
  return {
    ...cached(data),
    source,
    authorizationGeneration,
  }
}
