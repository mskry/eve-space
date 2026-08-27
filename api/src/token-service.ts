import {
  CharacterTokenNotFoundError,
  findCharacterToken,
  findCharacterTokenForLifecycle,
  TokenRefreshLockUnavailableError,
  updateCharacterToken,
  withCharacterTokenLifecycleLock,
  withCharacterTokenRefreshLock,
} from './auth-store.js'
import type { StoredCharacterToken } from './auth-store.js'
import { appendDomainEvent } from './domain-event-store.js'
import { normalizeScopeSet } from './domain-events.js'
import { env } from './env.js'
import { refreshAccessToken, verifyAccessToken } from './eve-sso.js'
import { decryptTokens, encryptTokens } from './security.js'

interface CharacterAuthorization {
  readonly accessToken: string
  readonly tokenVersion: number
}

interface RefreshedCharacterAuthorization {
  readonly authorization: CharacterAuthorization
  readonly scopes: readonly string[]
}

const refreshes = new Map<number, Promise<RefreshedCharacterAuthorization>>()

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

  if (stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs)
    return readStoredAuthorization(stored, requiredScope)

  let refresh = refreshes.get(characterId)
  if (!refresh) {
    refresh = withRefreshCapacity(() =>
      refreshCharacterToken(characterId, requiredScope, stored),
    ).finally(() => refreshes.delete(characterId))
    refreshes.set(characterId, refresh)
  }
  const refreshed = await refresh
  requireScope(refreshed.scopes, requiredScope)
  return refreshed.authorization
}

export async function getCharacterAuthorizationForLifecycle(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
) {
  const fresh = await withLifecycleRefreshLock(characterId, subjectLifecycleId, async (stored) => {
    requireScope(stored.scopes, requiredScope)
    return stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs
      ? readStoredAuthorization(stored, requiredScope)
      : null
  })
  if (fresh) return fresh

  return withRefreshCapacity(async () => {
    const refreshed = await withLifecycleRefreshLock(
      characterId,
      subjectLifecycleId,
      async (stored, transaction) => {
        requireScope(stored.scopes, requiredScope)
        if (stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs)
          return toRefreshedCharacterAuthorization(stored, requiredScope)
        return refreshLockedCharacterToken(
          characterId,
          requiredScope,
          stored,
          stored,
          transaction,
          () => findCharacterTokenForLifecycle(characterId, subjectLifecycleId, transaction),
        )
      },
    )
    return refreshed.authorization
  })
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
  return withRefreshLock(characterId, (stored, transaction) =>
    refreshLockedCharacterToken(characterId, requiredScope, original, stored, transaction, () =>
      findCharacterToken(characterId, transaction),
    ),
  )
}

async function refreshLockedCharacterToken(
  characterId: number,
  requiredScope: string,
  original: StoredCharacterToken,
  stored: StoredCharacterToken,
  transaction: Parameters<Parameters<typeof withCharacterTokenRefreshLock>[1]>[1],
  findWinner: () => Promise<StoredCharacterToken | null>,
): Promise<RefreshedCharacterAuthorization> {
  if (stored.tokenVersion !== original.tokenVersion)
    return toRefreshedCharacterAuthorization(stored, requiredScope)

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
    return {
      authorization: { accessToken: refreshed.access_token, tokenVersion: stored.tokenVersion + 1 },
      scopes: nextScopes,
    }
  }

  const winner = await findWinner()
  if (!winner) throw new CharacterTokenNotFoundError()
  return toRefreshedCharacterAuthorization(winner, requiredScope)
}

async function mapRefreshLockError<T>(locked: Promise<T>) {
  try {
    return await locked
  } catch (error) {
    if (error instanceof TokenRefreshLockUnavailableError) throw new TokenRefreshUnavailableError()
    throw error
  }
}

async function withRefreshLock<T>(
  characterId: number,
  operation: Parameters<typeof withCharacterTokenRefreshLock<T>>[1],
) {
  return mapRefreshLockError(withCharacterTokenRefreshLock(characterId, operation))
}

async function withLifecycleRefreshLock<T>(
  characterId: number,
  subjectLifecycleId: string,
  operation: Parameters<typeof withCharacterTokenLifecycleLock<T>>[2],
) {
  return mapRefreshLockError(
    withCharacterTokenLifecycleLock(characterId, subjectLifecycleId, operation),
  )
}

function readStoredAuthorization(
  stored: StoredCharacterToken,
  requiredScope: string,
): CharacterAuthorization {
  requireScope(stored.scopes, requiredScope)
  return {
    accessToken: decryptTokens(stored.encryptedTokens).accessToken,
    tokenVersion: stored.tokenVersion,
  }
}

function toRefreshedCharacterAuthorization(
  stored: StoredCharacterToken,
  requiredScope: string,
): RefreshedCharacterAuthorization {
  return { authorization: readStoredAuthorization(stored, requiredScope), scopes: stored.scopes }
}

function requireScope(scopes: readonly string[], requiredScope: string) {
  if (!scopes.includes(requiredScope)) throw new ScopeRequiredError(requiredScope)
}
