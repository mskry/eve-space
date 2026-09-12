import {
  CharacterTokenNotFoundError,
  deleteCharacterTokenAuthorization,
  findCharacterCacheAuthorizationForLifecycle,
  findCharacterTokenForLifecycle,
  TokenRefreshLockUnavailableError,
  updateCharacterToken,
  withCharacterTokenLifecycleLock,
} from './character-token-store.js'
import type { StoredCharacterToken } from './character-token-store.js'
import { appendDomainEvent } from '../domain-events/store.js'
import {
  lockCurrentOrganizationVersionForCompliance,
  recomputeOrganizationAccountCompliance,
} from '../organization/compliance.js'
import { normalizeScopeSet } from '../scopes.js'
import { env } from '../env.js'
import { EveSsoTokenRefreshError, refreshAccessToken, verifyAccessToken } from './sso.js'
import { isTransientSsoError, SsoTokenRejectedError } from './sso-errors.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from './token-errors.js'
import { decryptTokens, encryptTokens } from './security.js'

export interface CharacterAuthorization {
  readonly accessToken: string
  readonly tokenVersion: number
}

export interface CharacterCacheAuthorization {
  readonly scopes: readonly string[]
  readonly tokenVersion: number
}

interface RefreshedCharacterAuthorization {
  readonly authorization: CharacterAuthorization
  readonly scopes: readonly string[]
}

interface RevokedCharacterAuthorization {
  readonly authorizationRevoked: EveSsoTokenRefreshError | SsoTokenRejectedError
}

type CharacterRefreshResult = RefreshedCharacterAuthorization | RevokedCharacterAuthorization

/** Treat a token as spent this far ahead of its expiry so a request cannot race the clock. */
const tokenFreshnessSkewMs = 60_000

let activeRefreshes = 0
const refreshWaiters: Array<() => void> = []

export async function getCharacterAccessToken(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
) {
  return (
    await getCharacterAuthorizationForLifecycle(characterId, subjectLifecycleId, requiredScope)
  ).accessToken
}

export async function getCharacterCacheAuthorization(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
  signal?: AbortSignal,
): Promise<CharacterCacheAuthorization> {
  return getCharacterCacheAuthorizationForLifecycle(
    characterId,
    subjectLifecycleId,
    requiredScope,
    signal,
  )
}

export async function getCharacterCacheAuthorizationForLifecycle(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
  signal?: AbortSignal,
): Promise<CharacterCacheAuthorization> {
  signal?.throwIfAborted()
  const stored = await findCharacterCacheAuthorizationForLifecycle(characterId, subjectLifecycleId)
  signal?.throwIfAborted()
  return readCacheAuthorization(stored, requiredScope)
}

export async function getCharacterAuthorization(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
  signal?: AbortSignal,
) {
  return getCharacterAuthorizationForLifecycle(
    characterId,
    subjectLifecycleId,
    requiredScope,
    signal,
  )
}

export async function getCharacterAuthorizationForLifecycle(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const fresh = await withLifecycleRefreshLock(
    characterId,
    subjectLifecycleId,
    async (stored) => {
      signal?.throwIfAborted()
      requireScope(stored.scopes, requiredScope)
      return stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs
        ? readStoredAuthorization(stored, requiredScope)
        : null
    },
    signal,
  )
  if (fresh) return fresh

  return withRefreshCapacity(async () => {
    signal?.throwIfAborted()
    const refreshed = await withLifecycleRefreshLock(
      characterId,
      subjectLifecycleId,
      async (stored, transaction) => {
        signal?.throwIfAborted()
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
      signal,
    )
    signal?.throwIfAborted()
    if ('authorizationRevoked' in refreshed) throw refreshed.authorizationRevoked
    requireScope(refreshed.scopes, requiredScope)
    return refreshed.authorization
  }, signal)
}

export async function withCharacterAuthorizationForLifecycle<T>(
  characterId: number,
  subjectLifecycleId: string,
  requiredScope: string,
  operation: (authorization: CharacterAuthorization) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const authorization = await getCharacterAuthorizationForLifecycle(
    characterId,
    subjectLifecycleId,
    requiredScope,
    signal,
  )
  const locked = await withLifecycleRefreshLock(
    characterId,
    subjectLifecycleId,
    async (stored) => {
      signal?.throwIfAborted()
      requireScope(stored.scopes, requiredScope)
      if (stored.tokenVersion !== authorization.tokenVersion) return { changed: true } as const
      try {
        return { changed: false, data: await operation(authorization) } as const
      } catch (error) {
        return { changed: false, error } as const
      }
    },
    signal,
  )
  if (locked.changed)
    return withCharacterAuthorizationForLifecycle(
      characterId,
      subjectLifecycleId,
      requiredScope,
      operation,
      signal,
    )
  if ('error' in locked) throw locked.error
  return locked.data
}

/**
 * Each in-flight refresh holds one pooled connection for the duration of its SSO calls, so the
 * number of them is capped well below the pool rather than left to the arrival rate.
 */
async function withRefreshCapacity<T>(operation: () => Promise<T>, signal?: AbortSignal) {
  await acquireRefreshSlot(signal)
  try {
    signal?.throwIfAborted()
    return await operation()
  } finally {
    activeRefreshes -= 1
    refreshWaiters.shift()?.()
  }
}

async function acquireRefreshSlot(signal?: AbortSignal) {
  signal?.throwIfAborted()
  // A woken waiter re-checks rather than assuming the slot is still free: releasing resolves the
  // waiter a microtask before it resumes, and a caller arriving in that gap takes the slot without
  // ever queueing.
  const deadline = Date.now() + env.TOKEN_REFRESH_QUEUE_TIMEOUT_MS
  while (activeRefreshes >= env.TOKEN_REFRESH_CONCURRENCY) {
    // Waiting is the point: each turn parks until a slot is released, so these cannot be collected
    // and awaited in parallel.
    // oxlint-disable-next-line no-await-in-loop
    await waitForRefreshSlot(deadline, signal)
  }
  activeRefreshes += 1
}

function waitForRefreshSlot(deadline: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waiter = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = () => {
      clearTimeout(timer)
      const queued = refreshWaiters.indexOf(waiter)
      if (queued !== -1) refreshWaiters.splice(queued, 1)
      reject(signal?.reason)
    }
    // The deadline spans the whole wait, not one turn, so repeated wake-ups cannot extend it.
    timer = setTimeout(
      () => {
        const queued = refreshWaiters.indexOf(waiter)
        if (queued !== -1) refreshWaiters.splice(queued, 1)
        signal?.removeEventListener('abort', onAbort)
        reject(new TokenRefreshUnavailableError())
      },
      Math.max(0, deadline - Date.now()),
    )
    refreshWaiters.push(waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function refreshLockedCharacterToken(
  characterId: number,
  requiredScope: string,
  original: StoredCharacterToken,
  stored: StoredCharacterToken,
  transaction: Parameters<Parameters<typeof withCharacterTokenLifecycleLock>[2]>[1],
  findWinner: () => Promise<StoredCharacterToken | null>,
): Promise<CharacterRefreshResult> {
  if (stored.tokenVersion !== original.tokenVersion)
    return toRefreshedCharacterAuthorization(stored, requiredScope)

  const currentTokens = decryptTokens(stored.encryptedTokens)
  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>
  try {
    // Once refresh starts, its deadline owns cancellation so any rotated credential is committed.
    refreshed = await refreshAccessToken(currentTokens.refreshToken)
  } catch (error) {
    if (isDefinitiveTokenRejection(error)) {
      await deleteRevokedCharacterAuthorization(characterId, stored, transaction)
      return { authorizationRevoked: error }
    }
    rethrowRefreshError(error)
  }
  let identity: Awaited<ReturnType<typeof verifyAccessToken>>
  try {
    identity = await verifyAccessToken(refreshed.access_token)
  } catch (error) {
    rethrowRefreshError(error)
  }
  if (identity.characterId !== characterId)
    throw new Error('Refreshed token belongs to a different character')
  const previousScopes = new Set(normalizeScopeSet(stored.scopes))
  const nextScopes = normalizeScopeSet(identity.scopes)
  const nextScopeSet = new Set(nextScopes)
  const addedScopes = nextScopes.filter((scope) => !previousScopes.has(scope))
  const removedScopes = [...previousScopes].filter((scope) => !nextScopeSet.has(scope))
  const scopesChanged = addedScopes.length > 0 || removedScopes.length > 0
  const organizationVersion = scopesChanged
    ? await lockCurrentOrganizationVersionForCompliance(transaction)
    : null

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
  if (!updated) return readRefreshWinner(findWinner, requiredScope)

  if (scopesChanged)
    await recordRefreshedScopeChange(
      characterId,
      stored,
      addedScopes,
      removedScopes,
      organizationVersion,
      transaction,
    )
  return {
    authorization: { accessToken: refreshed.access_token, tokenVersion: stored.tokenVersion + 1 },
    scopes: nextScopes,
  }
}

function rethrowRefreshError(error: unknown): never {
  if (isTransientSsoError(error)) throw new TokenRefreshUnavailableError()
  throw error
}

async function readRefreshWinner(
  findWinner: () => Promise<StoredCharacterToken | null>,
  requiredScope: string,
) {
  const winner = await findWinner()
  if (!winner) throw new CharacterTokenNotFoundError()
  return toRefreshedCharacterAuthorization(winner, requiredScope)
}

async function recordRefreshedScopeChange(
  characterId: number,
  stored: StoredCharacterToken,
  addedScopes: string[],
  removedScopes: string[],
  organizationVersion: number | null,
  transaction: Parameters<Parameters<typeof withCharacterTokenLifecycleLock>[2]>[1],
) {
  await appendDomainEvent(transaction, {
    type: 'character.scopes-changed',
    payloadVersion: 1,
    aggregateId: String(characterId),
    payload: { userId: stored.userId, characterId, addedScopes, removedScopes },
  })
  if (organizationVersion)
    await recomputeOrganizationAccountCompliance(
      { deploymentId: 1, organizationVersion, userId: stored.userId },
      transaction,
    )
}

async function deleteRevokedCharacterAuthorization(
  characterId: number,
  stored: StoredCharacterToken,
  transaction: Parameters<Parameters<typeof withCharacterTokenLifecycleLock>[2]>[1],
) {
  const deleted = await deleteCharacterTokenAuthorization(
    characterId,
    stored.tokenVersion,
    transaction,
  )
  if (!deleted) return

  const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
  const removedScopes = normalizeScopeSet(stored.scopes)
  if (removedScopes.length > 0)
    await appendDomainEvent(transaction, {
      type: 'character.scopes-changed',
      payloadVersion: 1,
      aggregateId: String(characterId),
      payload: {
        userId: stored.userId,
        characterId,
        addedScopes: [],
        removedScopes,
      },
    })
  if (organizationVersion)
    await recomputeOrganizationAccountCompliance(
      { deploymentId: 1, organizationVersion, userId: stored.userId },
      transaction,
    )
}

async function mapRefreshLockError<T>(locked: Promise<T>) {
  try {
    return await locked
  } catch (error) {
    if (error instanceof TokenRefreshLockUnavailableError) throw new TokenRefreshUnavailableError()
    throw error
  }
}

async function withLifecycleRefreshLock<T>(
  characterId: number,
  subjectLifecycleId: string,
  operation: Parameters<typeof withCharacterTokenLifecycleLock<T>>[2],
  signal?: AbortSignal,
) {
  const result = await mapRefreshLockError(
    withCharacterTokenLifecycleLock(characterId, subjectLifecycleId, operation),
  )
  signal?.throwIfAborted()
  return result
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

function readCacheAuthorization(
  stored: CharacterCacheAuthorization | null,
  requiredScope: string,
): CharacterCacheAuthorization {
  if (!stored) throw new CharacterTokenNotFoundError()
  requireScope(stored.scopes, requiredScope)
  return { scopes: stored.scopes, tokenVersion: stored.tokenVersion }
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

function isDefinitiveTokenRejection(
  error: unknown,
): error is EveSsoTokenRefreshError | SsoTokenRejectedError {
  return error instanceof EveSsoTokenRefreshError
    ? error.authorizationRevoked
    : error instanceof SsoTokenRejectedError
}
