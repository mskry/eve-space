import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CharacterTokenNotFoundError extends Error {}
  class EveSsoTokenRefreshError extends Error {
    constructor(
      readonly status: number,
      readonly authorizationRevoked: boolean,
    ) {
      super('refresh failed')
    }
  }
  class TokenRefreshLockUnavailableError extends Error {}
  return {
    CharacterTokenNotFoundError,
    EveSsoTokenRefreshError,
    TokenRefreshLockUnavailableError,
    appendDomainEvent: vi.fn(),
    decryptTokens: vi.fn(),
    deleteCharacterTokenAuthorization: vi.fn(),
    encryptTokens: vi.fn(),
    findCharacterCacheAuthorizationForLifecycle: vi.fn(),
    findCharacterTokenForLifecycle: vi.fn(),
    lockCurrentOrganizationVersionForCompliance: vi.fn(),
    recomputeOrganizationAccountCompliance: vi.fn(),
    refreshAccessToken: vi.fn(),
    updateCharacterToken: vi.fn(),
    verifyAccessToken: vi.fn(),
    withCharacterTokenLifecycleLock: vi.fn(),
  }
})

vi.mock('../../src/auth/character-token-store.js', () => ({
  CharacterTokenNotFoundError: mocks.CharacterTokenNotFoundError,
  deleteCharacterTokenAuthorization: mocks.deleteCharacterTokenAuthorization,
  TokenRefreshLockUnavailableError: mocks.TokenRefreshLockUnavailableError,
  findCharacterCacheAuthorizationForLifecycle: mocks.findCharacterCacheAuthorizationForLifecycle,
  findCharacterTokenForLifecycle: mocks.findCharacterTokenForLifecycle,
  updateCharacterToken: mocks.updateCharacterToken,
  withCharacterTokenLifecycleLock: mocks.withCharacterTokenLifecycleLock,
}))

vi.mock('../../src/domain-events/store.js', () => ({
  appendDomainEvent: mocks.appendDomainEvent,
}))

vi.mock('../../src/organization/compliance.js', () => ({
  lockCurrentOrganizationVersionForCompliance: mocks.lockCurrentOrganizationVersionForCompliance,
  recomputeOrganizationAccountCompliance: mocks.recomputeOrganizationAccountCompliance,
}))

vi.mock('../../src/auth/sso.js', () => ({
  EveSsoTokenRefreshError: mocks.EveSsoTokenRefreshError,
  refreshAccessToken: mocks.refreshAccessToken,
  verifyAccessToken: mocks.verifyAccessToken,
}))

vi.mock('../../src/auth/security.js', () => ({
  decryptTokens: mocks.decryptTokens,
  encryptTokens: mocks.encryptTokens,
}))

import {
  getCharacterAccessToken as getCharacterAccessTokenForLifecycle,
  getCharacterAuthorization as getCharacterAuthorizationForLifecycleAlias,
  getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorization as getCharacterCacheAuthorizationForLifecycleAlias,
  getCharacterCacheAuthorizationForLifecycle,
  ScopeRequiredError,
  TokenRefreshUnavailableError,
  withCharacterAuthorizationForLifecycle,
} from '../../src/auth/tokens.js'
import { SsoTokenRejectedError, SsoTransportError } from '../../src/auth/sso-errors.js'

const characterId = 1404328063
const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const scope = 'esi-wallet.read_character_wallet.v1'
const subjectLifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
const expired = {
  userId,
  encryptedTokens: 'original',
  accessTokenExpiresAt: new Date(0),
  scopes: [scope],
  tokenVersion: 1,
}

function getCharacterAccessToken(targetCharacterId: number, requiredScope: string) {
  return getCharacterAccessTokenForLifecycle(targetCharacterId, subjectLifecycleId, requiredScope)
}

function getCharacterAuthorization(
  targetCharacterId: number,
  requiredScope: string,
  signal?: AbortSignal,
) {
  return getCharacterAuthorizationForLifecycleAlias(
    targetCharacterId,
    subjectLifecycleId,
    requiredScope,
    signal,
  )
}

function getCharacterCacheAuthorization(
  targetCharacterId: number,
  requiredScope: string,
  signal?: AbortSignal,
) {
  return getCharacterCacheAuthorizationForLifecycleAlias(
    targetCharacterId,
    subjectLifecycleId,
    requiredScope,
    signal,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.decryptTokens.mockImplementation((encryptedTokens: string) => ({
    accessToken: `${encryptedTokens}-access`,
    refreshToken: `${encryptedTokens}-refresh`,
  }))
  mocks.encryptTokens.mockReturnValue('refreshed')
  mocks.deleteCharacterTokenAuthorization.mockResolvedValue(true)
  mocks.findCharacterTokenForLifecycle.mockResolvedValue(expired)
  mocks.lockCurrentOrganizationVersionForCompliance.mockResolvedValue(4)
  mocks.recomputeOrganizationAccountCompliance.mockResolvedValue({ outcome: 'unchanged' })
  mocks.findCharacterCacheAuthorizationForLifecycle.mockResolvedValue(expired)
  mocks.updateCharacterToken.mockResolvedValue(true)
  mocks.withCharacterTokenLifecycleLock.mockImplementation(
    async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
  )
  mocks.refreshAccessToken.mockResolvedValue({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 1200,
    token_type: 'Bearer',
  })
  mocks.verifyAccessToken.mockResolvedValue({ characterId, characterName: 'Test', scopes: [scope] })
})

describe('token refresh', () => {
  test('reads direct and lifecycle cache authorization without token material', async () => {
    await expect(getCharacterCacheAuthorization(characterId, scope)).resolves.toEqual({
      scopes: [scope],
      tokenVersion: 1,
    })
    await expect(
      getCharacterCacheAuthorizationForLifecycle(characterId, subjectLifecycleId, scope),
    ).resolves.toEqual({ scopes: [scope], tokenVersion: 1 })

    expect(mocks.findCharacterCacheAuthorizationForLifecycle).toHaveBeenCalledWith(
      characterId,
      subjectLifecycleId,
    )
    expect(mocks.findCharacterCacheAuthorizationForLifecycle).toHaveBeenCalledWith(
      characterId,
      subjectLifecycleId,
    )
    expect(mocks.decryptTokens).not.toHaveBeenCalled()
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled()
    expect(mocks.verifyAccessToken).not.toHaveBeenCalled()
    expect(mocks.withCharacterTokenLifecycleLock).not.toHaveBeenCalled()
  })

  test('rejects missing cache tokens and scopes before token material access', async () => {
    mocks.findCharacterCacheAuthorizationForLifecycle.mockResolvedValueOnce(null)
    await expect(getCharacterCacheAuthorization(characterId, scope)).rejects.toBeInstanceOf(
      mocks.CharacterTokenNotFoundError,
    )

    mocks.findCharacterCacheAuthorizationForLifecycle.mockResolvedValueOnce({
      scopes: [],
      tokenVersion: 2,
    })
    await expect(
      getCharacterCacheAuthorizationForLifecycle(characterId, 'lifecycle', scope),
    ).rejects.toBeInstanceOf(ScopeRequiredError)
    expect(mocks.decryptTokens).not.toHaveBeenCalled()
  })

  test('binds fresh authorization to the requested ownership lifecycle', async () => {
    const fresh = { ...expired, accessTokenExpiresAt: new Date(Date.now() + 120_000) }
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(fresh, {}),
    )

    await expect(
      getCharacterAuthorizationForLifecycle(characterId, subjectLifecycleId, scope),
    ).resolves.toEqual({ accessToken: 'original-access', tokenVersion: 1 })
    expect(mocks.withCharacterTokenLifecycleLock).toHaveBeenCalledWith(
      characterId,
      subjectLifecycleId,
      expect.any(Function),
    )
    expect(mocks.findCharacterTokenForLifecycle).not.toHaveBeenCalled()
  })

  test('does not fall through to a replacement lifecycle token', async () => {
    mocks.withCharacterTokenLifecycleLock.mockRejectedValue(new mocks.CharacterTokenNotFoundError())

    await expect(
      getCharacterAuthorizationForLifecycle(
        characterId,
        '35acd527-9539-44ad-aacf-9f8e45232267',
        scope,
      ),
    ).rejects.toBeInstanceOf(mocks.CharacterTokenNotFoundError)
    expect(mocks.decryptTokens).not.toHaveBeenCalled()
  })

  test('rechecks generation under the lifecycle lock before executing a mutation', async () => {
    const freshVersionOne = {
      ...expired,
      accessTokenExpiresAt: new Date(Date.now() + 120_000),
    }
    const freshVersionTwo = {
      ...freshVersionOne,
      encryptedTokens: 'replacement',
      tokenVersion: 2,
    }
    mocks.withCharacterTokenLifecycleLock
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) =>
        operation(freshVersionOne, {}),
      )
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) =>
        operation(freshVersionTwo, {}),
      )
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) =>
        operation(freshVersionTwo, {}),
      )
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) =>
        operation(freshVersionTwo, {}),
      )
    const operation = vi.fn().mockResolvedValue('mutated')

    await expect(
      withCharacterAuthorizationForLifecycle(characterId, subjectLifecycleId, scope, operation),
    ).resolves.toBe('mutated')

    expect(operation).toHaveBeenCalledOnce()
    expect(operation).toHaveBeenCalledWith({
      accessToken: 'replacement-access',
      tokenVersion: 2,
    })
    expect(mocks.withCharacterTokenLifecycleLock).toHaveBeenCalledTimes(4)
  })

  test('does not execute a mutation after its captured lifecycle disappears', async () => {
    const lifecycleExpired = new mocks.CharacterTokenNotFoundError()
    const fresh = { ...expired, accessTokenExpiresAt: new Date(Date.now() + 120_000) }
    mocks.withCharacterTokenLifecycleLock
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) =>
        operation(fresh, {}),
      )
      .mockRejectedValueOnce(lifecycleExpired)
    const operation = vi.fn()

    await expect(
      withCharacterAuthorizationForLifecycle(characterId, subjectLifecycleId, scope, operation),
    ).rejects.toBe(lifecycleExpired)
    expect(operation).not.toHaveBeenCalled()
  })

  test('keeps refresh winner lookup bound to the requested lifecycle', async () => {
    const transaction = {}
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, transaction),
    )
    mocks.updateCharacterToken.mockResolvedValue(false)
    mocks.findCharacterTokenForLifecycle.mockResolvedValue(null)

    await expect(
      getCharacterAuthorizationForLifecycle(characterId, subjectLifecycleId, scope),
    ).rejects.toBeInstanceOf(mocks.CharacterTokenNotFoundError)
    expect(mocks.findCharacterTokenForLifecycle).toHaveBeenCalledWith(
      characterId,
      subjectLifecycleId,
      transaction,
    )
  })

  test('returns a fresh stored access token without refreshing', async () => {
    const fresh = {
      ...expired,
      accessTokenExpiresAt: new Date(Date.now() + 120_000),
    }
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(fresh, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('original-access')
    expect(mocks.withCharacterTokenLifecycleLock).toHaveBeenCalledOnce()
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled()
  })

  test('rejects missing tokens and required scopes with named errors', async () => {
    mocks.withCharacterTokenLifecycleLock.mockRejectedValueOnce(
      new mocks.CharacterTokenNotFoundError(),
    )
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      mocks.CharacterTokenNotFoundError,
    )

    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) =>
        operation({ ...expired, scopes: [] }, {}),
    )
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      ScopeRequiredError,
    )
  })

  test('refreshes and verifies while holding the database lock', async () => {
    mocks.updateCharacterToken.mockResolvedValue(true)
    mocks.withCharacterTokenLifecycleLock
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) =>
        operation(expired, {}),
      )
      .mockImplementationOnce(async (_characterId, _subjectLifecycleId, operation) => {
        const result = await operation(expired, {})
        expect(mocks.refreshAccessToken).toHaveBeenCalledOnce()
        expect(mocks.verifyAccessToken).toHaveBeenCalledOnce()
        return result
      })

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('new-access')
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('persists a rotated refresh token before reporting job cancellation', async () => {
    const controller = new AbortController()
    let resolveRefresh:
      | ((value: {
          access_token: string
          refresh_token: string
          expires_in: number
          token_type: string
        }) => void)
      | undefined
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )
    mocks.updateCharacterToken.mockResolvedValue(true)
    mocks.refreshAccessToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )

    const pending = getCharacterAuthorization(characterId, scope, controller.signal)
    await vi.waitFor(() => expect(mocks.refreshAccessToken).toHaveBeenCalledOnce())
    controller.abort()
    resolveRefresh?.({
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
      expires_in: 1200,
      token_type: 'Bearer',
    })

    await expect(pending).rejects.toBe(controller.signal.reason)
    expect(controller.signal.reason).toMatchObject({ name: 'AbortError' })
    expect(mocks.refreshAccessToken).toHaveBeenCalledWith('original-refresh')
    expect(mocks.verifyAccessToken).toHaveBeenCalledWith('new-access')
    expect(mocks.encryptTokens).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'rotated-refresh',
    })
    expect(mocks.updateCharacterToken).toHaveBeenCalledOnce()
    expect(mocks.deleteCharacterTokenAuthorization).not.toHaveBeenCalled()
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('releases refresh capacity when cancellation follows slot acquisition', async () => {
    const controller = new AbortController()
    const cancelled = getCharacterAuthorization(characterId, scope, controller.signal)
    queueMicrotask(() => controller.abort())

    const cancellation = await cancelled.catch((error: unknown) => error)
    expect(cancellation).toBe(controller.signal.reason)
    expect(mocks.withCharacterTokenLifecycleLock).toHaveBeenCalledOnce()

    let releaseRefreshes: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefreshes = resolve
    })
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (lockedCharacterId, _subjectLifecycleId, operation) =>
        operation({ ...expired, encryptedTokens: String(lockedCharacterId) }, {}),
    )
    mocks.refreshAccessToken.mockImplementation(async (refreshToken: string) => {
      await refreshGate
      return {
        access_token: `new-access-${refreshToken.replace('-refresh', '')}`,
        refresh_token: 'new-refresh',
        expires_in: 1200,
        token_type: 'Bearer',
      }
    })
    mocks.verifyAccessToken.mockImplementation((accessToken: string) => ({
      characterId: Number(accessToken.replace('new-access-', '')),
      characterName: 'Test',
      scopes: [scope],
    }))
    mocks.updateCharacterToken.mockResolvedValue(true)

    const refreshes = Array.from({ length: 4 }, (_, index) =>
      getCharacterAccessToken(characterId + index + 1, scope),
    )
    try {
      await vi.waitFor(() => expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(4))
    } finally {
      releaseRefreshes?.()
    }
    await expect(Promise.all(refreshes)).resolves.toHaveLength(4)
  })

  test('rechecks each caller scope after sharing an in-flight refresh', async () => {
    const secondaryScope = 'esi-skills.read_skills.v1'
    let resolveRefresh: (() => void) | undefined
    let stored = { ...expired, scopes: [scope, secondaryScope] }
    let lockTail = Promise.resolve()
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => {
        const previous = lockTail
        let releaseLock: (() => void) | undefined
        lockTail = new Promise<void>((resolve) => {
          releaseLock = resolve
        })
        await previous
        try {
          const result = await operation(stored, {})
          if (result && typeof result === 'object' && 'authorization' in result) {
            stored = {
              ...stored,
              encryptedTokens: 'refreshed',
              accessTokenExpiresAt: new Date(Date.now() + 120_000),
              scopes: result.scopes,
              tokenVersion: result.authorization.tokenVersion,
            }
          }
          return result
        } finally {
          releaseLock?.()
        }
      },
    )
    mocks.refreshAccessToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () =>
            resolve({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_in: 1200,
              token_type: 'Bearer',
            })
        }),
    )

    const first = getCharacterAuthorization(characterId, scope)
    await vi.waitFor(() => expect(mocks.refreshAccessToken).toHaveBeenCalledOnce())
    const second = getCharacterAuthorization(characterId, secondaryScope)
    resolveRefresh?.()

    await expect(first).resolves.toEqual({ accessToken: 'new-access', tokenVersion: 2 })
    await expect(second).rejects.toBeInstanceOf(ScopeRequiredError)
    expect(mocks.refreshAccessToken).toHaveBeenCalledOnce()
  })

  test('records normalized material scope changes only for the winning update', async () => {
    mocks.updateCharacterToken.mockResolvedValue(true)
    mocks.verifyAccessToken.mockResolvedValue({
      characterId,
      characterName: 'Test',
      scopes: ['z.scope', scope, 'a.scope', 'z.scope'],
    })
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) =>
        operation({ ...expired, scopes: ['removed.scope', scope] }, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('new-access')
    expect(mocks.updateCharacterToken).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['a.scope', scope, 'z.scope'] }),
      expect.anything(),
    )
    expect(mocks.appendDomainEvent).toHaveBeenCalledWith(expect.anything(), {
      type: 'character.scopes-changed',
      payloadVersion: 1,
      aggregateId: String(characterId),
      payload: {
        userId,
        characterId,
        addedScopes: ['a.scope', 'z.scope'],
        removedScopes: ['removed.scope'],
      },
    })
  })

  test('returns the persisted winner when the compare-and-set loses', async () => {
    const winner = { ...expired, encryptedTokens: 'winner', tokenVersion: 2 }
    mocks.updateCharacterToken.mockResolvedValue(false)
    mocks.findCharacterTokenForLifecycle.mockResolvedValue(winner)
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('winner-access')
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('fails with a named error when a compare-and-set winner disappears', async () => {
    mocks.updateCharacterToken.mockResolvedValue(false)
    mocks.findCharacterTokenForLifecycle.mockResolvedValue(null)
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      mocks.CharacterTokenNotFoundError,
    )
  })

  test('returns the persisted winner without an SSO refresh when another replica won', async () => {
    const winner = {
      ...expired,
      encryptedTokens: 'winner',
      accessTokenExpiresAt: new Date(Date.now() + 120_000),
      tokenVersion: 2,
    }
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(winner, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('winner-access')
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled()
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('maps lock contention to a controlled unavailable error', async () => {
    mocks.withCharacterTokenLifecycleLock.mockRejectedValue(
      new mocks.TokenRefreshLockUnavailableError(),
    )

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      TokenRefreshUnavailableError,
    )
  })

  test('preserves unexpected coordination failures', async () => {
    const error = new Error('unexpected')
    mocks.withCharacterTokenLifecycleLock.mockRejectedValue(error)

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBe(error)
  })

  test('rejects mismatched refreshed identities and scopes', async () => {
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )
    mocks.verifyAccessToken.mockResolvedValueOnce({
      characterId: characterId + 1,
      characterName: 'Other',
      scopes: [scope],
    })
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toThrow(
      'Refreshed token belongs to a different character',
    )

    mocks.verifyAccessToken.mockResolvedValueOnce({
      characterId,
      characterName: 'Test',
      scopes: [],
    })
    mocks.updateCharacterToken.mockResolvedValueOnce(true)
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      ScopeRequiredError,
    )
    expect(mocks.appendDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'character.scopes-changed',
        payload: expect.objectContaining({ removedScopes: [scope] }),
      }),
    )
    expect(mocks.recomputeOrganizationAccountCompliance).toHaveBeenCalledWith(
      { deploymentId: 1, organizationVersion: 4, userId },
      expect.anything(),
    )
  })

  test('commits definitive authorization revocation before returning the SSO refusal', async () => {
    const revoked = new mocks.EveSsoTokenRefreshError(400, true)
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )
    mocks.refreshAccessToken.mockRejectedValue(revoked)

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBe(revoked)
    expect(mocks.deleteCharacterTokenAuthorization).toHaveBeenCalledWith(
      characterId,
      expired.tokenVersion,
      expect.anything(),
    )
    expect(mocks.appendDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'character.scopes-changed',
        payload: expect.objectContaining({ removedScopes: [scope] }),
      }),
    )
    expect(mocks.recomputeOrganizationAccountCompliance).toHaveBeenCalledOnce()
  })

  test.each([
    ['refresh transport', 'refreshAccessToken'],
    ['verification transport', 'verifyAccessToken'],
  ] as const)(
    'maps a transient %s failure without mutating token state',
    async (_stage, method) => {
      mocks.withCharacterTokenLifecycleLock.mockImplementation(
        async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
      )
      mocks[method].mockRejectedValue(new SsoTransportError(new Error('temporary SSO failure')))

      await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
        TokenRefreshUnavailableError,
      )
      expect(mocks.updateCharacterToken).not.toHaveBeenCalled()
      expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
    },
  )

  test('commits typed token rejection before returning the SSO refusal', async () => {
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )
    const rejection = new SsoTokenRejectedError(400)
    mocks.refreshAccessToken.mockRejectedValueOnce(rejection)

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBe(rejection)
    expect(mocks.deleteCharacterTokenAuthorization).toHaveBeenCalledWith(
      characterId,
      expired.tokenVersion,
      expect.anything(),
    )
    expect(mocks.appendDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'character.scopes-changed',
        payload: expect.objectContaining({ removedScopes: [scope] }),
      }),
    )
    expect(mocks.recomputeOrganizationAccountCompliance).toHaveBeenCalledOnce()
  })

  test('preserves unexpected SSO failures without mutating token state', async () => {
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )

    const unexpected = new Error('unexpected SSO failure')
    mocks.refreshAccessToken.mockRejectedValueOnce(unexpected)

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBe(unexpected)
    expect(mocks.updateCharacterToken).not.toHaveBeenCalled()
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('retains the current refresh token when EVE does not rotate it', async () => {
    mocks.updateCharacterToken.mockResolvedValue(true)
    mocks.refreshAccessToken.mockResolvedValue({
      access_token: 'new-access',
      expires_in: 1200,
      token_type: 'Bearer',
    })
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (_characterId, _subjectLifecycleId, operation) => operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('new-access')
    expect(mocks.encryptTokens).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'original-refresh',
    })
  })

  test('reserves database connections by limiting concurrent character refreshes', async () => {
    const resolvers: Array<() => void> = []
    mocks.withCharacterTokenLifecycleLock.mockImplementation(
      async (lockedCharacterId, _subjectLifecycleId, operation) =>
        operation({ ...expired, encryptedTokens: String(lockedCharacterId) }, {}),
    )
    mocks.refreshAccessToken.mockImplementation(
      (refreshToken: string) =>
        new Promise((resolve) => {
          const accessToken = `new-access-${refreshToken.replace('-refresh', '')}`
          resolvers.push(() =>
            resolve({
              access_token: accessToken,
              refresh_token: 'new-refresh',
              expires_in: 1200,
              token_type: 'Bearer',
            }),
          )
        }),
    )
    mocks.verifyAccessToken.mockImplementation((accessToken: string) => ({
      characterId: Number(accessToken.replace('new-access-', '')),
      characterName: 'Test',
      scopes: [scope],
    }))
    mocks.updateCharacterToken.mockResolvedValue(true)

    const refreshes = Array.from({ length: 5 }, (_, index) =>
      getCharacterAccessToken(characterId + index + 1, scope),
    )

    await vi.waitFor(() => expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(4))
    resolvers.splice(0).forEach((resolve) => resolve())
    await vi.waitFor(() => expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(5))
    resolvers.splice(0).forEach((resolve) => resolve())

    await expect(Promise.all(refreshes)).resolves.toHaveLength(5)
  })

  test('rejects rather than hangs when no refresh slot frees up in time', async () => {
    vi.useFakeTimers()
    try {
      const resolvers: Array<() => void> = []
      mocks.withCharacterTokenLifecycleLock.mockImplementation(
        async (lockedCharacterId, _subjectLifecycleId, operation) =>
          operation({ ...expired, encryptedTokens: String(lockedCharacterId) }, {}),
      )
      mocks.refreshAccessToken.mockImplementation(
        (refreshToken: string) =>
          new Promise((resolve) => {
            const accessToken = `new-access-${refreshToken.replace('-refresh', '')}`
            resolvers.push(() =>
              resolve({
                access_token: accessToken,
                refresh_token: 'new-refresh',
                expires_in: 1200,
                token_type: 'Bearer',
              }),
            )
          }),
      )
      mocks.verifyAccessToken.mockImplementation((accessToken: string) => ({
        characterId: Number(accessToken.replace('new-access-', '')),
        characterName: 'Test',
        scopes: [scope],
      }))
      mocks.updateCharacterToken.mockResolvedValue(true)

      const holders = Array.from({ length: 4 }, (_, index) =>
        getCharacterAccessToken(characterId + index + 1, scope),
      )
      await vi.advanceTimersByTimeAsync(0)
      // Attach the handler before advancing: the timer rejects during `advanceTimersByTimeAsync`,
      // and an assertion added afterwards would arrive one turn too late to catch it.
      const queued = getCharacterAccessToken(characterId + 99, scope).catch(
        (error: unknown) => error,
      )
      await vi.advanceTimersByTimeAsync(30_000)

      await expect(queued).resolves.toBeInstanceOf(TokenRefreshUnavailableError)

      resolvers.splice(0).forEach((resolve) => resolve())
      await expect(Promise.all(holders)).resolves.toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
