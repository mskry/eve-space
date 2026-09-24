import { describe, expect, test, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  getCharacterCacheAuthorizationForLifecycle: vi.fn(),
}))

vi.mock('../../src/auth/tokens.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/auth/tokens.js')>()),
  getCharacterCacheAuthorizationForLifecycle: authMocks.getCharacterCacheAuthorizationForLifecycle,
}))

import { CharacterTokenNotFoundError } from '../../src/auth/character-token-store.js'
import { guardInstalledResourceExecution } from '../../src/platform/resource-execution-guard.js'
import { ScopeRequiredError } from '../../src/auth/token-errors.js'
import { coreResources } from '../../src/platform/core-resources.js'

const identity = {
  moduleId: 'test-feature',
  resourceId: 'wallet-balance',
  subjectId: '1404328063',
  subjectKind: 'character',
  subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
} as const

const privateResource = {
  eligibility: { kind: 'current-owned-character' },
  implementation: () => Promise.resolve({}),
  materializationIntervalSeconds: 900,
  moduleId: identity.moduleId,
  operationId: 'wallet-balance',
  resourceId: identity.resourceId,
  subjectKind: 'character',
} as const

describe('platform resource execution guard', () => {
  test.each(['authorization-required', 'disabled', 'obsolete', 'resource-unavailable'] as const)(
    'completes %s queued work without token access',
    async (status) => {
      const loadAuthorization = vi.fn()

      await expect(
        guardInstalledResourceExecution(identity, {
          loadCharacterCacheAuthorization: loadAuthorization,
          resolveEligibility: vi.fn().mockResolvedValue({ status }),
          resources: [privateResource],
        }),
      ).resolves.toStrictEqual({ outcome: 'noop', reason: status })
      expect(loadAuthorization).not.toHaveBeenCalled()
    },
  )

  test('does not load a token when work is no longer due', async () => {
    const loadAuthorization = vi.fn()
    await expect(
      guardInstalledResourceExecution(identity, {
        loadCharacterCacheAuthorization: loadAuthorization,
        resolveEligibility: vi.fn().mockResolvedValue(eligible(4, false)),
        resources: [privateResource],
      }),
    ).resolves.toStrictEqual({ outcome: 'noop', reason: 'already-current' })
    expect(loadAuthorization).not.toHaveBeenCalled()
  })

  test('loads authorization only after the durable execution-time check', async () => {
    const order: string[] = []
    const resolveEligibility = vi.fn().mockImplementation(() => {
      order.push('eligibility')
      return Promise.resolve(eligible(4))
    })
    authMocks.getCharacterCacheAuthorizationForLifecycle.mockImplementation(() => {
      order.push('token')
      return Promise.resolve({ scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 4 })
    })

    const guarded = await guardInstalledResourceExecution(identity, {
      resolveEligibility,
      resources: [privateResource],
    })
    expect(guarded).toMatchObject({
      authorization: { tokenVersion: 4 },
      outcome: 'ready',
      resource: privateResource,
    })
    expect(guarded).not.toHaveProperty('authorization.accessToken')
    expect(order).toStrictEqual(['eligibility', 'token'])
    expect(authMocks.getCharacterCacheAuthorizationForLifecycle).toHaveBeenCalledWith(
      1_404_328_063,
      identity.subjectLifecycleId,
      'esi-wallet.read_character_wallet.v1',
    )
  })

  test('rechecks durable state when cache authorization has a newer generation', async () => {
    const resolveEligibility = vi
      .fn()
      .mockResolvedValueOnce(eligible(4))
      .mockResolvedValueOnce({ status: 'obsolete' })

    await expect(
      guardInstalledResourceExecution(identity, {
        loadCharacterCacheAuthorization: vi
          .fn()
          .mockResolvedValue({ scopes: ['esi-wallet.read_character_wallet.v1'], tokenVersion: 5 }),
        resolveEligibility,
        resources: [privateResource],
      }),
    ).resolves.toStrictEqual({ outcome: 'noop', reason: 'obsolete' })
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
          loadCharacterCacheAuthorization: vi.fn().mockRejectedValue(error),
          resolveEligibility: vi.fn().mockResolvedValue(eligible(4)),
          resources: [privateResource],
        }),
      ).resolves.toStrictEqual({ outcome: 'noop', reason })
    },
  )

  test('does not access character tokens for public operations', async () => {
    const publicResource = { ...privateResource, operationId: 'public-character' }
    const loadCharacterAuthorization = vi.fn()

    await expect(
      guardInstalledResourceExecution(identity, {
        loadCharacterCacheAuthorization: loadCharacterAuthorization,
        resolveEligibility: vi.fn().mockResolvedValue(eligible(null)),
        resources: [publicResource],
      }),
    ).resolves.toMatchObject({ authorization: null, outcome: 'ready' })
    expect(loadCharacterAuthorization).not.toHaveBeenCalled()
  })

  test('loads a corporation resource token from its source-character lifecycle', async () => {
    const sourceLifecycleId = '70eb0397-adff-4a82-94d6-065bd2149ea8'
    const corporationIdentity = {
      moduleId: 'core',
      resourceId: 'corporation-roster',
      subjectId: '98000001',
      subjectKind: 'corporation' as const,
      subjectLifecycleId: '34b4904d-c8d2-451a-b1d2-465f4bac99c4',
    }
    const loadCharacterAuthorization = vi
      .fn()
      .mockResolvedValue({ accessToken: 'private', tokenVersion: 7 })
    const isCorporationSourceCurrent = vi.fn().mockResolvedValue(true)

    await expect(
      guardInstalledResourceExecution(corporationIdentity, {
        isCorporationSourceCurrent,
        loadCharacterAuthorization,
        resolveEligibility: vi.fn().mockResolvedValue({
          ...eligible(7),
          authorizationCharacterId: 1_404_328_063,
          authorizationCharacterLifecycleId: sourceLifecycleId,
        }),
        resources: [coreResources[1]],
      }),
    ).resolves.toMatchObject({
      authorizationCharacterId: 1_404_328_063,
      outcome: 'ready',
      subject: { corporationId: 98_000_001, kind: 'corporation' },
    })
    expect(loadCharacterAuthorization).toHaveBeenCalledWith(
      1_404_328_063,
      sourceLifecycleId,
      'esi-corporations.read_corporation_membership.v1',
    )
    expect(isCorporationSourceCurrent).toHaveBeenCalledTimes(2)
    expect(isCorporationSourceCurrent).toHaveBeenCalledWith({
      authorizationGeneration: 7,
      characterId: 1_404_328_063,
      characterSubjectLifecycleId: sourceLifecycleId,
      corporationSubjectLifecycleId: corporationIdentity.subjectLifecycleId,
    })
  })

  test('runs managed-alliance discovery without character authorization', async () => {
    const loadCharacterAuthorization = vi.fn()
    await expect(
      guardInstalledResourceExecution(
        {
          moduleId: 'core',
          resourceId: 'managed-corporations',
          subjectId: '99000001',
          subjectKind: 'alliance',
          subjectLifecycleId: '34b4904d-c8d2-451a-b1d2-465f4bac99c4',
        },
        {
          loadCharacterAuthorization,
          resolveEligibility: vi.fn().mockResolvedValue(eligible(null)),
          resources: [coreResources[0]],
        },
      ),
    ).resolves.toMatchObject({
      authorization: null,
      outcome: 'ready',
      subject: { allianceId: 99_000_001, kind: 'alliance' },
    })
    expect(loadCharacterAuthorization).not.toHaveBeenCalled()
  })
})

function eligible(authorizationGeneration: number | null, due = true) {
  return {
    authorizationGeneration,
    due,
    nextEligibleAt: null,
    status: 'eligible' as const,
  }
}
