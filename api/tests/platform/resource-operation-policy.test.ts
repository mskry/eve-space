import type {
  PlatformCharacterResourceSubject,
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type { StableOperationId } from '@evespace/esi-client/operations'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createEsiTransport: vi.fn(),
  getCharacterWithAuthorization: vi.fn(),
  getEsiResilienceLayer: vi.fn(),
  getPublic: vi.fn(),
}))

vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: mocks.getEsiResilienceLayer,
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

import { assertInstalledResourceDeclarations } from '../../src/platform/resource-declarations.js'
import { getEsiOperationContract } from '../../src/esi-resilience/catalog.js'
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
    mocks.getEsiResilienceLayer.mockReturnValue({
      getCharacterWithAuthorization: mocks.getCharacterWithAuthorization,
      getPublic: mocks.getPublic,
    })
  })

  test('binds an installed character operation to the shared executor and transport', async () => {
    const transport = vi.fn()
    const dispatchOperation = vi.fn().mockResolvedValue({
      data: 123.45,
      meta: { status: 200, headers: {}, cache: { cacheControl: 'max-age=120' } },
    })
    const validateInputs = vi.fn((_definition, inputs) => inputs)
    const definition = executableDefinition('GetCharactersCharacterIdWallet')
    mocks.createEsiTransport.mockReturnValue(transport)
    mocks.getCharacterWithAuthorization.mockImplementation(async (operation, authorization) => {
      expect(operation.operation).toBe('wallet-balance')
      expect(operation.inputs).toEqual({ characterId: 1404328063 })
      expect(authorization).toEqual({
        kind: 'character',
        principal: 'character-1404328063-lifecycle-35acd527-9539-44ad-aacf-9f8e45232267',
        generation: 4,
      })
      const loaded = await operation.load({ ifNoneMatch: 'wallet-etag' })
      return cached(loaded.data)
    })
    const guardExecution = vi.fn().mockResolvedValue({
      outcome: 'ready',
      resource,
      characterId: 1404328063,
      authorization: { accessToken: 'private', tokenVersion: 4 },
    })

    await expect(
      executeInstalledResourceOperation(identity, {
        resources: [resource],
        guardExecution,
        definitions: { 'wallet-balance': definition },
        validateInputs,
        dispatchOperation,
      }),
    ).resolves.toMatchObject({ outcome: 'loaded', result: { data: 123.45 } })
    expect(mocks.getEsiResilienceLayer).toHaveBeenCalledOnce()
    expect(mocks.getCharacterWithAuthorization).toHaveBeenCalledOnce()
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('wallet-balance', 'character-1404328063')
    expect(validateInputs).toHaveBeenCalledWith(definition, { characterId: 1404328063 })
    expect(dispatchOperation).toHaveBeenCalledWith(definition, {
      inputs: { characterId: 1404328063 },
      authorization: { kind: 'character', accessToken: 'private' },
      revalidation: { ifNoneMatch: 'wallet-etag' },
      transport,
    })
    expect(implementation.map).toHaveBeenCalledWith({
      subject: {
        kind: 'character',
        characterId: 1404328063,
        lifecycleId: identity.subjectLifecycleId,
      },
      data: 123.45,
    })
  })

  test('does not reach the executor, transport, or module implementation when disabled', async () => {
    const loadCharacterAuthorization = vi.fn()
    const guardExecution = vi.fn((executionIdentity, options) =>
      guardInstalledResourceExecution(executionIdentity, {
        ...options,
        resolveEligibility: vi.fn().mockResolvedValue({ status: 'disabled' }),
        loadCharacterAuthorization,
      }),
    )

    await expect(
      executeInstalledResourceOperation(identity, { resources: [resource], guardExecution }),
    ).resolves.toEqual({ outcome: 'noop', reason: 'disabled' })
    expect(mocks.getEsiResilienceLayer).not.toHaveBeenCalled()
    expect(mocks.createEsiTransport).not.toHaveBeenCalled()
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
