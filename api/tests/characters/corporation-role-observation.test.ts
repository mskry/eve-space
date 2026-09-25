import { EsiHttpError } from '@evespace/esi-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CharacterTokenNotFoundError } from '../../src/auth/character-token-store.js'
import { EveSsoTokenRefreshError } from '../../src/auth/sso.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/token-errors.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'

const mocks = vi.hoisted(() => ({ readCharacterCorporationRoles: vi.fn() }))

vi.mock('../../src/characters/corporation-roles.js', () => ({
  readCharacterCorporationRoles: mocks.readCharacterCorporationRoles,
}))

const { attemptCorporationRoleRead, classifyCorporationRoleFailure } =
  await import('../../src/characters/corporation-role-observation.js')

const binding = {
  affiliationPeriodRevision: '22222222-2222-4222-8222-222222222222',
  authorityCorporationId: 98_000_001,
  authorizationGeneration: 3,
  characterId: 1_404_328_063,
  organizationVersion: 2,
  subjectLifecycleId: '11111111-1111-4111-8111-111111111111',
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
}
const affiliationFreshUntil = new Date('2026-09-25T13:00:00.000Z')
const read = {
  authorizationGeneration: 3,
  cachedUntil: new Date('2026-09-25T13:00:00.000Z'),
  retryAt: null,
  roles: { roles: ['Director'], rolesAtBase: [], rolesAtHeadquarters: [], rolesAtOther: [] },
  stale: false,
  validatedAt: new Date('2026-09-25T12:00:00.000Z'),
}

beforeEach(() => {
  mocks.readCharacterCorporationRoles.mockReset()
})

describe('corporation-role failure classification', () => {
  test.each([
    [new ScopeRequiredError('scope'), 'missing-scope'],
    [new CharacterTokenNotFoundError(), 'authorization-missing'],
    [new EveSsoTokenRefreshError(400, true), 'authorization-revoked'],
    [
      new EsiHttpError({ operationId: 'GetCharactersCharacterIdRoles', status: 403 }),
      'authorization-rejected',
    ],
    [
      new EsiHttpError({ operationId: 'GetCharactersCharacterIdRoles', status: 401 }),
      'authorization-rejected',
    ],
  ])('classifies definitive authorization loss as strict', (error, failureClass) => {
    expect(classifyCorporationRoleFailure(error)).toStrictEqual({ failureClass, kind: 'strict' })
  })

  test('keeps provider cooldown precedence on quota failures', () => {
    const retryAt = new Date('2026-09-25T12:30:00.000Z')
    expect(classifyCorporationRoleFailure(new EsiQuotaError(60, 0, retryAt))).toStrictEqual({
      failureClass: 'esi-cooldown',
      kind: 'transient',
      retryAt,
    })
  })

  test.each([
    [new EveSsoTokenRefreshError(503, false), 'sso-unavailable'],
    [new TokenRefreshUnavailableError(), 'sso-unavailable'],
    [
      new EsiHttpError({ operationId: 'GetCharactersCharacterIdRoles', status: 503 }),
      'esi-unavailable',
    ],
  ])('never infers role loss from unavailable evidence', (error, failureClass) => {
    expect(classifyCorporationRoleFailure(error)).toStrictEqual({
      failureClass,
      kind: 'transient',
      retryAt: null,
    })
  })

  test('leaves programming and persistence failures for the worker to retry', () => {
    expect(classifyCorporationRoleFailure(new Error('database unavailable'))).toBeNull()
  })
})

describe('corporation-role read attempts', () => {
  test('reads through the period-bound representation and preserves the sequence', async () => {
    mocks.readCharacterCorporationRoles.mockResolvedValue(read)

    await expect(
      attemptCorporationRoleRead({ affiliationFreshUntil, binding, sequence: 9n }),
    ).resolves.toStrictEqual({
      affiliationFreshUntil,
      binding,
      outcome: { kind: 'observed', read },
      sequence: 9n,
    })
    expect(mocks.readCharacterCorporationRoles).toHaveBeenCalledWith({
      affiliationPeriodRevision: binding.affiliationPeriodRevision,
      characterId: binding.characterId,
      subjectLifecycleId: binding.subjectLifecycleId,
    })
  })

  test('treats a stale response as unavailable evidence rather than a role change', async () => {
    const retryAt = new Date('2026-09-25T12:10:00.000Z')
    mocks.readCharacterCorporationRoles.mockResolvedValue({ ...read, retryAt, stale: true })

    await expect(
      attemptCorporationRoleRead({ affiliationFreshUntil, binding, sequence: 10n }),
    ).resolves.toMatchObject({
      outcome: {
        failure: { failureClass: 'stale-role-evidence', kind: 'transient', retryAt },
        kind: 'failed',
      },
    })
  })

  test('returns classified failures and rethrows unclassified ones', async () => {
    mocks.readCharacterCorporationRoles.mockRejectedValueOnce(new CharacterTokenNotFoundError())
    await expect(
      attemptCorporationRoleRead({ affiliationFreshUntil, binding, sequence: 11n }),
    ).resolves.toMatchObject({
      outcome: { failure: { failureClass: 'authorization-missing', kind: 'strict' } },
    })

    const unexpected = new Error('unexpected')
    mocks.readCharacterCorporationRoles.mockRejectedValueOnce(unexpected)
    await expect(
      attemptCorporationRoleRead({ affiliationFreshUntil, binding, sequence: 12n }),
    ).rejects.toBe(unexpected)
  })

  test('propagates cancellation instead of recording an outcome', async () => {
    const controller = new AbortController()
    mocks.readCharacterCorporationRoles.mockImplementation(
      ({ signal }: { readonly signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new EsiQuotaError(1)), { once: true })
        }),
    )

    const pending = attemptCorporationRoleRead({
      affiliationFreshUntil,
      binding,
      sequence: 13n,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mocks.readCharacterCorporationRoles).toHaveBeenCalledOnce())
    controller.abort()

    await expect(pending).rejects.toBe(controller.signal.reason)
  })
})
