import {
  CharacterTokenNotFoundError,
  findCharacterToken,
  TokenRefreshLockUnavailableError,
  updateCharacterToken,
  withCharacterTokenRefreshLock,
} from './auth-store.js'
import type { StoredCharacterToken } from './auth-store.js'
import { appendDomainEvent } from './domain-event-store.js'
import { normalizeScopeSet } from './domain-events.js'
import { env } from './env.js'
import { refreshAccessToken, verifyAccessToken } from './eve-sso.js'
import { decryptTokens, encryptTokens } from './security.js'

const refreshes = new Map<number, Promise<string>>()

/** Treat a token as spent this far ahead of its expiry so a request cannot race the clock. */
const tokenFreshnessSkewMs = 60_000

let activeRefreshes = 0
const refreshWaiters: Array<() => void> = []

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
  return (await getCharacterAuthorization(characterId, requiredScope)).accessToken
}

export async function getCharacterAuthorization(characterId: number, requiredScope: string) {
  const stored = await findCharacterToken(characterId)
  if (!stored) throw new CharacterTokenNotFoundError()
  requireScope(stored.scopes, requiredScope)

  const tokens = decryptTokens(stored.encryptedTokens)
  if (stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs)
    return { accessToken: tokens.accessToken, tokenVersion: stored.tokenVersion }

  let refresh = refreshes.get(characterId)
  if (!refresh) {
    refresh = withRefreshCapacity(() =>
      refreshCharacterToken(characterId, requiredScope, stored),
    ).finally(() => refreshes.delete(characterId))
    refreshes.set(characterId, refresh)
  }
  const accessToken = await refresh
  const refreshed = await findCharacterToken(characterId)
  if (!refreshed) throw new CharacterTokenNotFoundError()
  requireScope(refreshed.scopes, requiredScope)
  return { accessToken, tokenVersion: refreshed.tokenVersion }
}

/**
 * Each in-flight refresh holds one pooled connection for the duration of its SSO calls, so the
 * number of them is capped well below the pool rather than left to the arrival rate.
 */
async function withRefreshCapacity<T>(operation: () => Promise<T>) {
  await acquireRefreshSlot()
  try {
    return await operation()
  } finally {
    activeRefreshes -= 1
    refreshWaiters.shift()?.()
  }
}

async function acquireRefreshSlot() {
  // A woken waiter re-checks rather than assuming the slot is still free: releasing resolves the
  // waiter a microtask before it resumes, and a caller arriving in that gap takes the slot without
  // ever queueing.
  const deadline = Date.now() + env.TOKEN_REFRESH_QUEUE_TIMEOUT_MS
  while (activeRefreshes >= env.TOKEN_REFRESH_CONCURRENCY) {
    // Waiting is the point: each turn parks until a slot is released, so these cannot be collected
    // and awaited in parallel.
    // oxlint-disable-next-line no-await-in-loop
    await waitForRefreshSlot(deadline)
  }
  activeRefreshes += 1
}

function waitForRefreshSlot(deadline: number) {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waiter = () => {
      clearTimeout(timer)
      resolve()
    }
    // The deadline spans the whole wait, not one turn, so repeated wake-ups cannot extend it.
    timer = setTimeout(
      () => {
        const queued = refreshWaiters.indexOf(waiter)
        if (queued !== -1) refreshWaiters.splice(queued, 1)
        reject(new TokenRefreshUnavailableError())
      },
      Math.max(0, deadline - Date.now()),
    )
    refreshWaiters.push(waiter)
  })
}

async function refreshCharacterToken(
  characterId: number,
  requiredScope: string,
  original: StoredCharacterToken,
) {
  return withRefreshLock(characterId, async (stored, transaction) => {
    if (stored.tokenVersion !== original.tokenVersion)
      return readStoredAccessToken(stored, requiredScope)

    const currentTokens = decryptTokens(stored.encryptedTokens)
    const refreshed = await refreshAccessToken(currentTokens.refreshToken)
    const identity = await verifyAccessToken(refreshed.access_token)
    if (identity.characterId !== characterId)
      throw new Error('Refreshed token belongs to a different character')
    requireScope(identity.scopes, requiredScope)
    const previousScopes = new Set(normalizeScopeSet(stored.scopes))
    const nextScopes = normalizeScopeSet(identity.scopes)

    // The advisory lock currently serializes writers. Keep the compare-and-set as a final guard
    // against a future uncoordinated caller overwriting a rotated refresh token.
    const updated = await updateCharacterToken(
      {
        characterId,
        encryptedTokens: encryptTokens({
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? currentTokens.refreshToken,
        }),
        expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        scopes: nextScopes,
        tokenVersion: stored.tokenVersion,
      },
      transaction,
    )
    if (updated) {
      const nextScopeSet = new Set(nextScopes)
      const addedScopes = nextScopes.filter((scope) => !previousScopes.has(scope))
      const removedScopes = [...previousScopes].filter((scope) => !nextScopeSet.has(scope))
      if (addedScopes.length > 0 || removedScopes.length > 0) {
        await appendDomainEvent(transaction, {
          type: 'character.scopes-changed',
          payloadVersion: 1,
          aggregateId: String(characterId),
          payload: { userId: stored.userId, characterId, addedScopes, removedScopes },
        })
      }
      return refreshed.access_token
    }

    const winner = await findCharacterToken(characterId, transaction)
    if (!winner) throw new CharacterTokenNotFoundError()
    return readStoredAccessToken(winner, requiredScope)
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
  requireScope(stored.scopes, requiredScope)
  return decryptTokens(stored.encryptedTokens).accessToken
}

function requireScope(scopes: string[], requiredScope: string) {
  if (!scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)
}
