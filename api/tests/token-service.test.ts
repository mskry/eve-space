import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CharacterTokenNotFoundError extends Error {}
  class TokenRefreshLockUnavailableError extends Error {}
  return {
    CharacterTokenNotFoundError,
    TokenRefreshLockUnavailableError,
    decryptTokens: vi.fn(),
    encryptTokens: vi.fn(),
    findCharacterToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    updateCharacterToken: vi.fn(),
    verifyAccessToken: vi.fn(),
    withCharacterTokenRefreshLock: vi.fn(),
  }
})

vi.mock('../src/auth-store.js', () => ({
  CharacterTokenNotFoundError: mocks.CharacterTokenNotFoundError,
  TokenRefreshLockUnavailableError: mocks.TokenRefreshLockUnavailableError,
  findCharacterToken: mocks.findCharacterToken,
  updateCharacterToken: mocks.updateCharacterToken,
  withCharacterTokenRefreshLock: mocks.withCharacterTokenRefreshLock,
}))

vi.mock('../src/eve-sso.js', () => ({
  refreshAccessToken: mocks.refreshAccessToken,
  verifyAccessToken: mocks.verifyAccessToken,
}))

vi.mock('../src/security.js', () => ({
  decryptTokens: mocks.decryptTokens,
  encryptTokens: mocks.encryptTokens,
}))

import { getCharacterAccessToken, TokenRefreshUnavailableError } from '../src/token-service.js'

const characterId = 1404328063
const scope = 'esi-wallet.read_character_wallet.v1'
const expired = {
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
  mocks.refreshAccessToken.mockResolvedValue({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 1200,
    token_type: 'Bearer',
  })
  mocks.verifyAccessToken.mockResolvedValue({ characterId, characterName: 'Test', scopes: [scope] })
})

describe('token refresh', () => {
  test('refreshes and verifies before acquiring the database lock', async () => {
    mocks.updateCharacterToken.mockResolvedValue(true)
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) => {
      expect(mocks.refreshAccessToken).toHaveBeenCalledOnce()
      expect(mocks.verifyAccessToken).toHaveBeenCalledOnce()
      return operation(expired, {})
    })

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('new-access')
  })

  test('returns the persisted winner when the compare-and-set loses', async () => {
    const winner = { ...expired, encryptedTokens: 'winner', tokenVersion: 2 }
    mocks.updateCharacterToken.mockResolvedValue(false)
    mocks.findCharacterToken.mockResolvedValueOnce(expired).mockResolvedValueOnce(winner)
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(expired, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('winner-access')
  })

  test('returns the persisted winner when a concurrent SSO refresh invalidates this token', async () => {
    const winner = { ...expired, encryptedTokens: 'winner', tokenVersion: 2 }
    mocks.refreshAccessToken.mockRejectedValue(new Error('EVE token refresh returned HTTP 400'))
    mocks.withCharacterTokenRefreshLock.mockImplementation(async (_characterId, operation) =>
      operation(winner, {}),
    )

    await expect(getCharacterAccessToken(characterId, scope)).resolves.toBe('winner-access')
  })

  test('maps lock contention to a controlled unavailable error', async () => {
    mocks.withCharacterTokenRefreshLock.mockRejectedValue(
      new mocks.TokenRefreshLockUnavailableError(),
    )

    await expect(getCharacterAccessToken(characterId, scope)).rejects.toBeInstanceOf(
      TokenRefreshUnavailableError,
    )
  })
})
