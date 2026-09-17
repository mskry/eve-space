import type { PlatformResourceOperationImplementation } from '@eve-space/platform-module-contract/resources'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  createRoutinePersistence: vi.fn(),
  databaseTransaction: vi.fn(),
  execute: vi.fn(),
  loadState: vi.fn(),
  materializeCoreResourceObservation: vi.fn(),
  recordSuccess: vi.fn(),
  recomputeAllAccounts: vi.fn(),
  recomputeManagedCorporations: vi.fn(),
  resolveEligibility: vi.fn(),
  transaction: vi.fn(),
  upsertState: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: { transaction: mocks.databaseTransaction },
  sql: { begin: mocks.begin },
}))
vi.mock('../../src/platform/module-persistence-capabilities.js', () => ({
  createPlatformResourceMaterializationPersistence: mocks.createRoutinePersistence,
}))
vi.mock('../../src/organization/compliance.js', () => ({
  recomputeAllOrganizationAccountsInTransaction: mocks.recomputeAllAccounts,
  recomputeComplianceForManagedCorporationsInTransaction: mocks.recomputeManagedCorporations,
}))
vi.mock('../../src/platform/collection-status.js', () => ({
  recordInstalledResourceCollectionSuccess: mocks.recordSuccess,
}))
vi.mock('../../src/platform/core-resource-materialization.js', () => ({
  materializeCoreResourceObservation: mocks.materializeCoreResourceObservation,
}))
vi.mock('../../src/platform/resource-eligibility.js', () => ({
  managedCollectionAuthorityEquals: (left: unknown, right: unknown) =>
    JSON.stringify(left ?? null) === JSON.stringify(right ?? null),
  resolveInstalledResourceEligibility: mocks.resolveEligibility,
}))
vi.mock('../../src/platform/collection-state-store.js', () => ({
  loadPlatformCollectionState: mocks.loadState,
  upsertPlatformCollectionState: mocks.upsertState,
  upsertPlatformCollectionStateInTransaction: vi.fn(),
}))

import {
  applyInstalledResourceObservation,
  processInstalledResourceRefresh,
} from '../../src/platform/resource-refresh.js'
import {
  PlatformResourceMappingError,
  PlatformResourcePersistenceError,
} from '../../src/platform/resource-failures.js'

const identity = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
  subjectId: '1404328063',
} as const
const managedAuthority = {
  organizationDeploymentId: 1 as const,
  organizationVersion: 7,
  targetUserId: '00000000-0000-4000-8000-000000000002',
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  sectionId: 'skills',
  disclosureVersion: 1,
  sectionActivationVersion: 1,
}

describe('local resource observations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockResolvedValue([])
    mocks.begin.mockImplementation((operation) => operation(mocks.transaction))
    mocks.databaseTransaction.mockImplementation((operation) =>
      operation({ execute: mocks.execute }),
    )
    mocks.loadState.mockResolvedValue(null)
    mocks.resolveEligibility.mockResolvedValue({
      status: 'eligible',
      due: true,
      authorizationGeneration: 4,
      managedAuthority: null,
      nextEligibleAt: null,
    })
    mocks.recordSuccess.mockResolvedValue(undefined)
    mocks.createRoutinePersistence.mockReturnValue(scopedRoutinePersistence())
  })

  test('persists a partial checkpoint without announcing successful collection', async () => {
    const materialize = vi.fn(async () => undefined)
    await applyInstalledResourceObservation({
      ...observation(materialize),
      outcome: 'complete',
      data: { cursor: 'opaque' },
      complete: false,
    })
    expect(materialize).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('rejects an observation from a superseded organization before module writes', async () => {
    const materialize = vi.fn(async () => undefined)
    mocks.transaction.mockResolvedValue([{ version: 3 }])
    await applyInstalledResourceObservation({
      ...observation(materialize),
      outcome: 'complete',
      data: {},
      organizationVersion: 2,
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('rejects an in-flight observation after its managed authority changes', async () => {
    const materialize = vi.fn(async () => undefined)
    mocks.resolveEligibility.mockResolvedValue({
      status: 'eligible',
      due: true,
      authorizationGeneration: 4,
      managedAuthority: {
        ...managedAuthority,
        managedMemberLifecycleId: '00000000-0000-4000-8000-000000000099',
      },
      nextEligibleAt: null,
    })

    await applyInstalledResourceObservation({
      ...observation(materialize),
      managedAuthority,
      outcome: 'complete',
      data: {},
    })

    expect(materialize).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('advances unchanged checked state without rewriting module data', async () => {
    const materialize = vi.fn(async () => undefined)

    await applyInstalledResourceObservation({
      ...observation(materialize),
      outcome: 'unchanged',
    })

    expect(materialize).not.toHaveBeenCalled()
    expect(mocks.createRoutinePersistence).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).toHaveBeenCalledWith(
      identity,
      { validatedAt: '2026-08-26T14:58:00.000Z' },
      4,
      expect.anything(),
    )
  })

  test('passes complete worker-memory data to the generated materializer once', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined)

    await applyInstalledResourceObservation({
      ...observation(materialize),
      outcome: 'complete',
      data: { score: 10 },
    })

    expect(materialize).toHaveBeenCalledOnce()
    expect(mocks.createRoutinePersistence).toHaveBeenCalledWith(
      mocks.transaction,
      identity.moduleId,
      identity.resourceId,
      undefined,
    )
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { score: 10 },
        validatedAt: '2026-08-26T14:58:00.000Z',
        authorizationGeneration: 4,
      }),
    )
    expect(Object.keys(materialize.mock.calls[0]![0].capabilities)).toEqual([
      'logger',
      'persistence',
    ])
    expect(scopedRoutinePersistenceValue.close).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
  })

  test('locks the declared section before rechecking eligibility and writing', async () => {
    await applyInstalledResourceObservation({
      ...observation(vi.fn().mockResolvedValue(undefined)),
      resource: {
        ...observation(vi.fn()).resource,
        sectionId: 'skills',
      },
      outcome: 'complete',
      data: {},
    })

    const sectionLockIndex = mocks.transaction.mock.calls.findIndex(([strings]) =>
      (strings as TemplateStringsArray).join(' ').includes('from deployment_module_sections'),
    )
    const sectionLock = mocks.transaction.mock.calls[sectionLockIndex]
    expect(sectionLock?.[1]).toBe(identity.moduleId)
    expect(sectionLock?.[2]).toBe('skills')
    expect(mocks.transaction.mock.invocationCallOrder[sectionLockIndex]).toBeLessThan(
      mocks.resolveEligibility.mock.invocationCallOrder[0]!,
    )
  })

  test('provides only generated methods to declared resource materialization', async () => {
    const controller = new AbortController()
    const materialize = vi.fn(async ({ capabilities }) => {
      expect(capabilities.persistence).toBe(scopedRoutinePersistenceValue.persistence)
    })
    const input = observation(materialize)

    await applyInstalledResourceObservation({
      ...input,
      resource: declaredPersistenceResource(input.resource),
      outcome: 'complete',
      data: { score: 10 },
      signal: controller.signal,
    })

    expect(mocks.createRoutinePersistence).toHaveBeenCalledWith(
      mocks.transaction,
      identity.moduleId,
      identity.resourceId,
      controller.signal,
    )
    expect(scopedRoutinePersistenceValue.close).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
  })

  test('does not record success for declared obsolete writes or caught operation failures', async () => {
    const obsoleteInput = observation(vi.fn(async () => ({ outcome: 'obsolete' as const })))
    await applyInstalledResourceObservation({
      ...obsoleteInput,
      resource: declaredPersistenceResource(obsoleteInput.resource),
      outcome: 'complete',
      data: { score: 10 },
    })
    expect(mocks.recordSuccess).not.toHaveBeenCalled()

    const failure = new Error('bounded operation failure')
    const caughtInput = observation(
      vi.fn(async ({ capabilities }) => {
        await capabilities.persistence.writeSnapshot().catch(() => undefined)
      }),
    )
    scopedRoutinePersistenceValue.persistence.writeSnapshot.mockRejectedValueOnce(failure)
    mocks.createRoutinePersistence.mockReturnValueOnce(scopedRoutinePersistence(failure))
    await expect(
      applyInstalledResourceObservation({
        ...caughtInput,
        resource: declaredPersistenceResource(caughtInput.resource),
        outcome: 'complete',
        data: { score: 10 },
      }),
    ).rejects.toBe(failure)
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('records execution failures without changing their queue classification', async () => {
    const failure = new PlatformResourceMappingError(new Error('mapper'))
    const recordFailure = vi.fn().mockResolvedValue(undefined)

    await expect(
      processInstalledResourceRefresh(identity, {
        executeOperation: vi.fn().mockRejectedValue(failure),
        recordFailure,
      }),
    ).rejects.toBe(failure)
    expect(recordFailure).toHaveBeenCalledWith(identity, failure, {})
  })

  test('carries the initial managed authority into failure recording', async () => {
    const failure = new PlatformResourceMappingError(new Error('mapper'))
    const recordFailure = vi.fn().mockResolvedValue(undefined)
    const executeOperation = vi.fn().mockImplementation(async (_identity, options) => {
      options.onAuthorityResolved({ authorizationGeneration: 4, managedAuthority })
      throw failure
    })

    await expect(
      processInstalledResourceRefresh(identity, { executeOperation, recordFailure }),
    ).rejects.toBe(failure)
    expect(recordFailure).toHaveBeenCalledWith(identity, failure, {
      expectedAuthorizationGeneration: 4,
      expectedManagedAuthority: managedAuthority,
    })
  })

  test('does not record collection failure when execution is cancelled', async () => {
    const controller = new AbortController()
    const recordFailure = vi.fn()
    const executeOperation = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw controller.signal.reason
    })

    await expect(
      processInstalledResourceRefresh(identity, {
        signal: controller.signal,
        executeOperation,
        recordFailure,
      }),
    ).rejects.toBe(controller.signal.reason)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  test('records post-ESI materialization failures as permanent persistence failures', async () => {
    const input = observation(vi.fn())
    const recordFailure = vi.fn().mockResolvedValue(undefined)

    await expect(
      processInstalledResourceRefresh(identity, {
        executeOperation: vi.fn().mockResolvedValue({
          outcome: 'loaded',
          resource: input.resource,
          subject: input.subject,
          authorizationGeneration: input.authorizationGeneration,
          managedAuthority: input.managedAuthority,
          result: {
            data: { score: 10 },
            cachedUntil: input.validatedAt,
            validatedAt: input.validatedAt,
            source: 'esi',
            stale: false,
            quota: {},
          },
        }),
        applyObservation: vi.fn().mockRejectedValue(new Error('database')),
        recordFailure,
      }),
    ).rejects.toBeInstanceOf(PlatformResourcePersistenceError)
    expect(recordFailure).toHaveBeenCalledWith(
      identity,
      expect.any(PlatformResourcePersistenceError),
      {
        expectedAuthorizationGeneration: 4,
        expectedManagedAuthority: null,
      },
    )
  })

  test('materializes core observations and recomputes every account when required', async () => {
    mocks.materializeCoreResourceObservation.mockResolvedValue({
      organizationVersion: 8,
      affectedCorporationIds: [],
      recomputeAllAccounts: true,
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
    expect(mocks.recomputeAllAccounts).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: 1,
      organizationVersion: 8,
      now: expect.any(Date),
      rotateManagedMemberLifecycles: false,
    })
    expect(mocks.recomputeManagedCorporations).not.toHaveBeenCalled()
  })

  test('rotates managed-member intervals when alliance authority recovers after a gap', async () => {
    mocks.loadState.mockResolvedValue({
      validatedAt: new Date('2026-08-26T13:00:00.000Z'),
      nextEligibleAt: new Date('2026-08-26T14:00:00.000Z'),
      lastFailureClass: null,
    })
    mocks.materializeCoreResourceObservation.mockResolvedValue({
      organizationVersion: 8,
      affectedCorporationIds: [],
      recomputeAllAccounts: true,
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.recomputeAllAccounts).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: 1,
      organizationVersion: 8,
      now: expect.any(Date),
      rotateManagedMemberLifecycles: true,
    })
  })

  test('recomputes only accounts affected by a core corporation observation', async () => {
    mocks.materializeCoreResourceObservation.mockResolvedValue({
      organizationVersion: 9,
      affectedCorporationIds: [98_000_001, 98_000_002],
      recomputeAllAccounts: false,
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.recomputeManagedCorporations).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: 1,
      organizationVersion: 9,
      corporationIds: [98_000_001, 98_000_002],
      now: expect.any(Date),
    })
  })

  test('does not advance collection state for obsolete or invalid core observations', async () => {
    mocks.materializeCoreResourceObservation.mockResolvedValue(null)
    await applyInstalledResourceObservation(coreObservation())
    expect(mocks.recordSuccess).not.toHaveBeenCalled()

    await expect(
      applyInstalledResourceObservation({
        ...coreObservation(),
        validatedAt: 'invalid',
      }),
    ).rejects.toThrow('ESI representation validation time is invalid')

    mocks.materializeCoreResourceObservation.mockResolvedValue({
      organizationVersion: 10,
      affectedCorporationIds: [],
      recomputeAllAccounts: false,
    })
    await applyInstalledResourceObservation(coreObservation())
    expect(mocks.recomputeAllAccounts).not.toHaveBeenCalled()
    expect(mocks.recomputeManagedCorporations).not.toHaveBeenCalled()
  })

  test('discards a core observation older than the serialized collection state', async () => {
    mocks.loadState.mockResolvedValue({
      validatedAt: new Date('2026-08-26T15:00:00.000Z'),
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.materializeCoreResourceObservation).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
    expect(mocks.recomputeAllAccounts).not.toHaveBeenCalled()
    expect(mocks.recomputeManagedCorporations).not.toHaveBeenCalled()
  })

  test('ignores unchanged core observations', async () => {
    await applyInstalledResourceObservation({
      ...coreObservation(),
      outcome: 'unchanged',
    })

    expect(mocks.databaseTransaction).not.toHaveBeenCalled()
  })
})

function observation(materialize: PlatformResourceOperationImplementation['materialize']) {
  const implementation = {
    operation: 'skills',
    request: vi.fn(),
    map: vi.fn(),
    materialize,
  } satisfies PlatformResourceOperationImplementation
  return {
    identity,
    resource: {
      moduleId: identity.moduleId,
      resourceId: identity.resourceId,
      operationId: 'skills',
      subjectKind: 'character' as const,
      materializationIntervalSeconds: 900,
      eligibility: { kind: 'current-owned-character' as const },
      implementation,
    },
    subject: {
      kind: 'character' as const,
      characterId: 1_404_328_063,
      lifecycleId: identity.subjectLifecycleId,
    },
    authorizationGeneration: 4,
    managedAuthority: null,
    validatedAt: '2026-08-26T14:58:00.000Z',
  }
}
const scopedRoutinePersistenceValue = {
  persistence: { writeSnapshot: vi.fn().mockResolvedValue({ outcome: 'applied' }) },
  close: vi.fn(),
}

function scopedRoutinePersistence(failure?: unknown) {
  return {
    ...scopedRoutinePersistenceValue,
    suppressedFailure: () => (failure === undefined ? undefined : { error: failure }),
  }
}

function declaredPersistenceResource<Resource extends object>(resource: Resource) {
  return {
    ...resource,
    persistence: {
      projection: [],
      materialization: [{ operationId: 'write-snapshot' }],
    },
  }
}

function coreObservation() {
  const input = observation(vi.fn())
  return {
    ...input,
    resource: {
      ...input.resource,
      moduleId: 'core',
      resourceId: 'managed-corporations',
    },
    subject: {
      kind: 'alliance' as const,
      allianceId: 99_000_001,
      lifecycleId: input.subject.lifecycleId,
    },
    outcome: 'complete' as const,
    data: { corporationIds: [98_000_001] },
  }
}
