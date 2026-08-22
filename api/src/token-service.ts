import {
  CharacterTokenNotFoundError,
  findCharacterToken,
  TokenRefreshLockUnavailableError,
  updateCharacterToken,
  withCharacterTokenRefreshLock,
} from './auth-store.js'
import type { StoredCharacterToken } from './auth-store.js'
import { refreshAccessToken, verifyAccessToken } from './eve-sso.js'
import { decryptTokens, encryptTokens } from './security.js'

const refreshes = new Map<number, Promise<string>>()

export class ScopeRequiredError extends Error {
  constructor(readonly scope: string) {
    super(`EVE authorization is missing the ${scope} scope`)
  }
}

export class TokenRefreshUnavailableError extends Error {
  constructor() {
    super('EVE token refresh is temporarily unavailable')
  }
}

export async function getCharacterAccessToken(characterId: number, requiredScope: string) {
  const stored = await findCharacterToken(characterId)
  if (!stored) throw new CharacterTokenNotFoundError()
  if (!stored.scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)

  const tokens = decryptTokens(stored.encryptedTokens)
  if (stored.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return tokens.accessToken

  const existingRefresh = refreshes.get(characterId)
  if (existingRefresh) return existingRefresh

  const refresh = refreshCharacterToken(characterId, requiredScope, stored).finally(() =>
    refreshes.delete(characterId),
  )
  refreshes.set(characterId, refresh)
  return refresh
}

async function refreshCharacterToken(
  characterId: number,
  requiredScope: string,
  original: StoredCharacterToken,
) {
  const currentTokens = decryptTokens(original.encryptedTokens)
  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>
  let identity: Awaited<ReturnType<typeof verifyAccessToken>>

  try {
    refreshed = await refreshAccessToken(currentTokens.refreshToken)
    identity = await verifyAccessToken(refreshed.access_token)
  } catch (error) {
    return resolveConcurrentRefresh(characterId, requiredScope, original, error)
  }

  if (identity.characterId !== characterId)
    throw new Error('Refreshed token belongs to a different character')
  if (!identity.scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)

  return withRefreshLock(characterId, async (stored, transaction) => {
    if (stored.tokenVersion !== original.tokenVersion)
      return readStoredAccessToken(stored, requiredScope)

    const updated = await updateCharacterToken(
      {
        characterId,
        encryptedTokens: encryptTokens({
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? currentTokens.refreshToken,
        }),
        expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        scopes: identity.scopes,
        tokenVersion: original.tokenVersion,
      },
      transaction,
    )
    if (updated) return refreshed.access_token

    const winner = await findCharacterToken(characterId, transaction)
    if (!winner) throw new CharacterTokenNotFoundError()
    return readStoredAccessToken(winner, requiredScope)
  })
}

async function resolveConcurrentRefresh(
  characterId: number,
  requiredScope: string,
  original: StoredCharacterToken,
  refreshError: unknown,
) {
  return withRefreshLock(characterId, async (stored) => {
    if (stored.tokenVersion !== original.tokenVersion)
      return readStoredAccessToken(stored, requiredScope)
    throw refreshError
  })
}

async function withRefreshLock<T>(
  characterId: number,
  operation: Parameters<typeof withCharacterTokenRefreshLock<T>>[1],
) {
  try {
    return await withCharacterTokenRefreshLock(characterId, operation)
  } catch (error) {
    if (error instanceof TokenRefreshLockUnavailableError) throw new TokenRefreshUnavailableError()
    throw error
  }
}

function readStoredAccessToken(stored: StoredCharacterToken, requiredScope: string) {
  if (!stored.scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)
  return decryptTokens(stored.encryptedTokens).accessToken
}
