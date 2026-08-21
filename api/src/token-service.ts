import { findCharacterToken, updateCharacterToken } from './auth-store.js'
import { refreshAccessToken, verifyAccessToken } from './eve-sso.js'
import { decryptTokens, encryptTokens } from './security.js'

const refreshes = new Map<number, Promise<string>>()

export class ScopeRequiredError extends Error {
  constructor(readonly scope: string) {
    super(`EVE authorization is missing the ${scope} scope`)
  }
}

export async function getCharacterAccessToken(characterId: number, requiredScope: string) {
  const stored = await findCharacterToken(characterId)
  if (!stored) throw new Error('No EVE token is stored for this character')
  if (!stored.scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)

  const tokens = decryptTokens(stored.encryptedTokens)
  if (stored.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return tokens.accessToken

  const existingRefresh = refreshes.get(characterId)
  if (existingRefresh) return existingRefresh

  const refresh = refreshCharacterToken(characterId, requiredScope, tokens.refreshToken).finally(
    () => refreshes.delete(characterId),
  )
  refreshes.set(characterId, refresh)
  return refresh
}

async function refreshCharacterToken(
  characterId: number,
  requiredScope: string,
  currentRefreshToken: string,
) {
  const refreshed = await refreshAccessToken(currentRefreshToken)
  const identity = await verifyAccessToken(refreshed.access_token)

  if (identity.characterId !== characterId)
    throw new Error('Refreshed token belongs to a different character')
  if (!identity.scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)

  await updateCharacterToken({
    characterId,
    encryptedTokens: encryptTokens({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? currentRefreshToken,
    }),
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    scopes: identity.scopes,
  })

  return refreshed.access_token
}
