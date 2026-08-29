import { describe, expect, test, vi } from 'vitest'
import { CharacterTokenNotFoundError } from '../../src/auth/store.js'
import { guardInstalledResourceExecution } from '../../src/platform/resource-execution-guard.js'
import { ScopeRequiredError } from '../../src/auth/tokens.js'

const identity = {
  moduleId: 'test-feature',
  resourceId: 'wallet-balance',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
  subjectId: '1404328063',
} as const

const privateResource = {
  moduleId: identity.moduleId,
  resourceId: identity.resourceId,
  subjectKind: 'character',
  operationId: 'wallet-balance',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: () => Promise.resolve({}),
} as const

describe('platform resource execution guard', () => {
  test.each(['authorization-required', 'disabled', 'obsolete', 'resource-unavailable'] as const)(
    'completes %s queued work without token access',
    async (status) => {
      const loadAuthorization = vi.fn()

      await expect(
        guardInstalledResourceExecution(identity, {
          resources: [privateResource],
          resolveEligibility: vi.fn().mockResolvedValue({ status }),
          loadCharacterAuthorization: loadAuthorization,
        }),
      ).resolves.toEqual({ outcome: 'noop', reason: status })
      expect(loadAuthorization).not.toHaveBeenCalled()
    },
  )

  test('does not load a token when work is no longer due', async () => {
    const loadAuthorization = vi.fn()
    await expect(
      guardInstalledResourceExecution(identity, {
        resources: [privateResource],
        resolveEligibility: vi.fn().mockResolvedValue(eligible(4, false)),
        loadCharacterAuthorization: loadAuthorization,
      }),
    ).resolves.toEqual({ outcome: 'noop', reason: 'already-current' })
    expect(loadAuthorization).not.toHaveBeenCalled()
  })

  test('loads authorization only after the durable execution-time check', async () => {
    const order: string[] = []
    const resolveEligibility = vi.fn().mockImplementation(() => {
      order.push('eligibility')
      return Promise.resolve(eligible(4))
    })
    const loadCharacterAuthorization = vi.fn().mockImplementation(() => {
      order.push('token')
      return Promise.resolve({ accessToken: 'private', tokenVersion: 4 })
    })

    await expect(
      guardInstalledResourceExecution(identity, {
        resources: [privateResource],
        resolveEligibility,
        loadCharacterAuthorization,
      }),
    ).resolves.toMatchObject({
      outcome: 'ready',
      resource: privateResource,
      authorization: { tokenVersion: 4 },
    })
    expect(order).toEqual(['eligibility', 'token'])
    expect(loadCharacterAuthorization).toHaveBeenCalledWith(
      1404328063,
      identity.subjectLifecycleId,
      'esi-wallet.read_character_wallet.v1',
    )
  })

  test('rechecks durable state when token refresh advances the generation', async () => {
    const resolveEligibility = vi
      .fn()
      .mockResolvedValueOnce(eligible(4))
      .mockResolvedValueOnce({ status: 'obsolete' })

    await expect(
      guardInstalledResourceExecution(identity, {
        resources: [privateResource],
        resolveEligibility,
        loadCharacterAuthorization: vi
          .fn()
          .mockResolvedValue({ accessToken: 'private', tokenVersion: 5 }),
      }),
    ).resolves.toEqual({ outcome: 'noop', reason: 'obsolete' })
    expect(resolveEligibility).toHaveBeenCalledTimes(2)
  })

  test.each([
    [new ScopeRequiredError('esi-wallet.read_character_wallet.v1'), 'authorization-required'],
    [new CharacterTokenNotFoundError(), 'obsolete'],
  ] as const)(
    'converts stale authorization access into a successful no-op',
    async (error, reason) => {
      await expect(
        guardInstalledResourceExecution(identity, {
          resources: [privateResource],
          resolveEligibility: vi.fn().mockResolvedValue(eligible(4)),
          loadCharacterAuthorization: vi.fn().mockRejectedValue(error),
        }),
      ).resolves.toEqual({ outcome: 'noop', reason })
    },
  )

  test('does not access character tokens for public operations', async () => {
    const publicResource = { ...privateResource, operationId: 'public-character' }
    const loadCharacterAuthorization = vi.fn()

    await expect(
      guardInstalledResourceExecution(identity, {
        resources: [publicResource],
        resolveEligibility: vi.fn().mockResolvedValue(eligible(null)),
        loadCharacterAuthorization,
      }),
    ).resolves.toMatchObject({ outcome: 'ready', authorization: null })
    expect(loadCharacterAuthorization).not.toHaveBeenCalled()
  })
})

function eligible(authorizationGeneration: number | null, due = true) {
  return {
    status: 'eligible' as const,
    due,
    authorizationGeneration,
    nextEligibleAt: null,
  }
}
