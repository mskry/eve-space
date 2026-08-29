import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CharacterTokenNotFoundError extends Error {}
  class TokenRefreshLockUnavailableError extends Error {}
  return {
    CharacterTokenNotFoundError,
    TokenRefreshLockUnavailableError,
    appendDomainEvent: vi.fn(),
    decryptTokens: vi.fn(),
    encryptTokens: vi.fn(),
    findCharacterToken: vi.fn(),
    findCharacterTokenForLifecycle: vi.fn(),
    refreshAccessToken: vi.fn(),
    updateCharacterToken: vi.fn(),
    verifyAccessToken: vi.fn(),
    withCharacterTokenRefreshLock: vi.fn(),
    withCharacterTokenLifecycleLock: vi.fn(),
  }
})

vi.mock('../../src/auth/store.js', () => ({
  CharacterTokenNotFoundError: mocks.CharacterTokenNotFoundError,
  TokenRefreshLockUnavailableError: mocks.TokenRefreshLockUnavailableError,
  findCharacterToken: mocks.findCharacterToken,
  findCharacterTokenForLifecycle: mocks.findCharacterTokenForLifecycle,
  updateCharacterToken: mocks.updateCharacterToken,
  withCharacterTokenRefreshLock: mocks.withCharacterTokenRefreshLock,
  withCharacterTokenLifecycleLock: mocks.withCharacterTokenLifecycleLock,
}))

vi.mock('../../src/domain-events/store.js', () => ({
  appendDomainEvent: mocks.appendDomainEvent,
}))

vi.mock('../../src/auth/sso.js', () => ({
  refreshAccessToken: mocks.refreshAccessToken,
  verifyAccessToken: mocks.verifyAccessToken,
}))

vi.mock('../../src/auth/security.js', () => ({
  decryptTokens: mocks.decryptTokens,
  encryptTokens: mocks.encryptTokens,
}))

import {
  getCharacterAccessToken,
  getCharacterAuthorization,
  getCharacterAuthorizationForLifecycle,
  ScopeRequiredError,
  TokenRefreshUnavailableError,
} from '../../src/auth/tokens.js'

const characterId = 1404328063
const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const scope = 'esi-wallet.read_character_wallet.v1'
const expired = {
  userId,
  encryptedTokens: 'original',
  accessTokenExpiresAt: new Date(0),
  scopes: [scope],
  tokenVersion: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.decryptTokens.mockImplementation((encryptedTokens: string) => ({
    accessToken: `${encryptedTokens}-access`,
    refreshToken: `${encryptedTokens}-refresh`,
  }))
  mocks.encryptTokens.mockReturnValue('refreshed')
  mocks.findCharacterToken.mockResolvedValue(expired)
  mocks.findCharacterTokenForLifecycle.mockResolvedValue(expired)
  mocks.refreshAccessToken.mockResolvedValue({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 1200,
    token_type: 'Bearer',
  })
  mocks.verifyAccessToken.mockResolvedValue({ characterId, characterName: 'Test', scopes: [scope] })
})

describe('token refresh', () => {
  test('binds fresh authorization to the requested ownership lifecycle', async () => {
    const subjectLifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
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
    expect(mocks.findCharacterToken).not.toHaveBeenCalled()
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

  test('keeps refresh winner lookup bound to the requested lifecycle', async () => {
    const subjectLifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
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
    expect(mocks.findCharacterToken).not.toHaveBeenCalled()
  })

  test('returns a fresh stored access token without refreshing', async () => {
    mocks.findCharacterToken.mockResolvedValue({
      ...expired,
      accessTokenExpiresAt: new Date(Date.now() + 120_000),
    })

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('original-access')
    expect(mocks.withCharacterTokenRefreshLock).not.toHaveBeenCalled()
  })

  test('rejects missing tokens and required scopes with named errors', async () => {
    mocks.findCharacterToken.mockResolvedValueOnce(null)
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      mocks.CharacterTokenNotFoundError,
    )

    mocks.findCharacterToken.mockResolvedValueOnce({ ...expired, scopes: [] })
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      ScopeRequiredError,
    )
  })

  test('refreshes and verifies while holding the database lock', async () => {
    mocks.updateCharacterToken.mockResolvedValue(true)
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) => {
      const result = await operation(expired, {})
      expect(mocks.refreshAccessToken).toHaveBeenCalledOnce()
      expect(mocks.verifyAccessToken).toHaveBeenCalledOnce()
      return result
    })

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('new-access')
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('rechecks each caller scope after sharing an in-flight refresh', async () => {
    const secondaryScope = 'esi-skills.read_skills.v1'
    let resolveRefresh: (() => void) | undefined
    mocks.findCharacterToken.mockResolvedValue({ ...expired, scopes: [scope, secondaryScope] })
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation({ ...expired, scopes: [scope, secondaryScope] }, {}),
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
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
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
    mocks.findCharacterToken.mockResolvedValueOnce(expired).mockResolvedValueOnce(winner)
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('winner-access')
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('fails with a named error when a compare-and-set winner disappears', async () => {
    mocks.updateCharacterToken.mockResolvedValue(false)
    mocks.findCharacterToken.mockResolvedValueOnce(expired).mockResolvedValueOnce(null)
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      mocks.CharacterTokenNotFoundError,
    )
  })

  test('returns the persisted winner without an SSO refresh when another replica won', async () => {
    const winner = { ...expired, encryptedTokens: 'winner', tokenVersion: 2 }
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(winner, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('winner-access')
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled()
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('maps lock contention to a controlled unavailable error', async () => {
    mocks.withCharacterTokenRefreshLock.mockRejectedValue(
      new mocks.TokenRefreshLockUnavailableError(),
    )

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      TokenRefreshUnavailableError,
    )
  })

  test('preserves unexpected coordination failures', async () => {
    const error = new Error('unexpected')
    mocks.withCharacterTokenRefreshLock.mockRejectedValue(error)

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBe(error)
  })

  test('rejects mismatched refreshed identities and scopes', async () => {
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(expired, {}),
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
    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      ScopeRequiredError,
    )
    expect(mocks.appendDomainEvent).not.toHaveBeenCalled()
  })

  test('does not mutate or emit an event for a transient SSO refresh failure', async () => {
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(expired, {}),
    )
    mocks.refreshAccessToken.mockRejectedValue(new Error('temporary SSO failure'))

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toThrow(
      'temporary SSO failure',
    )
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
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('new-access')
    expect(mocks.encryptTokens).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'original-refresh',
    })
  })

  test('reserves database connections by limiting concurrent character refreshes', async () => {
    const resolvers: Array<() => void> = []
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (lockedCharacterId, operation) =>
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
      mocks.withCharacterTokenRefreshLock.mockImplementation(async (lockedCharacterId, operation) =>
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
