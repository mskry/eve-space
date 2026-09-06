import { describe, expect, test, vi } from 'vitest'
import {
  getInstalledResourceCollectionStatus,
  recordInstalledResourceCollectionSuccess,
} from '../../src/platform/collection-status.js'

const identity = {
  moduleId: 'test-feature',
  resourceId: 'wallet-balance',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
  subjectId: '1404328063',
} as const

const resource = {
  moduleId: identity.moduleId,
  resourceId: identity.resourceId,
  subjectKind: 'character',
  operationId: 'wallet-balance',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: () => Promise.resolve({}),
} as const

describe('platform collection status', () => {
  test.each([
    [false, 'current'],
    [true, 'stale'],
  ] as const)('projects collected due=%s state as %s', async (due, status) => {
    const validatedAt = new Date('2026-08-26T10:00:00.000Z')
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resources: [resource],
        resolveEligibility: vi.fn().mockResolvedValue(eligible(due, { validatedAt })),
      }),
    ).resolves.toEqual({ status, validatedAt: validatedAt.toISOString(), lastFailureClass: null })
  })

  test('distinguishes never-collected from an unavailable initial collection', async () => {
    const resolveEligibility = vi.fn().mockResolvedValue(eligible())
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resources: [resource],
        resolveEligibility,
      }),
    ).resolves.toEqual({
      status: 'never-collected',
      validatedAt: null,
      lastFailureClass: null,
    })
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resources: [resource],
        resolveEligibility: vi
          .fn()
          .mockResolvedValue(eligible(true, { lastFailureClass: 'esi-unavailable' })),
      }),
    ).resolves.toEqual({
      status: 'unavailable',
      validatedAt: null,
      lastFailureClass: 'esi-unavailable',
    })
  })

  test('keeps a retained failed collection stale during retry backoff', async () => {
    const validatedAt = new Date('2026-08-26T10:00:00.000Z')
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resources: [resource],
        resolveEligibility: vi
          .fn()
          .mockResolvedValue(eligible(false, { validatedAt, lastFailureClass: 'esi-unavailable' })),
      }),
    ).resolves.toEqual({
      status: 'stale',
      validatedAt: validatedAt.toISOString(),
      lastFailureClass: 'esi-unavailable',
    })
  })

  test('reports a safe character-bound reauthorization path', async () => {
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resources: [resource],
        resolveEligibility: vi.fn().mockResolvedValue({
          status: 'authorization-required',
          authorizationGeneration: 4,
          requiredScope: 'esi-wallet.read_character_wallet.v1',
          dueReason: null,
          schedulingKey: null,
          nextEligibleAt: null,
          validatedAt: null,
          lastFailureClass: null,
        }),
      }),
    ).resolves.toEqual({
      status: 'authorization-required',
      validatedAt: null,
      lastFailureClass: 'authorization-required',
      requiredScope: 'esi-wallet.read_character_wallet.v1',
      reauthorizationPath: '/auth/eve/reauthorize/1404328063',
    })
  })

  test('retains the last safe validation time when a resource becomes unavailable', async () => {
    const validatedAt = new Date('2026-08-26T10:00:00.000Z')
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resources: [resource],
        resolveEligibility: vi.fn().mockResolvedValue({
          status: 'disabled',
          authorizationGeneration: 4,
          dueReason: null,
          schedulingKey: null,
          nextEligibleAt: null,
          validatedAt,
          lastFailureClass: null,
        }),
      }),
    ).resolves.toEqual({
      status: 'unavailable',
      validatedAt: validatedAt.toISOString(),
      lastFailureClass: null,
    })
  })

  test('records representation validation time without sliding on cache-read time', async () => {
    const upsertState = vi.fn().mockImplementation((input) => Promise.resolve(input))
    const validatedAt = '2026-08-26T10:00:00.000Z'

    await recordInstalledResourceCollectionSuccess(identity, { validatedAt }, 4, {
      resources: [resource],
      upsertState,
    })
    await recordInstalledResourceCollectionSuccess(identity, { validatedAt }, 4, {
      resources: [resource],
      upsertState,
    })

    expect(upsertState).toHaveBeenCalledTimes(2)
    for (const [write] of upsertState.mock.calls) {
      expect(write.validatedAt).toEqual(new Date(validatedAt))
      expect(write.nextEligibleAt).toEqual(new Date('2026-08-26T10:15:00.000Z'))
      expect(write.lastFailureClass).toBeNull()
    }
  })
})

function eligible(
  due = true,
  values: Partial<{
    validatedAt: Date | null
    lastFailureClass: 'esi-unavailable' | null
  }> = {},
) {
  return {
    status: 'eligible' as const,
    due,
    dueReason: (due ? 'elapsed' : 'future') as 'elapsed' | 'future',
    schedulingKey: new Date('2026-08-26T10:15:00.000Z'),
    authorizationGeneration: 4,
    nextEligibleAt: null,
    validatedAt: null,
    lastFailureClass: null,
    ...values,
  }
}
