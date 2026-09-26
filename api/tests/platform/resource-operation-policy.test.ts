import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  PlatformCharacterResourceSubject,
  PlatformCorporationResourceSubject,
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
import {
  assertInstalledResourceDeclarations,
  getInstalledResourceCredentialBindings,
  getManagedCorporationResourceRequirements,
} from '../../src/platform/resource-declarations.js'
import { platformResources } from '../../src/platform/resources.js'
import { guardInstalledResourceExecution } from '../../src/platform/resource-execution-guard.js'
import { executeInstalledResourceOperation } from '../../src/platform/resource-operation-executor.js'

const identity = {
  moduleId: 'test-feature',
  resourceId: 'wallet-balance',
  subjectId: '1404328063',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
} as const

const implementation = {
  map: vi.fn(({ data }: { data: unknown }) => Number(data)),
  materialize: vi.fn().mockResolvedValue(undefined),
  mode: 'single-request',
  operation: 'wallet-balance',
  request: vi.fn(({ characterId }: { characterId: number }) => ({
    path: { character_id: characterId },
  })),
} satisfies PlatformSingleRequestResourceImplementation
type WalletCollectionContext = PlatformResourceCollectionContext<
  PlatformCharacterResourceSubject,
  PlatformEsiOperationProtocol<'wallet-balance'>
>
const walletInputs = { path: { character_id: 1_404_328_063 } } as const
const managedAuthority = {
  disclosureVersion: 1,
  managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
  organizationDeploymentId: 1 as const,
  organizationVersion: 2,
  sectionActivationVersion: 1,
  sectionId: 'wallet',
  targetUserId: '22222222-2222-4222-8222-222222222222',
}
const resource = {
  eligibility: { kind: 'current-owned-character' },
  implementation,
  materializationIntervalSeconds: 900,
  moduleId: identity.moduleId,
  operationId: 'wallet-balance',
  resourceId: identity.resourceId,
  subjectKind: 'character',
} as const satisfies PlatformInstalledResourceDescriptor

const batchImplementation = {
  ...implementation,
  batch: {
    classify: vi.fn(),
    mode: 'complete-observation',
    operation: 'universe-resolve-names',
    request: vi.fn((subjects: readonly PlatformCharacterResourceSubject[]) => ({
      ids: subjects.map(({ characterId }) => characterId),
    })),
  },
} as const satisfies PlatformSingleRequestResourceImplementation

const batchResource = {
  ...resource,
  batch: { mode: 'complete-observation', operationId: 'universe-resolve-names' },
  implementation: batchImplementation,
} as const satisfies PlatformInstalledResourceDescriptor

const installedBindings = (moduleId: string, resourceId: string) => {
  const descriptor = platformResources.find(
    (item) => item.moduleId === moduleId && item.resourceId === resourceId,
  )
  if (!descriptor) throw new Error(`Missing installed resource ${moduleId}/${resourceId}`)
  return getInstalledResourceCredentialBindings(descriptor)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCharacterCacheAuthorizationForLifecycle.mockResolvedValue({
    scopes: ['esi-wallet.read_character_wallet.v1'],
    tokenVersion: 4,
  })
  mocks.resolveUniverseNamesBestEffort.mockResolvedValue({ complete: true, names: new Map() })
})

describe('credential-bound resource operations', () => {
  test('compiles installed managed-member, owned-character, and exact corporation-source bindings', () => {
    expect(installedBindings('member-audit', 'wallet-balance')['wallet-balance']).toStrictEqual({
      kind: 'current-managed-member-character',
      requestSubjects: ['character_id'],
      scope: 'esi-wallet.read_character_wallet.v1',
      sectionId: 'wallet',
      corporationInput: null,
    })
    expect(
      installedBindings('organization-activity', 'corporation-jobs')[
        'organization-activity-corporation-jobs'
      ],
    ).toStrictEqual({
      kind: 'current-managed-corporation-source',
      requestSubjects: ['corporation_id'],
      scope: 'esi-corporations.read_freelance_jobs.v1',
      requiredRolePredicate: 'project-manager',
    })
    expect(
      installedBindings('organization-activity', 'corporation-projects')[
        'organization-activity-project-list'
      ],
    ).toMatchObject({
      kind: 'current-managed-corporation-source',
      requiredRolePredicate: null,
    })
    const owned = installedBindings('organization-activity', 'character-projects')
    expect(owned['organization-activity-project-list']).toMatchObject({
      kind: 'current-owned-character',
      requestSubjects: ['corporation_id'],
      corporationInput: 'current-affiliation',
    })
    expect(owned['organization-activity-project-contribution']).toMatchObject({
      kind: 'current-owned-character',
      requestSubjects: ['character_id', 'corporation_id'],
      corporationInput: 'current-affiliation',
    })
  })

  test('rejects incompatible resource subject, eligibility, and generated operation authority', () => {
    expect(() =>
      getInstalledResourceCredentialBindings({
        ...resource,
        operationId: 'organization-activity-corporation-jobs',
      }),
    ).toThrow('incompatible character credential authority')
    // SAFETY: this fixture intentionally pairs a corporation eligibility with character-only inputs.
    expect(() =>
      getInstalledResourceCredentialBindings({
        ...resource,
        subjectKind: 'corporation',
        eligibility: { kind: 'current-managed-corporation-source' },
      } as never),
    ).toThrow('must bind its corporation request to its current source')
    expect(
      getInstalledResourceCredentialBindings({
        ...resource,
        operationId: 'organization-activity-campaign-list',
      })['organization-activity-campaign-list'],
    ).toEqual({ kind: 'public' })
    // SAFETY: the extra scope field represents an untyped module attempt to override generated authority.
    expect(() =>
      getInstalledResourceCredentialBindings({ ...resource, scope: 'weaker' } as never),
    ).toThrow('cannot override generated operation authority')
  })

  test('deduplicates and fingerprints root and dependent corporation requirements', () => {
    const projects = platformResources.find((item) => item.resourceId === 'corporation-projects')!
    const jobs = platformResources.find((item) => item.resourceId === 'corporation-jobs')!
    const projectRequirements = getManagedCorporationResourceRequirements(projects)
    expect(projectRequirements.scopes).toEqual(['esi-corporations.read_projects.v1'])
    expect(projectRequirements.rolePredicates).toEqual([])
    expect(projectRequirements).toEqual(getManagedCorporationResourceRequirements(projects))
    expect(getManagedCorporationResourceRequirements(jobs).rolePredicates).toEqual([
      'project-manager',
    ])

    const mixed = {
      ...projects,
      dependentOperationIds: [
        ...(projects.dependentOperationIds ?? []),
        'organization-activity-corporation-jobs',
        'organization-activity-corporation-jobs',
      ],
    }
    const requirements = getManagedCorporationResourceRequirements(mixed)
    expect(requirements.scopes).toEqual([
      'esi-corporations.read_freelance_jobs.v1',
      'esi-corporations.read_projects.v1',
    ])
    expect(requirements.rolePredicates).toEqual(['project-manager'])
    expect(requirements.fingerprint).not.toBe(projectRequirements.fingerprint)
    expect(requirements).toEqual(
      getManagedCorporationResourceRequirements({
        ...mixed,
        dependentOperationIds: mixed.dependentOperationIds.toReversed(),
      }),
    )
    expect(() =>
      getManagedCorporationResourceRequirements({
        ...mixed,
        dependentOperationIds: ['organization-activity-campaign-list'],
      }),
    ).toThrow('cannot mix corporation credentials with public operations')
  })

  test('binds shared project-list requests to owned affiliation or the exact managed source', async () => {
    const owned = platformResources.find((item) => item.resourceId === 'character-projects')!
    const corporation = platformResources.find(
      (item) => item.resourceId === 'corporation-projects',
    )!
    const operationId = 'organization-activity-project-list'
    const ownedIdentity = { ...identity, resourceId: owned.resourceId }
    const ownedGuard = {
      authorization: { tokenVersion: 4 },
      authorizationCharacterId: 1_404_328_063,
      authorizationCharacterLifecycleId: identity.subjectLifecycleId,
      managedAuthority: null,
      outcome: 'ready' as const,
      resource: owned,
      subject: {
        kind: 'character' as const,
        characterId: 1_404_328_063,
        lifecycleId: identity.subjectLifecycleId,
      },
    }
    const ownedEsi = vi.fn().mockResolvedValue(platformExecution([], 4))
    const ownedOptions = {
      guardExecution: vi.fn().mockResolvedValue(ownedGuard),
      loadCollectionContext: vi
        .fn()
        .mockResolvedValue({ corporationId: 98_000_001, organizationVersion: 2 }),
      executeEsiOperation: ownedEsi,
      resources: [owned],
      request: { operationId, inputs: { path: { corporation_id: 98_000_001 } } },
    }
    await expect(
      executeInstalledResourceOperation(ownedIdentity, ownedOptions),
    ).resolves.toMatchObject({ outcome: 'loaded' })
    expect(ownedEsi).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: expect.objectContaining({ characterId: 1_404_328_063 }),
      }),
    )
    await expect(
      executeInstalledResourceOperation(ownedIdentity, {
        ...ownedOptions,
        request: { operationId, inputs: { path: { corporation_id: 98_000_002 } } },
      }),
    ).rejects.toThrow('outside its bound subject')
    expect(ownedEsi).toHaveBeenCalledTimes(1)

    const corporationIdentity = {
      ...identity,
      resourceId: corporation.resourceId,
      subjectKind: 'corporation' as const,
      subjectId: '98000001',
      subjectLifecycleId: '1cfba895-359c-4a48-b21a-177d351c87a6',
    }
    const corporationGuard = {
      ...ownedGuard,
      authorizationCharacterId: 1_404_328_064,
      resource: corporation,
      subject: {
        kind: 'corporation' as const,
        corporationId: 98_000_001,
        lifecycleId: corporationIdentity.subjectLifecycleId,
      },
    }
    const corporationEsi = vi.fn().mockResolvedValue(platformExecution([], 4))
    await expect(
      executeInstalledResourceOperation(corporationIdentity, {
        guardExecution: vi.fn().mockResolvedValue(corporationGuard),
        executeEsiOperation: corporationEsi,
        resources: [corporation],
        request: { operationId, inputs: { path: { corporation_id: 98_000_001 } } },
      }),
    ).resolves.toMatchObject({ outcome: 'loaded' })
    expect(corporationEsi).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: expect.objectContaining({ characterId: 1_404_328_064 }),
      }),
    )
  })

  test('requires the compiled managed-member section admission before gateway execution', async () => {
    const memberResource = platformResources.find(
      (item) => item.moduleId === 'member-audit' && item.resourceId === 'wallet-balance',
    )!
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution(100, 4))
    const ready = {
      authorization: { tokenVersion: 4 },
      authorizationCharacterId: 1_404_328_063,
      authorizationCharacterLifecycleId: identity.subjectLifecycleId,
      managedAuthority,
      outcome: 'ready' as const,
      resource: memberResource,
      subject: {
        kind: 'character' as const,
        characterId: 1_404_328_063,
        lifecycleId: identity.subjectLifecycleId,
      },
    }
    const options = {
      executeEsiOperation,
      guardExecution: vi.fn().mockResolvedValue(ready),
      request: { operationId: 'wallet-balance', inputs: walletInputs },
      resources: [memberResource],
    }
    await expect(executeInstalledResourceOperation(identity, options)).resolves.toMatchObject({
      outcome: 'loaded',
    })
    expect(executeEsiOperation).toHaveBeenCalledTimes(1)
    await expect(
      executeInstalledResourceOperation(identity, {
        ...options,
        guardExecution: vi.fn().mockResolvedValue({
          ...ready,
          managedAuthority: { ...managedAuthority, sectionId: 'assets' },
        }),
      }),
    ).rejects.toThrow('current managed-member admission')
    expect(executeEsiOperation).toHaveBeenCalledTimes(1)
  })

  test('rejects a changed corporation role fence between collection operations', async () => {
    const installed = platformResources.find((item) => item.resourceId === 'corporation-projects')!
    type CorporationContext = PlatformResourceCollectionContext<
      PlatformCorporationResourceSubject,
      PlatformEsiOperationProtocol<'organization-activity-project-list'>
    >
    const collect = vi.fn(async (context: CorporationContext) => ({
      complete: true,
      data: await context.operations['organization-activity-project-list']({
        path: { corporation_id: 98_000_001 },
      }),
    }))
    const resourceWithCollect = {
      ...installed,
      dependentOperationIds: [],
      implementation: {
        collect,
        materialize: vi.fn(),
        mode: 'bounded-collection' as const,
        operation: 'organization-activity-project-list',
      },
    }
    const corporationIdentity = {
      ...identity,
      resourceId: resourceWithCollect.resourceId,
      subjectKind: 'corporation' as const,
      subjectId: '98000001',
      subjectLifecycleId: '1cfba895-359c-4a48-b21a-177d351c87a6',
    }
    const fence = {
      sourceId: 'd56315c7-6bfb-462d-a8fa-0e1588a6312a',
      organizationVersion: 2,
      corporationLifecycleId: corporationIdentity.subjectLifecycleId,
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
      characterLifecycleId: identity.subjectLifecycleId,
      affiliationPeriodRevision: '43e4b829-a09a-4e34-a91e-e414c5f58fe1',
      authorizationGeneration: 4,
      requirementsFingerprint: 'projects-v1',
      roleRevision: null,
    }
    const ready = {
      authorization: { tokenVersion: 4 },
      authorizationCharacterId: fence.characterId,
      authorizationCharacterLifecycleId: fence.characterLifecycleId,
      corporationAuthorityFence: fence,
      managedAuthority: null,
      outcome: 'ready' as const,
      resource: resourceWithCollect,
      subject: {
        kind: 'corporation' as const,
        corporationId: 98_000_001,
        lifecycleId: corporationIdentity.subjectLifecycleId,
      },
    }
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution([], 4))
    await expect(
      executeInstalledResourceOperation(corporationIdentity, {
        resources: [resourceWithCollect],
        createCapabilities: vi.fn().mockReturnValue({}),
        guardExecution: vi
          .fn()
          .mockResolvedValueOnce(ready)
          .mockResolvedValueOnce({
            ...ready,
            corporationAuthorityFence: { ...fence, sourceId: 'replacement' },
          }),
        executeEsiOperation,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ corporationId: 98_000_001, organizationVersion: 2 }),
      }),
    ).rejects.toThrow('Resource collection authority changed')
    expect(executeEsiOperation).not.toHaveBeenCalled()
  })

  test('accepts an incomplete corporation checkpoint reset without ESI or success', async () => {
    const installed = platformResources.find((item) => item.resourceId === 'corporation-projects')!
    const collect = vi.fn().mockResolvedValue({ complete: false, data: { checkpoint: 'reset' } })
    const resourceWithCollect = {
      ...installed,
      implementation: {
        collect,
        materialize: vi.fn(),
        mode: 'bounded-collection' as const,
        operation: installed.operationId,
      },
    }
    const corporationIdentity = {
      ...identity,
      resourceId: installed.resourceId,
      subjectKind: 'corporation' as const,
      subjectId: '98000001',
    }
    const fence = {
      sourceId: 'd56315c7-6bfb-462d-a8fa-0e1588a6312a',
      organizationVersion: 2,
      corporationLifecycleId: corporationIdentity.subjectLifecycleId,
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
      characterLifecycleId: '70eb0397-adff-4a82-94d6-065bd2149ea8',
      affiliationPeriodRevision: '43e4b829-a09a-4e34-a91e-e414c5f58fe1',
      authorizationGeneration: 4,
      requirementsFingerprint: 'projects-v1',
      roleRevision: null,
    }
    const executeEsiOperation = vi.fn()
    const result = await executeInstalledResourceOperation(corporationIdentity, {
      resources: [resourceWithCollect],
      createCapabilities: vi.fn().mockReturnValue({}),
      guardExecution: vi.fn().mockResolvedValue({
        authorization: { tokenVersion: 4 },
        authorizationCharacterId: fence.characterId,
        authorizationCharacterLifecycleId: fence.characterLifecycleId,
        corporationAuthorityFence: fence,
        managedAuthority: null,
        outcome: 'ready',
        resource: resourceWithCollect,
        subject: {
          kind: 'corporation',
          corporationId: 98_000_001,
          lifecycleId: corporationIdentity.subjectLifecycleId,
        },
      }),
      executeEsiOperation,
      loadCollectionContext: vi
        .fn()
        .mockResolvedValue({ corporationId: 98_000_001, organizationVersion: 2 }),
    })
    expect(result).toMatchObject({
      outcome: 'loaded',
      complete: false,
      result: { data: { checkpoint: 'reset' } },
    })
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationAuthorityBinding: expect.stringMatching(/^v1:[a-f\d]{64}$/u),
      }),
    )
    expect(executeEsiOperation).not.toHaveBeenCalled()
  })
})

describe('installed resource operation policy', () => {
  test('maps cached platform wire data before returning a resource observation', async () => {
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution('123.45', 5, 'cache'))
    const guardExecution = vi.fn().mockResolvedValue({
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource,
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        executeEsiOperation,
        guardExecution,
        resources: [resource],
      }),
    ).resolves.toMatchObject({
      authorizationGeneration: 5,
      outcome: 'loaded',
      result: { data: 123.45, source: 'cache' },
    })
    expect(executeEsiOperation).toHaveBeenCalledWith({
      authorization: {
        characterId: 1_404_328_063,
        generation: 4,
        kind: 'character-lifecycle',
        lifecycleId: identity.subjectLifecycleId,
      },
      inputs: walletInputs,
      operation: 'wallet-balance',
    })
    expect(implementation.map).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: { coreData: {} },
        data: '123.45',
        subject: {
          characterId: 1_404_328_063,
          kind: 'character',
          lifecycleId: identity.subjectLifecycleId,
        },
      }),
    )
  })

  test('awaits mapping with only declared core-data capabilities', async () => {
    const publishedTypeGroups = vi.fn().mockResolvedValue({ complete: true, rows: [] })
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
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource: mappedResource,
    })
    const createMappingCapabilities = vi.fn().mockReturnValue({
      coreData: { publishedTypeGroups },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        createMappingCapabilities,
        executeEsiOperation: vi.fn().mockResolvedValue(platformExecution('123.45', 4)),
        guardExecution,
        resources: [mappedResource],
      }),
    ).resolves.toMatchObject({ result: { data: 123.45 } })
    expect(createMappingCapabilities).toHaveBeenCalledWith(mappedResource)
    expect(map.mock.calls[0]![0].capabilities).toStrictEqual({
      coreData: { publishedTypeGroups },
    })
  })

  test('sanitizes asynchronous mapping rejection as a mapping failure', async () => {
    const map = vi.fn().mockRejectedValue(new Error('published product timed out with SQL detail'))
    const mappedResource = { ...resource, implementation: { ...implementation, map } }
    const guardExecution = vi.fn().mockResolvedValue({
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource: mappedResource,
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        executeEsiOperation: vi.fn().mockResolvedValue(platformExecution('123.45', 4)),
        guardExecution,
        resources: [mappedResource],
      }),
    ).rejects.toThrow('Platform resource mapping failed')
  })

  test('does not resolve lifecycle token material for a fresh cached result', async () => {
    const executeEsiOperation = vi.fn().mockResolvedValue(platformExecution(123.45, 4, 'cache'))
    const guardExecution = vi.fn().mockResolvedValue({
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource,
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        executeEsiOperation,
        guardExecution,
        resources: [resource],
      }),
    ).resolves.toMatchObject({ authorizationGeneration: 4, outcome: 'loaded' })
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })

  test('rejects caller-owned conditional headers before consulting the cache', async () => {
    const executeEsiOperation = vi
      .fn()
      .mockRejectedValue(new PlatformEsiRequestError('Platform ESI request inputs are invalid'))
    const guardExecution = vi.fn().mockResolvedValue({
      authorization: { scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 },
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource,
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        executeEsiOperation,
        guardExecution,
        resources: [resource],
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
        loadCharacterCacheAuthorization: loadCharacterAuthorization,
        resolveEligibility: vi.fn().mockResolvedValue({ status: 'disabled' }),
      }),
    )

    await expect(
      executeInstalledResourceOperation(identity, {
        createCapabilities,
        guardExecution,
        resources: [resource],
      }),
    ).resolves.toStrictEqual({ outcome: 'noop', reason: 'disabled' })
    expect(loadCharacterAuthorization).not.toHaveBeenCalled()
    expect(implementation.request).not.toHaveBeenCalled()
    expect(implementation.map).not.toHaveBeenCalled()
    expect(createCapabilities).not.toHaveBeenCalled()
  })

  test('validates every installed descriptor without consulting runtime enablement', () => {
    const definitions = {
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
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
            dependentOperationIds: ['wallet-balance'],
            implementation: { ...implementation, operation: 'universe-resolve-names' },
            operationId: 'universe-resolve-names',
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
      createCapabilities: vi.fn().mockReturnValue({}),
      executeEsiOperation: vi.fn().mockResolvedValue(platformExecution(123, 4)),
      guardExecution,
      loadCollectionContext: vi
        .fn()
        .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
      resources: [collectingResource],
    }
    await expect(executeInstalledResourceOperation(identity, options)).resolves.toMatchObject({
      authorizationGeneration: 4,
      complete: false,
      organizationVersion: 2,
      result: { data: { data: 123 } },
    })
    expect(guardExecution).toHaveBeenCalledTimes(2)
    expect(options.executeEsiOperation).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: walletInputs, operation: 'wallet-balance' }),
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
      for (let i = 0; i < 33; i++) {
        await context.operations['wallet-balance'](walletInputs)
      }
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
        createCapabilities: vi.fn().mockReturnValue({}),
        executeEsiOperation,
        guardExecution: vi.fn().mockResolvedValue(readyCollection(collectingResource)),
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        resources: [collectingResource],
      }),
    ).resolves.toMatchObject({ complete: true, outcome: 'loaded' })
    expect(Object.isFrozen(operations)).toBe(true)
    expect(Object.getPrototypeOf(operations)).toBeNull()
    expect(
      Object.keys(operations).toSorted((left, right) => left.localeCompare(right)),
    ).toStrictEqual(['universe-resolve-names', 'wallet-balance'])
    expect(executeEsiOperation).toHaveBeenCalledOnce()
  })
})

describe('bounded resource operation policy', () => {
  test('rejects invalid untyped collection inputs before ESI execution', async () => {
    const collect = vi.fn(async (context: WalletCollectionContext) => ({
      complete: true,
      data: await context.operations['wallet-balance']({} as never),
    }))
    const collectingResource = walletCollectionResource(collect)
    const executeEsiOperation = vi.fn()

    await expect(
      executeInstalledResourceOperation(identity, {
        createCapabilities: vi.fn().mockReturnValue({}),
        executeEsiOperation,
        guardExecution: vi.fn().mockResolvedValue(readyCollection(collectingResource)),
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        resources: [collectingResource],
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
        createCapabilities: vi.fn().mockReturnValue({}),
        executeEsiOperation,
        guardExecution,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        resources: [collectingResource],
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
        createCapabilities: vi.fn().mockReturnValue({}),
        executeEsiOperation,
        guardExecution: vi.fn().mockResolvedValue(readyCollection(collectingResource)),
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        resources: [collectingResource],
      }),
    ).resolves.toMatchObject({
      result: { data: 'collected', validatedAt: '2026-08-26T14:57:00.000Z' },
    })
  })

  test('validates inspectable execution-mode shapes for erased implementations', () => {
    const definitions = {
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
    }
    const collection = walletCollectionResource(vi.fn())
    const validate = (candidate: unknown, dependentOperationIds?: readonly string[]) => () =>
      assertInstalledResourceDeclarations(
        [
          {
            ...resource,
            ...(dependentOperationIds && { dependentOperationIds }),
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
    expect(validate({ ...collection.implementation, map: vi.fn(), request: vi.fn() })).toThrow(
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
      data: await context.operations['universe-resolve-names']({ body: [1_404_328_063] }),
    }))
    const collectingResource = {
      ...walletCollectionResource(collect),
      dependentOperationIds: ['universe-resolve-names'],
    }
    const guardExecution = vi.fn().mockResolvedValue({
      authorization: { tokenVersion: 4 },
      authorizationCharacterId: 1_404_328_063,
      authorizationCharacterLifecycleId: identity.subjectLifecycleId,
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource: collectingResource,
    })
    const executeEsiOperation = vi
      .fn()
      .mockResolvedValue(platformExecution([], null, 'esi', { pages: 4 }))

    await expect(
      executeInstalledResourceOperation(identity, {
        createCapabilities: vi.fn().mockReturnValue({}),
        executeEsiOperation,
        guardExecution,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        resources: [collectingResource],
      }),
    ).resolves.toMatchObject({
      authorizationGeneration: 4,
      complete: true,
      result: {
        data: { pagination: { pages: 4 } },
        pagination: { pages: 4 },
      },
    })
    expect(executeEsiOperation).toHaveBeenCalledWith({
      authorization: { kind: 'public' },
      inputs: { body: [1_404_328_063] },
      operation: 'universe-resolve-names',
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
      authorization: { tokenVersion: 4 },
      characterId: 1_404_328_063,
      outcome: 'ready',
      resource: collectingResource,
    })
    mocks.resolveUniverseNamesBestEffort.mockResolvedValue({
      complete: true,
      names: new Map([[1, { id: 1, name: 'Resolved', category: 'character' }]]),
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        createCapabilities: vi.fn().mockReturnValue({}),
        guardExecution,
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 2, corporationId: 98_000_001 }),
        resources: [collectingResource],
      }),
    ).resolves.toMatchObject({
      complete: true,
      result: { data: { data: [{ category: 'character', id: 1, name: 'Resolved' }] } },
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
      dependentOperationIds: ['character-asset-names', 'universe-resolve-names'],
      implementation: {
        ...walletCollectionResource(vi.fn()).implementation,
        operation: 'character-assets-page',
      },
      operationId: 'character-assets-page',
      resourceId: 'assets',
    } as const satisfies PlatformInstalledResourceDescriptor
    const mailResource = {
      ...resource,
      dependentOperationIds: ['mail-message', 'mail-lists', 'universe-resolve-names'],
      implementation: {
        ...walletCollectionResource(vi.fn()).implementation,
        operation: 'mail-headers',
      },
      operationId: 'mail-headers',
      resourceId: 'mail',
    } as const satisfies PlatformInstalledResourceDescriptor

    expect(() =>
      assertInstalledResourceDeclarations([assetResource, mailResource], definitions),
    ).not.toThrow()
    expect(assetResource.dependentOperationIds).toStrictEqual([
      'character-asset-names',
      'universe-resolve-names',
    ])
    expect(mailResource.dependentOperationIds).toStrictEqual([
      'mail-message',
      'mail-lists',
      'universe-resolve-names',
    ])
  })

  test('requires batch descriptors and implementations to match a public set operation', () => {
    const definitions = {
      'public-character': executableDefinition('GetCharactersDetail'),
      'universe-resolve-names': executableDefinition('PostUniverseNames'),
      'wallet-balance': executableDefinition('GetCharactersCharacterIdWallet'),
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
      collect,
      materialize: vi.fn(),
      mode: 'bounded-collection' as const,
      operation: 'wallet-balance',
    },
  }
}

function readyCollection(collectingResource: PlatformInstalledResourceDescriptor) {
  return {
    authorization: { tokenVersion: 4 },
    authorizationCharacterId: 1_404_328_063,
    authorizationCharacterLifecycleId: identity.subjectLifecycleId,
    characterId: 1_404_328_063,
    managedAuthority: null,
    outcome: 'ready',
    resource: collectingResource,
  }
}

function executableDefinition<SdkOperation extends StableOperationId>(
  sdkOperationId: SdkOperation,
  authorization: 'oauth' | 'public' = sdkOperationId === 'GetCharactersCharacterIdWallet'
    ? 'oauth'
    : 'public',
) {
  return {
    // SAFETY: this erased fixture supplies only the fields under test; SDK facts are checked by the catalog separately.
    contract: {
      audit: { esiOperationId: sdkOperationId, reviewedDate: '2026-09-03' },
      representationVersion: '1',
      authorization:
        authorization === 'oauth'
          ? {
              kind: 'oauth',
              scope: 'esi-wallet.read_character_wallet.v1',
              subjectBindings: ['character_id'],
              requiredRolePredicate: null,
            }
          : { kind: 'public', subjectBindings: [], requiredRolePredicate: null },
      identity: { kind: 'set', field: 'ids', maximumItems: 1000 },
      freshness: { kind: 'none' },
      cache: { kind: 'none' },
      rateGroup: { kind: 'legacy-only' },
      retry: { kind: 'none' },
      compatibility: { minimumDate: '2020-01-01' },
      responseValidation: { kind: 'enabled' },
    } as never,
    // SAFETY: the registry lookup is known to return a descriptor for these reviewed test identities.
    descriptor: operationRegistry[sdkOperationId] as never,
    sdkOperationId,
  } satisfies PlatformExecutableEsiOperationDefinition
}

function cached(data: unknown) {
  return {
    cachedUntil: '2026-08-26T15:00:00.000Z',
    data,
    quota: {},
    source: 'esi' as const,
    stale: false,
    validatedAt: '2026-08-26T14:58:00.000Z',
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
    authorizationGeneration,
    source,
    ...(pagination && { pagination }),
  }
}
