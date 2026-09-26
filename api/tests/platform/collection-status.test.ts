import { describe, expect, test, vi } from 'vitest'
import {
  getInstalledResourceCollectionStatus,
  recordInstalledResourceCollectionSuccess,
} from '../../src/platform/collection-status.js'

const identity = {
  moduleId: 'test-feature',
  resourceId: 'wallet-balance',
  subjectId: '1404328063',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
} as const

const resource = {
  eligibility: { kind: 'current-owned-character' },
  implementation: () => Promise.resolve({}),
  materializationIntervalSeconds: 900,
  moduleId: identity.moduleId,
  operationId: 'wallet-balance',
  resourceId: identity.resourceId,
  subjectKind: 'character',
} as const

describe('platform collection status', () => {
  test.each([
    [false, 'current'],
    [true, 'stale'],
  ] as const)('projects collected due=%s state as %s', async (due, status) => {
    const validatedAt = new Date('2026-08-26T10:00:00.000Z')
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resolveEligibility: vi.fn().mockResolvedValue(eligible(due, { validatedAt })),
        resources: [resource],
      }),
    ).resolves.toStrictEqual({
      authorizationGeneration: 4,
      lastFailureClass: null,
      status,
      validatedAt: validatedAt.toISOString(),
    })
  })

  test('distinguishes never-collected from an unavailable initial collection', async () => {
    const resolveEligibility = vi.fn().mockResolvedValue(eligible())
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resolveEligibility,
        resources: [resource],
      }),
    ).resolves.toStrictEqual({
      authorizationGeneration: 4,
      lastFailureClass: null,
      status: 'never-collected',
      validatedAt: null,
    })
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resolveEligibility: vi
          .fn()
          .mockResolvedValue(eligible(true, { lastFailureClass: 'esi-unavailable' })),
        resources: [resource],
      }),
    ).resolves.toStrictEqual({
      authorizationGeneration: 4,
      lastFailureClass: 'esi-unavailable',
      status: 'unavailable',
      validatedAt: null,
    })
  })

  test('keeps a retained failed collection stale during retry backoff', async () => {
    const validatedAt = new Date('2026-08-26T10:00:00.000Z')
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resolveEligibility: vi
          .fn()
          .mockResolvedValue(eligible(false, { validatedAt, lastFailureClass: 'esi-unavailable' })),
        resources: [resource],
      }),
    ).resolves.toStrictEqual({
      authorizationGeneration: 4,
      lastFailureClass: 'esi-unavailable',
      status: 'stale',
      validatedAt: validatedAt.toISOString(),
    })
  })

  test('reports a safe character-bound reauthorization path', async () => {
    await expect(
      getInstalledResourceCollectionStatus(identity, {
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
        resources: [resource],
      }),
    ).resolves.toStrictEqual({
      authorizationGeneration: 4,
      authorizationReason: 'scope-missing',
      lastFailureClass: 'authorization-required',
      reauthorizationPath: '/auth/eve/reauthorize/1404328063',
      requiredScope: 'esi-wallet.read_character_wallet.v1',
      status: 'authorization-required',
      validatedAt: null,
    })
  })

  test('reports reviewed role and source failures without OAuth remediation or observed roles', async () => {
    for (const authorizationReason of [
      'role-unsatisfied',
      'role-evidence-unavailable',
      'source-invalid',
    ] as const) {
      const status = await getInstalledResourceCollectionStatus(identity, {
        resolveEligibility: vi.fn().mockResolvedValue({
          status: 'authorization-required',
          authorizationReason,
          authorizationGeneration: 4,
          requiredScope: 'esi-corporations.read_freelance_jobs.v1',
          ...(authorizationReason !== 'source-invalid' && {
            requiredRolePredicates: ['project-manager'],
          }),
          dueReason: null,
          schedulingKey: null,
          nextEligibleAt: null,
          validatedAt: null,
          lastFailureClass: null,
        }),
        resources: [resource],
      })
      expect(status).toMatchObject({ status: 'authorization-required', authorizationReason })
      expect(status).not.toHaveProperty('reauthorizationPath')
      expect(JSON.stringify(status)).not.toContain('Project_Manager')
      expect(status).not.toHaveProperty('roleRevision')
    }
  })

  test('retains the last safe validation time when a resource becomes unavailable', async () => {
    const validatedAt = new Date('2026-08-26T10:00:00.000Z')
    await expect(
      getInstalledResourceCollectionStatus(identity, {
        resolveEligibility: vi.fn().mockResolvedValue({
          status: 'disabled',
          authorizationGeneration: 4,
          dueReason: null,
          schedulingKey: null,
          nextEligibleAt: null,
          validatedAt,
          lastFailureClass: null,
        }),
        resources: [resource],
      }),
    ).resolves.toStrictEqual({
      authorizationGeneration: 4,
      lastFailureClass: null,
      status: 'unavailable',
      validatedAt: validatedAt.toISOString(),
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
      expect(write.validatedAt).toStrictEqual(new Date(validatedAt))
      expect(write.nextEligibleAt).toStrictEqual(new Date('2026-08-26T10:15:00.000Z'))
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
    authorizationGeneration: 4,
    due,
    dueReason: (due ? 'elapsed' : 'future') as 'elapsed' | 'future',
    lastFailureClass: null,
    nextEligibleAt: null,
    schedulingKey: new Date('2026-08-26T10:15:00.000Z'),
    status: 'eligible' as const,
    validatedAt: null,
    ...values,
  }
}
