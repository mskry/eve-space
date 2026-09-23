import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  PlatformCharacterResourceSubject,
  PlatformInstalledResourceDescriptor,
  PlatformResourceCollectionContext,
  PlatformResourceCollectionResult,
  PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { StableOperationId } from '@evespace/esi-client/operations'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PlatformEsiRequestError } from '../../src/esi-gateway/platform-execution.js'
import {
  getPlatformEsiOperationDefinition,
  type PlatformEsiOperationProtocol,
} from '../../src/esi-gateway/catalog-interface.js'

const mocks = vi.hoisted(() => ({
  getCharacterAuthorizationForLifecycle: vi.fn(),
  getCharacterCacheAuthorizationForLifecycle: vi.fn(),
  resolveUniverseNamesBestEffort: vi.fn(),
}))

vi.mock('../../src/auth/tokens.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/auth/tokens.js')>()),
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorizationForLifecycle,
}))
vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNamesBestEffort: mocks.resolveUniverseNamesBestEffort,
}))
import { assertInstalledResourceDeclarations } from '../../src/platform/resource-declarations.js'
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
  mode: 'single-request',
  operation: 'wallet-balance',
  request: vi.fn(({ characterId }: { characterId: number }) => ({
    path: { character_id: characterId },
  })),
  map: vi.fn(({ data }: { data: unknown }) => Number(data)),
  materialize: vi.fn().mockResolvedValue(undefined),
} satisfies PlatformSingleRequestResourceImplementation
type WalletCollectionContext = PlatformResourceCollectionContext<
  PlatformCharacterResourceSubject,
  PlatformEsiOperationProtocol<'wallet-balance'>
>
const walletInputs = { path: { character_id: 1404328063 } } as const
const managedAuthority = {
  organizationDeploymentId: 1 as const,
  organizationVersion: 2,
  targetUserId: '22222222-2222-4222-8222-222222222222',
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  sectionId: 'wallet',
  disclosureVersion: 1,
  sectionActivationVersion: 1,
}
const resource = {
  moduleId: identity.moduleId,
  resourceId: identity.resourceId,
  subjectKind: 'character',
  operationId: 'wallet-balance',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation,
} as const satisfies PlatformInstalledResourceDescriptor

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
} as const satisfies PlatformSingleRequestResourceImplementation

const batchResource = {
  ...resource,
  batch: { mode: 'complete-observation', operationId: 'universe-resolve-names' },
  implementation: batchImplementation,
} as const satisfies PlatformInstalledResourceDescriptor

describe('installed resource operation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCharacterCacheAuthorizationForLifecycle.mockResolvedValue({
      scopes: ['esi-wallet.read_character_wallet.v1'],
      tokenVersion: 4,
    })
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({ names: new Map(), complete: true })
  })

  test('maps cached platform wire data before returning a resource observation', async () => {
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution('123.45', 5, 'cache'))
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
        executeEsiOperation,
      }),
    ).resolves.toMatchObject({
      outcome: 'loaded',
      authorizationGeneration: 5,
      result: { data: 123.45, source: 'cache' },
    })
    expect(executeEsiOperation).toHaveBeenCalledWith({
      operation: 'wallet-balance',
      inputs: walletInputs,
      authorization: {
        kind: 'character-lifecycle',
        characterId: 1404328063,
        lifecycleId: identity.subjectLifecycleId,
        generation: 4,
      },
    })
    expect(implementation.map).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: {
          kind: 'character',
          characterId: 1404328063,
          lifecycleId: identity.subjectLifecycleId,
        },
        data: '123.45',
        capabilities: { coreData: {} },
      }),
    )
  })

  test('awaits mapping with only declared core-data capabilities', async () => {
    const publishedTypeGroups = vi.fn().mockResolvedValue({ rows: [], complete: true })
    const map = vi.fn(async ({ data, capabilities }) => {
      await capabilities.coreData.publishedTypeGroups({ typeIds: [34] })
      return Number(data)
    })
    const mappedResource = {
      ...resource,
      coreDataProducts: ['published-type-groups'] as const,
      implementation: { ...implementation, map },
    }
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource: mappedResource,
      characterId: 1404328063,
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
    })
    const createMappingCapabilities = vi.fn().mockReturnValue({
      coreData: { publishedTypeGroups },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [mappedResource],
        guardExecution,
        createMappingCapabilities,
        executeEsiOperation: vi.fn().mockResolvedValue(platformExecution('123.45', 4)),
      }),
    ).resolves.toMatchObject({ result: { data: 123.45 } })
    expect(createMappingCapabilities).toHaveBeenCalledWith(mappedResource)
    expect(map.mock.calls[0]![0].capabilities).toEqual({
      coreData: { publishedTypeGroups },
    })
  })

  test('sanitizes asynchronous mapping rejection as a mapping failure', async () => {
    const map = vi.fn().mockRejectedValue(new Error('published product timed out with SQL detail'))
    const mappedResource = { ...resource, implementation: { ...implementation, map } }
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource: mappedResource,
      characterId: 1404328063,
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [mappedResource],
        guardExecution,
        executeEsiOperation: vi.fn().mockResolvedValue(platformExecution('123.45', 4)),
      }),
    ).rejects.toThrow('Platform resource mapping failed')
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
        executeEsiOperation,
      }),
    ).rejects.toThrow('Platform resource mapping failed')
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })

  test('does not reach the executor, transport, or module implementation when disabled', async () => {
    const loadCharacterAuthorization = vi.fn()
    const createCapabilities = vi.fn()
    const guardExecution = vi.fn((executionIdentity, options) =>
      guardInstalledResourceExecution(executionIdentity, {
        ...options,
        resolveEligibility: vi.fn().mockResolvedValue({ status: 'disabled' }),
        loadCharacterCacheAuthorization: loadCharacterAuthorization,
      }),
    )

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [resource],
        guardExecution,
        createCapabilities,
      }),
    ).resolves.toEqual({ outcome: 'noop', reason: 'disabled' })
    expect(loadCharacterAuthorization).not.toHaveBeenCalled()
    expect(implementation.request).not.toHaveBeenCalled()
    expect(implementation.map).not.toHaveBeenCalled()
    expect(createCapabilities).not.toHaveBeenCalled()
  })

  test('validates every installed descriptor without consulting runtime enablement', () => {
    const definitions = {
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
    }
    expect(() => assertInstalledResourceDeclarations([resource], definitions)).not.toThrow()
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...walletCollectionResource(vi.fn()),
            dependentOperationIds: ['universe-resolve-names'],
          },
        ],
        definitions,
      ),
    ).not.toThrow()
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...resource,
            operationId: 'universe-resolve-names',
            dependentOperationIds: ['wallet-balance'],
            implementation: { ...implementation, operation: 'universe-resolve-names' },
          },
        ],
        definitions,
      ),
    ).toThrow('authorization contract')
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
    ).toThrow('test-feature/wallet-balance must declare a single-request or bounded-collection')
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

    expect(() => assertInstalledResourceDeclarations([resource])).not.toThrow()
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...resource,
            subjectKind: 'deployment',
          } as unknown as PlatformInstalledResourceDescriptor,
        ],
        definitions,
      ),
    ).toThrow('Deployment resources require public operations')
    expect(() => assertInstalledResourceDeclarations([resource], {})).toThrow(
      'ESI operation wallet-balance has no executable definition',
    )

    const scopedDefinitions = Object.fromEntries(
      ['wallet-balance', 'skill-queue'].map((operationId) => [
        operationId,
        getPlatformEsiOperationDefinition(operationId),
      ]),
    )
    expect(() =>
      assertInstalledResourceDeclarations(
        [{ ...resource, dependentOperationIds: ['skill-queue'] }],
        scopedDefinitions,
      ),
    ).toThrow('authorization contract')
  })

  test('executes bounded dependent requests with the same lifecycle authorization', async () => {
    const collect = vi.fn(
      async (
        context: WalletCollectionContext,
      ): Promise<PlatformResourceCollectionResult<unknown>> => ({
        complete: false,
        data: await context.operations['wallet-balance'](walletInputs),
      }),
    )
    const collectingResource = walletCollectionResource(collect)
    const guardExecution = vi.fn().mockResolvedValue(readyCollection(collectingResource))
    const options = {
      resources: [collectingResource],
      guardExecution,
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
    expect(options.executeEsiOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'wallet-balance', inputs: walletInputs }),
    )
    expect(options.createCapabilities).toHaveBeenCalledWith(collectingResource)

    const controller = new AbortController()
    await executeInstalledResourceOperation(identity, { ...options, signal: controller.signal })
    expect(options.createCapabilities).toHaveBeenLastCalledWith(
      collectingResource,
      controller.signal,
    )

    collect.mockImplementation(async (context) => ({
      complete: true,
      data: await context.operations['wallet-balance']({ path: { character_id: 9999 } }),
    }))
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'character is outside',
    )
    collect.mockImplementation(async (context) => ({
      complete: true,
      data: await context.operations['wallet-balance']({
        path: { corporation_id: 9999 },
      } as never),
    }))
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'corporation is outside',
    )
    collect.mockImplementation(async (context) => {
      for (let i = 0; i < 33; i++) await context.operations['wallet-balance'](walletInputs)
      return { complete: false, data: null }
    })
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'budget exceeded',
    )
    collect.mockImplementation(async (context) => ({
      complete: true,
      data: await context.operations['wallet-balance'](walletInputs),
    }))
    options.executeEsiOperation.mockResolvedValue(platformExecution(123, 5))
    await expect(executeInstalledResourceOperation(identity, options)).rejects.toThrow(
      'authority changed',
    )
  })

  test('exposes only frozen descriptor-declared collection operations to untyped code', async () => {
    let operations: Readonly<Record<string, unknown>> = {}
    const collect = vi.fn(async (context: WalletCollectionContext) => {
      operations = context.operations
      const probe = context.operations as Readonly<Record<string, unknown>>
      expect(probe.undeclared).toBeUndefined()
      expect(probe.constructor).toBeUndefined()
      expect(probe.toString).toBeUndefined()
      expect(Reflect.set(probe, 'undeclared', vi.fn())).toBe(false)
      expect('execute' in context).toBe(false)
      return { complete: true, data: await context.operations['wallet-balance'](walletInputs) }
    })
    const collectingResource = {
      ...walletCollectionResource(collect),
      dependentOperationIds: ['universe-resolve-names', 'wallet-balance'],
    }
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution(123, 4))

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [collectingResource],
        guardExecution: vi.fn().mockResolvedValue(readyCollection(collectingResource)),
        executeEsiOperation,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98000001 }),
        createCapabilities: vi.fn().mockReturnValue({}),
      }),
    ).resolves.toMatchObject({ outcome: 'loaded', complete: true })
    expect(Object.isFrozen(operations)).toBe(true)
    expect(Object.getPrototypeOf(operations)).toBeNull()
    expect(Object.keys(operations).toSorted((left, right) => left.localeCompare(right))).toEqual([
      'universe-resolve-names',
      'wallet-balance',
    ])
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })

  test('rejects invalid untyped collection inputs before ESI execution', async () => {
    const collect = vi.fn(async (context: WalletCollectionContext) => ({
      complete: true,
      data: await context.operations['wallet-balance']({} as never),
    }))
    const collectingResource = walletCollectionResource(collect)
    const executeEsiOperation = vi.fn()

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [collectingResource],
        guardExecution: vi.fn().mockResolvedValue(readyCollection(collectingResource)),
        executeEsiOperation,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98000001 }),
        createCapabilities: vi.fn().mockReturnValue({}),
      }),
    ).rejects.toThrow('Platform resource mapping failed')
    expect(executeEsiOperation).not.toHaveBeenCalled()
  })

  test('treats a managed-authority change during dependent execution as obsolete', async () => {
    const collect = vi.fn(async (context: WalletCollectionContext) => ({
      complete: true,
      data: await context.operations['wallet-balance'](walletInputs),
    }))
    const collectingResource = walletCollectionResource(collect)
    const ready = { ...readyCollection(collectingResource), managedAuthority }
    const guardExecution = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({
        ...ready,
        managedAuthority: { ...managedAuthority, disclosureVersion: 2 },
      })
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution(123, 4))

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [collectingResource],
        guardExecution,
        executeEsiOperation,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98000001 }),
        createCapabilities: vi.fn().mockReturnValue({}),
      }),
    ).rejects.toThrow('authority changed')
  })

  test('retains the earliest validation time across collection requests', async () => {
    const collect = vi.fn(async (context: WalletCollectionContext) => {
      await context.operations['wallet-balance'](walletInputs)
      await context.operations['wallet-balance'](walletInputs)
      return { complete: true, data: 'collected' }
    })
    const collectingResource = walletCollectionResource(collect)
    const executeEsiOperation = vi
      .fn()
      .mockResolvedValueOnce({
        ...platformExecution(1, 4),
        validatedAt: '2026-08-26T14:59:00.000Z',
      })
      .mockResolvedValueOnce({
        ...platformExecution(2, 4),
        validatedAt: '2026-08-26T14:57:00.000Z',
      })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [collectingResource],
        guardExecution: vi.fn().mockResolvedValue(readyCollection(collectingResource)),
        executeEsiOperation,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98000001 }),
        createCapabilities: vi.fn().mockReturnValue({}),
      }),
    ).resolves.toMatchObject({
      result: { data: 'collected', validatedAt: '2026-08-26T14:57:00.000Z' },
    })
  })

  test('validates inspectable execution-mode shapes for erased implementations', () => {
    const definitions = {
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
    }
    const collection = walletCollectionResource(vi.fn())
    const validate = (candidate: unknown, dependentOperationIds?: readonly string[]) => () =>
      assertInstalledResourceDeclarations(
        [
          {
            ...resource,
            ...(dependentOperationIds ? { dependentOperationIds } : {}),
            implementation: candidate,
          } as PlatformInstalledResourceDescriptor,
        ],
        definitions,
      )

    expect(validate(implementation)).not.toThrow()
    expect(validate(collection.implementation)).not.toThrow()
    expect(validate(collection.implementation, ['universe-resolve-names'])).not.toThrow()
    expect(validate(implementation, ['universe-resolve-names'])).toThrow(
      'single-request execution cannot declare dependent operations',
    )
    expect(validate({ ...implementation, collect: vi.fn() })).toThrow(
      'single-request execution cannot provide collect',
    )
    expect(validate({ ...collection.implementation, request: vi.fn(), map: vi.fn() })).toThrow(
      'bounded-collection execution cannot provide request or map',
    )
    expect(validate({ ...collection.implementation, collect: undefined })).toThrow(
      'must provide operation, materialize, and collect for bounded-collection execution',
    )
    expect(validate({ ...implementation, map: 'not-a-function' })).toThrow(
      'must provide operation, materialize, and request and map for single-request execution',
    )
    const { mode: _mode, ...modeless } = implementation
    expect(validate(modeless)).toThrow('must declare a single-request or bounded-collection')
    expect(validate({ ...implementation, mode: 'hybrid' })).toThrow(
      'must declare a single-request or bounded-collection',
    )
    expect(validate(null)).toThrow('must declare a single-request or bounded-collection')
    expect(validate(() => undefined)).toThrow('must declare a single-request or bounded-collection')
  })

  test('executes declared public enrichment without forwarding character authority', async () => {
    const collect = vi.fn(async (context) => ({
      complete: true,
      data: await context.operations['universe-resolve-names']({ body: [1404328063] }),
    }))
    const collectingResource = {
      ...walletCollectionResource(collect),
      dependentOperationIds: ['universe-resolve-names'],
    }
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource: collectingResource,
      characterId: 1404328063,
      authorization: { tokenVersion: 4 },
      authorizationCharacterId: 1404328063,
      authorizationCharacterLifecycleId: identity.subjectLifecycleId,
    })
    const executeEsiOperation = vi
      .fn()
      .mockResolvedValue(platformExecution([], null, 'esi', { pages: 4 }))

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [collectingResource],
        guardExecution,
        executeEsiOperation,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98000001 }),
        createCapabilities: vi.fn().mockReturnValue({}),
      }),
    ).resolves.toMatchObject({
      authorizationGeneration: 4,
      complete: true,
      result: {
        pagination: { pages: 4 },
        data: { pagination: { pages: 4 } },
      },
    })
    expect(executeEsiOperation).toHaveBeenCalledWith({
      operation: 'universe-resolve-names',
      inputs: { body: [1404328063] },
      authorization: { kind: 'public' },
    })
  })

  test('uses resilient per-item universe-name resolution for production collection', async () => {
    const collect = vi.fn(async (context) => ({
      complete: true,
      data: await context.operations['universe-resolve-names']({ body: [1, 90_666_561] }),
    }))
    const collectingResource = {
      ...walletCollectionResource(collect),
      dependentOperationIds: ['universe-resolve-names'],
    }
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource: collectingResource,
      characterId: 1_404_328_063,
      authorization: { tokenVersion: 4 },
    })
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      names: new Map([[1, { id: 1, name: 'Resolved', category: 'character' }]]),
      complete: true,
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [collectingResource],
        guardExecution,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        createCapabilities: vi.fn().mockReturnValue({}),
      }),
    ).resolves.toMatchObject({
      complete: true,
      result: { data: { data: [{ id: 1, name: 'Resolved', category: 'character' }] } },
    })
    expect(mocks.resolveUniverseNamesBestEffort).toHaveBeenCalledWith([1, 90_666_561], {
      signal: undefined,
    })
  })

  test('accepts asset and mail enrichment only as declared collection operations', () => {
    const operationIds = [
      'character-assets-page',
      'character-asset-names',
      'mail-headers',
      'mail-message',
      'mail-lists',
      'universe-resolve-names',
    ] as const
    const definitions = Object.fromEntries(
      operationIds.map((operationId) => [
        operationId,
        getPlatformEsiOperationDefinition(operationId),
      ]),
    )
    const assetResource = {
      ...resource,
      resourceId: 'assets',
      operationId: 'character-assets-page',
      dependentOperationIds: ['character-asset-names', 'universe-resolve-names'],
      implementation: {
        ...walletCollectionResource(vi.fn()).implementation,
        operation: 'character-assets-page',
      },
    } as const satisfies PlatformInstalledResourceDescriptor
    const mailResource = {
      ...resource,
      resourceId: 'mail',
      operationId: 'mail-headers',
      dependentOperationIds: ['mail-message', 'mail-lists', 'universe-resolve-names'],
      implementation: {
        ...walletCollectionResource(vi.fn()).implementation,
        operation: 'mail-headers',
      },
    } as const satisfies PlatformInstalledResourceDescriptor

    expect(() =>
      assertInstalledResourceDeclarations([assetResource, mailResource], definitions),
    ).not.toThrow()
    expect(assetResource.dependentOperationIds).toEqual([
      'character-asset-names',
      'universe-resolve-names',
    ])
    expect(mailResource.dependentOperationIds).toEqual([
      'mail-message',
      'mail-lists',
      'universe-resolve-names',
    ])
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
    expect(() =>
      assertInstalledResourceDeclarations(
        [{ ...resource, implementation: batchImplementation }],
        definitions,
      ),
    ).toThrow('must declare matching batch descriptor and implementation')
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...batchResource,
            implementation: {
              ...batchImplementation,
              batch: { ...batchImplementation.batch, request: undefined },
            },
          } as unknown as PlatformInstalledResourceDescriptor,
        ],
        definitions,
      ),
    ).toThrow('must provide request and classify functions')
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...batchResource,
            implementation: {
              ...batchImplementation,
              batch: { ...batchImplementation.batch, classify: undefined },
            },
          } as unknown as PlatformInstalledResourceDescriptor,
        ],
        definitions,
      ),
    ).toThrow('must provide request and classify functions')
    expect(() =>
      assertInstalledResourceDeclarations(
        [
          {
            ...batchResource,
            implementation: {
              ...batchImplementation,
              batch: { ...batchImplementation.batch, operation: 'public-character' },
            },
          },
        ],
        definitions,
      ),
    ).toThrow('implements batch operation public-character instead of universe-resolve-names')
  })
})

function walletCollectionResource(collect: ReturnType<typeof vi.fn>) {
  return {
    ...resource,
    implementation: {
      mode: 'bounded-collection' as const,
      operation: 'wallet-balance',
      collect,
      materialize: vi.fn(),
    },
  }
}

function readyCollection(collectingResource: PlatformInstalledResourceDescriptor) {
  return {
    outcome: 'ready',
    resource: collectingResource,
    characterId: 1404328063,
    authorization: { tokenVersion: 4 },
    authorizationCharacterId: 1404328063,
    authorizationCharacterLifecycleId: identity.subjectLifecycleId,
    managedAuthority: null,
  }
}

function executableDefinition<SdkOperation extends StableOperationId>(
  sdkOperationId: SdkOperation,
  authorization: 'character' | 'public' = sdkOperationId === 'GetCharactersCharacterIdWallet'
    ? 'character'
    : 'public',
) {
  return {
    sdkOperationId,
    descriptor: operationRegistry[sdkOperationId] as never,
    contract: {
      audit: { esiOperationId: sdkOperationId, reviewedDate: '2026-09-03' },
      representationVersion: '1',
      authorization:
        authorization === 'character'
          ? { kind: 'character', scope: 'esi-wallet.read_character_wallet.v1' }
          : { kind: 'public' },
      identity: { kind: 'set', field: 'ids', maximumItems: 1000 },
      freshness: { kind: 'none' },
      cache: { kind: 'none' },
      rateGroup: { kind: 'legacy-only' },
      retry: { kind: 'none' },
      compatibility: { minimumDate: '2020-01-01' },
      responseValidation: { kind: 'enabled' },
    } as never,
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
  authorizationGeneration: number | null,
  source: 'esi' | 'cache' = 'esi',
  pagination?: { readonly pages?: number },
) {
  return {
    ...cached(data),
    source,
    authorizationGeneration,
    ...(pagination ? { pagination } : {}),
  }
}
