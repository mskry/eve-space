import type { PlatformResourceOperationImplementation } from '@eve-space/platform-module-contract'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  createPersistence: vi.fn(),
  databaseTransaction: vi.fn(),
  execute: vi.fn(),
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
vi.mock('../../src/db/module-persistence.js', () => ({
  createTransactionScopedModulePersistenceCapability: mocks.createPersistence,
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
  resolveInstalledResourceEligibility: mocks.resolveEligibility,
}))
vi.mock('../../src/platform/collection-state-store.js', () => ({
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

describe('local resource observations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockResolvedValue([])
    mocks.begin.mockImplementation((operation) => operation(mocks.transaction))
    mocks.databaseTransaction.mockImplementation((operation) =>
      operation({ execute: mocks.execute }),
    )
    mocks.resolveEligibility.mockResolvedValue({
      status: 'eligible',
      due: true,
      authorizationGeneration: 4,
      nextEligibleAt: null,
    })
    mocks.recordSuccess.mockResolvedValue(undefined)
    mocks.createPersistence.mockReturnValue(scopedPersistence())
  })

  test('advances unchanged checked state without rewriting module data', async () => {
    const materialize = vi.fn(async () => undefined)

    await applyInstalledResourceObservation({
      ...observation(materialize),
      outcome: 'unchanged',
    })

    expect(materialize).not.toHaveBeenCalled()
    expect(mocks.createPersistence).not.toHaveBeenCalled()
    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
    expect(mocks.recordSuccess).toHaveBeenCalledWith(
      identity,
      { validatedAt: '2026-08-26T14:58:00.000Z' },
      4,
      expect.anything(),
    )
  })

  test('passes complete worker-memory data to the existing materializer once', async () => {
    const materialize = vi.fn().mockResolvedValue(undefined)

    await applyInstalledResourceObservation({
      ...observation(materialize),
      outcome: 'complete',
      data: { score: 10 },
    })

    expect(materialize).toHaveBeenCalledOnce()
    expect(mocks.createPersistence).toHaveBeenCalledWith(mocks.transaction, identity.moduleId)
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { score: 10 },
        validatedAt: '2026-08-26T14:58:00.000Z',
        authorizationGeneration: 4,
      }),
    )
    expect(mocks.recordSuccess).toHaveBeenCalledOnce()
  })

  test('refuses to record success when the module swallows its own persistence failure', async () => {
    const failure = new Error('module write rejected')
    const materialize = vi.fn(async ({ capabilities }) => {
      await capabilities.persistence
        .transaction(async () => {
          throw failure
        })
        .catch(() => undefined)
    })
    mocks.createPersistence.mockReturnValue(scopedPersistence(failure))

    await expect(
      applyInstalledResourceObservation({
        ...observation(materialize),
        outcome: 'complete',
        data: { score: 10 },
      }),
    ).rejects.toBe(failure)

    expect(materialize).toHaveBeenCalledOnce()
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
    expect(recordFailure).toHaveBeenCalledWith(identity, failure)
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
    })
    expect(mocks.recomputeManagedCorporations).not.toHaveBeenCalled()
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
    validatedAt: '2026-08-26T14:58:00.000Z',
  }
}
function scopedPersistence(failure?: unknown) {
  return {
    capability: { transaction: vi.fn(async (operation) => operation({ query: vi.fn() })) },
    suppressedFailure: () => (failure === undefined ? undefined : { error: failure }),
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
