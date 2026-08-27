import type { PlatformResourceOperationImplementation } from '@eve-space/platform-module-contract'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  createPersistence: vi.fn(),
  recordSuccess: vi.fn(),
  resolveEligibility: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({ sql: { begin: mocks.begin } }))
vi.mock('../src/db/module-persistence.js', () => ({
  createTransactionScopedModulePersistenceCapability: mocks.createPersistence,
}))
vi.mock('../src/platform/collection-status.js', () => ({
  recordInstalledResourceCollectionSuccess: mocks.recordSuccess,
}))
vi.mock('../src/platform/resource-eligibility.js', () => ({
  resolveInstalledResourceEligibility: mocks.resolveEligibility,
}))
vi.mock('../src/platform/collection-state-store.js', () => ({
  upsertPlatformCollectionStateInTransaction: vi.fn(),
}))

import {
  applyInstalledResourceObservation,
  processInstalledResourceRefresh,
} from '../src/platform/resource-refresh.js'
import {
  PlatformResourceMappingError,
  PlatformResourcePersistenceError,
} from '../src/platform/resource-failures.js'

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
    mocks.resolveEligibility.mockResolvedValue({
      status: 'eligible',
      due: true,
      authorizationGeneration: 4,
      nextEligibleAt: null,
    })
    mocks.recordSuccess.mockResolvedValue(undefined)
    mocks.createPersistence.mockReturnValue({ transaction: vi.fn() })
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
