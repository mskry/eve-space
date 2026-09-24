import type { PlatformSingleRequestResourceImplementation } from '@eve-space/platform-module-contract/resources'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  createRoutinePersistence: vi.fn(),
  databaseTransaction: vi.fn(),
  execute: vi.fn(),
  loadState: vi.fn(),
  materializeCoreResourceObservation: vi.fn(),
  recomputeAllAccounts: vi.fn(),
  recomputeManagedCorporations: vi.fn(),
  recordSuccess: vi.fn(),
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
  subjectId: '1404328063',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
} as const
const managedAuthority = {
  disclosureVersion: 1,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  organizationDeploymentId: 1 as const,
  organizationVersion: 7,
  sectionActivationVersion: 1,
  sectionId: 'skills',
  targetUserId: '00000000-0000-4000-8000-000000000002',
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
      authorizationGeneration: 4,
      due: true,
      managedAuthority: null,
      nextEligibleAt: null,
      status: 'eligible',
    })
    mocks.recordSuccess.mockResolvedValue(undefined)
    mocks.createRoutinePersistence.mockReturnValue(scopedRoutinePersistence())
  })

  test('persists a partial checkpoint without announcing successful collection', async () => {
    const materialize = vi.fn(async () => undefined)
    await applyInstalledResourceObservation({
      ...observation(materialize),
      complete: false,
      data: { cursor: 'opaque' },
      outcome: 'complete',
    })
    expect(materialize).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('rejects an observation from a superseded organization before module writes', async () => {
    const materialize = vi.fn(async () => undefined)
    mocks.transaction.mockResolvedValue([{ version: 3 }])
    await applyInstalledResourceObservation({
      ...observation(materialize),
      data: {},
      organizationVersion: 2,
      outcome: 'complete',
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).not.toHaveBeenCalled()
  })

  test('rejects an in-flight observation after its managed authority changes', async () => {
    const materialize = vi.fn(async () => undefined)
    mocks.resolveEligibility.mockResolvedValue({
      authorizationGeneration: 4,
      due: true,
      managedAuthority: {
        ...managedAuthority,
        managedMemberLifecycleId: '00000000-0000-4000-8000-000000000099',
      },
      nextEligibleAt: null,
      status: 'eligible',
    })

    await applyInstalledResourceObservation({
      ...observation(materialize),
      data: {},
      managedAuthority,
      outcome: 'complete',
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
      data: { score: 10 },
      outcome: 'complete',
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
        authorizationGeneration: 4,
        data: { score: 10 },
        validatedAt: '2026-08-26T14:58:00.000Z',
      }),
    )
    expect(Object.keys(materialize.mock.calls[0]![0].capabilities)).toStrictEqual([
      'logger',
      'persistence',
    ])
    expect(scopedRoutinePersistenceValue.close).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
  })

  test('locks the declared section before rechecking eligibility and writing', async () => {
    await applyInstalledResourceObservation({
      ...observation(vi.fn().mockResolvedValue(undefined)),
      data: {},
      outcome: 'complete',
      resource: {
        ...observation(vi.fn()).resource,
        sectionId: 'skills',
      },
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
      data: { score: 10 },
      outcome: 'complete',
      resource: declaredPersistenceResource(input.resource),
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
      data: { score: 10 },
      outcome: 'complete',
      resource: declaredPersistenceResource(obsoleteInput.resource),
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
        data: { score: 10 },
        outcome: 'complete',
        resource: declaredPersistenceResource(caughtInput.resource),
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
        executeOperation,
        recordFailure,
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  test('records post-ESI materialization failures as permanent persistence failures', async () => {
    const input = observation(vi.fn())
    const recordFailure = vi.fn().mockResolvedValue(undefined)

    await expect(
      processInstalledResourceRefresh(identity, {
        applyObservation: vi.fn().mockRejectedValue(new Error('database')),
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
      affectedCorporationIds: [],
      organizationVersion: 8,
      recomputeAllAccounts: true,
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
    expect(mocks.recomputeAllAccounts).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: 1,
      now: expect.any(Date),
      organizationVersion: 8,
      rotateManagedMemberLifecycles: false,
    })
    expect(mocks.recomputeManagedCorporations).not.toHaveBeenCalled()
  })

  test('rotates managed-member intervals when alliance authority recovers after a gap', async () => {
    mocks.loadState.mockResolvedValue({
      lastFailureClass: null,
      nextEligibleAt: new Date('2026-08-26T14:00:00.000Z'),
      validatedAt: new Date('2026-08-26T13:00:00.000Z'),
    })
    mocks.materializeCoreResourceObservation.mockResolvedValue({
      affectedCorporationIds: [],
      organizationVersion: 8,
      recomputeAllAccounts: true,
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.recomputeAllAccounts).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: 1,
      now: expect.any(Date),
      organizationVersion: 8,
      rotateManagedMemberLifecycles: true,
    })
  })

  test('recomputes only accounts affected by a core corporation observation', async () => {
    mocks.materializeCoreResourceObservation.mockResolvedValue({
      affectedCorporationIds: [98_000_001, 98_000_002],
      organizationVersion: 9,
      recomputeAllAccounts: false,
    })

    await applyInstalledResourceObservation(coreObservation())

    expect(mocks.recomputeManagedCorporations).toHaveBeenCalledWith(expect.anything(), {
      corporationIds: [98_000_001, 98_000_002],
      deploymentId: 1,
      now: expect.any(Date),
      organizationVersion: 9,
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
      affectedCorporationIds: [],
      organizationVersion: 10,
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

function observation(materialize: PlatformSingleRequestResourceImplementation['materialize']) {
  const implementation = {
    map: vi.fn(),
    materialize,
    mode: 'single-request',
    operation: 'skills',
    request: vi.fn(),
  } satisfies PlatformSingleRequestResourceImplementation
  return {
    authorizationGeneration: 4,
    identity,
    managedAuthority: null,
    resource: {
      eligibility: { kind: 'current-owned-character' as const },
      implementation,
      materializationIntervalSeconds: 900,
      moduleId: identity.moduleId,
      operationId: 'skills',
      resourceId: identity.resourceId,
      subjectKind: 'character' as const,
    },
    subject: {
      characterId: 1_404_328_063,
      kind: 'character' as const,
      lifecycleId: identity.subjectLifecycleId,
    },
    validatedAt: '2026-08-26T14:58:00.000Z',
  }
}
const scopedRoutinePersistenceValue = {
  close: vi.fn(),
  persistence: { writeSnapshot: vi.fn().mockResolvedValue({ outcome: 'applied' }) },
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
      materialization: [{ operationId: 'write-snapshot' }],
      projection: [],
    },
  }
}

function coreObservation() {
  const input = observation(vi.fn())
  return {
    ...input,
    data: { corporationIds: [98_000_001] },
    outcome: 'complete' as const,
    resource: {
      ...input.resource,
      moduleId: 'core',
      resourceId: 'managed-corporations',
    },
    subject: {
      allianceId: 99_000_001,
      kind: 'alliance' as const,
      lifecycleId: input.subject.lifecycleId,
    },
  }
}
