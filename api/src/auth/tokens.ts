import { randomUUID } from 'node:crypto'
import type { DatabaseTransaction } from '../db/client.js'
import {
  CharacterTokenNotFoundError,
  deleteCharacterTokenAuthorization,
  findCharacterCacheAuthorizationForLifecycle,
  TokenRefreshLockUnavailableError,
  updateCharacterToken,
  withCharacterTokenLifecycleLock,
} from './character-token-store.js'
import type { StoredCharacterToken } from './character-token-store.js'
import {
  deletePendingCharacterToken,
  findPendingCharacterToken,
  writePendingCharacterToken,
  type PendingCharacterToken,
} from './pending-character-token-store.js'
import { appendDomainEvent } from '../domain-events/store.js'
import {
  lockCurrentOrganizationVersionForCompliance,
  recomputeOrganizationAccountCompliance,
} from '../organization/compliance.js'
import {
  advanceCharacterAuthorityAuthorizationGenerationInTransaction,
  invalidateCharacterAuthoritySourcesInTransaction,
} from '../organization/authority-convergence.js'
import { enqueueInstalledResourceLifecyclePurges } from '../platform/resource-purge.js'
import { normalizeScopeSet } from '../scopes.js'
import { recordDiagnostic } from '../logging.js'
import { env } from '../env.js'
import { EveSsoTokenRefreshError, refreshAccessToken, verifyAccessToken } from './sso.js'
import {
  CharacterOwnerMismatchError,
  SsoAccessTokenExpiredError,
  SsoTokenRejectedError,
} from './sso-errors.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from './token-errors.js'
import { schedulePendingRecoveryOnce } from './pending-recovery-state.js'
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

type CharacterRefreshResult =
  | RefreshedCharacterAuthorization
  | RevokedCharacterAuthorization
  | { readonly pending: PendingCharacterToken }

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
  if (stored?.pendingAttemptId) {
    await recoverPendingCharacterToken(characterId, subjectLifecycleId, signal)
    signal?.throwIfAborted()
    const recovered = await findCharacterCacheAuthorizationForLifecycle(
      characterId,
      subjectLifecycleId,
    )
    if (recovered?.pendingAttemptId) {
      throw new TokenRefreshUnavailableError()
    }
    return readCacheAuthorization(recovered, requiredScope)
  }
  signal?.throwIfAborted()
  return readCacheAuthorization(stored, requiredScope)
}

export const recoverPendingCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  signal?: AbortSignal,
): Promise<void> => {
  await withRefreshCapacity(async () => {
    const pending = await findPendingCharacterToken(characterId, subjectLifecycleId)
    if (pending) {
      await resumePendingCharacterToken(characterId, subjectLifecycleId, pending)
    }
  }, signal)
}

export const schedulePendingCharacterTokenRecovery = (
  characterId: number,
  subjectLifecycleId: string,
) => {
  schedulePendingRecoveryOnce(
    characterId,
    subjectLifecycleId,
    () => recoverPendingCharacterToken(characterId, subjectLifecycleId),
    (error) => {
      recordDiagnostic(
        error instanceof SsoTokenRejectedError
          ? 'auth.pending-token-recovery.rejected'
          : 'auth.pending-token-recovery.unavailable',
      )
    },
  )
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
    async (stored, transaction) => {
      signal?.throwIfAborted()
      const pending = await findPendingCharacterToken(characterId, subjectLifecycleId, transaction)
      if (pending) {
        return null
      }
      return stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs
        ? readStoredAuthorization(stored, requiredScope)
        : null
    },
    signal,
  )
  if (fresh) {
    return fresh
  }

  return withRefreshCapacity(async () => {
    signal?.throwIfAborted()
    const refreshed = await withLifecycleRefreshLock(
      characterId,
      subjectLifecycleId,
      async (stored, transaction) => {
        signal?.throwIfAborted()
        const pending = await findPendingCharacterToken(
          characterId,
          subjectLifecycleId,
          transaction,
        )
        if (pending) {
          return { pending }
        }
        if (stored.accessTokenExpiresAt.getTime() > Date.now() + tokenFreshnessSkewMs) {
          return toRefreshedCharacterAuthorization(stored, requiredScope)
        }
        return refreshLockedCharacterToken(characterId, subjectLifecycleId, stored, transaction)
      },
    )
    signal?.throwIfAborted()
    if ('authorizationRevoked' in refreshed) {
      throw refreshed.authorizationRevoked
    }
    const verified =
      'pending' in refreshed
        ? await resumePendingCharacterToken(characterId, subjectLifecycleId, refreshed.pending)
        : refreshed
    signal?.throwIfAborted()
    requireScope(verified.scopes, requiredScope)
    return verified.authorization
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
    async (stored, transaction) => {
      signal?.throwIfAborted()
      if (await findPendingCharacterToken(characterId, subjectLifecycleId, transaction)) {
        throw new TokenRefreshUnavailableError()
      }
      requireScope(stored.scopes, requiredScope)
      if (stored.tokenVersion !== authorization.tokenVersion) {
        return { changed: true } as const
      }
      try {
        return { changed: false, data: await operation(authorization) } as const
      } catch (error) {
        return { changed: false, error } as const
      }
    },
    signal,
  )
  if (locked.changed) {
    return withCharacterAuthorizationForLifecycle(
      characterId,
      subjectLifecycleId,
      requiredScope,
      operation,
      signal,
    )
  }
  if ('error' in locked) {
    throw locked.error
  }
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
      if (queued !== -1) {
        refreshWaiters.splice(queued, 1)
      }
      reject(signal?.reason)
    }
    // The deadline spans the whole wait, not one turn, so repeated wake-ups cannot extend it.
    timer = setTimeout(
      () => {
        const queued = refreshWaiters.indexOf(waiter)
        if (queued !== -1) {
          refreshWaiters.splice(queued, 1)
        }
        signal?.removeEventListener('abort', onAbort)
        reject(new TokenRefreshUnavailableError())
      },
      Math.max(0, deadline - Date.now()),
    )
    refreshWaiters.push(waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const refreshLockedCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  stored: StoredCharacterToken,
  transaction: DatabaseTransaction,
): Promise<CharacterRefreshResult> => {
  const currentTokens = decryptTokens(stored.encryptedTokens)
  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>
  try {
    refreshed = await refreshAccessToken(currentTokens.refreshToken)
  } catch (error) {
    if (isDefinitiveTokenRejection(error)) {
      await deleteRevokedCharacterAuthorization(
        characterId,
        subjectLifecycleId,
        stored,
        transaction,
      )
      return { authorizationRevoked: error }
    }
    rethrowRefreshError(error)
  }
  const pending = await persistPendingRefresh(
    transaction,
    {
      characterId,
      userId: stored.userId,
      subjectLifecycleId,
      baseTokenVersion: stored.tokenVersion,
      expectedAttemptId: null,
    },
    refreshed,
    currentTokens.refreshToken,
  )
  return { pending }
}

const persistPendingRefresh = async (
  transaction: DatabaseTransaction,
  binding: Omit<PendingCharacterToken, 'attemptId' | 'encryptedTokens' | 'accessTokenExpiresAt'> & {
    expectedAttemptId: string | null
  },
  refreshed: Awaited<ReturnType<typeof refreshAccessToken>>,
  refreshToken: string,
): Promise<PendingCharacterToken> => {
  const pending = {
    characterId: binding.characterId,
    userId: binding.userId,
    subjectLifecycleId: binding.subjectLifecycleId,
    baseTokenVersion: binding.baseTokenVersion,
    attemptId: randomUUID(),
    encryptedTokens: encryptTokens({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? refreshToken,
    }),
    accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
  }
  if (
    !(await writePendingCharacterToken(transaction, {
      ...pending,
      expectedAttemptId: binding.expectedAttemptId,
    }))
  ) {
    throw new TokenRefreshUnavailableError()
  }
  return pending
}

const refreshExpiredPending = async (
  characterId: number,
  subjectLifecycleId: string,
  pending: PendingCharacterToken,
): Promise<PendingCharacterToken> => {
  const result = await withLifecycleRefreshLock(
    characterId,
    subjectLifecycleId,
    async (stored, transaction) => {
      const latest = await findPendingCharacterToken(characterId, subjectLifecycleId, transaction)
      if (!latest || !samePendingAttempt(stored, latest, pending)) {
        throw new TokenRefreshUnavailableError()
      }
      const currentTokens = decryptTokens(latest.encryptedTokens)
      let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>
      try {
        refreshed = await refreshAccessToken(currentTokens.refreshToken)
      } catch (error) {
        if (isDefinitiveTokenRejection(error)) {
          await deleteRevokedCharacterAuthorization(
            characterId,
            subjectLifecycleId,
            stored,
            transaction,
          )
          return { authorizationRevoked: error }
        }
        rethrowRefreshError(error)
      }
      return persistPendingRefresh(
        transaction,
        { ...latest, expectedAttemptId: latest.attemptId },
        refreshed,
        currentTokens.refreshToken,
      )
    },
  )
  if ('authorizationRevoked' in result) {
    throw result.authorizationRevoked
  }
  return result
}

const resumePendingCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  pending: PendingCharacterToken,
): Promise<RefreshedCharacterAuthorization> => {
  const current =
    pending.accessTokenExpiresAt.getTime() <= Date.now() + tokenFreshnessSkewMs
      ? await refreshExpiredPending(characterId, subjectLifecycleId, pending)
      : pending
  const verified = await verifyPendingCharacterToken(characterId, subjectLifecycleId, current)
  if (verified.identity.characterId !== characterId) {
    await revokeInvalidPendingCharacterToken(characterId, subjectLifecycleId, verified.pending)
    throw new SsoTokenRejectedError(401)
  }
  return promotePendingCharacterToken(
    characterId,
    subjectLifecycleId,
    verified.pending,
    verified.identity,
  )
}

const verifyPendingCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  pending: PendingCharacterToken,
  allowExpiredRetry = true,
): Promise<{
  pending: PendingCharacterToken
  identity: Awaited<ReturnType<typeof verifyAccessToken>>
}> => {
  try {
    const identity = await verifyAccessToken(decryptTokens(pending.encryptedTokens).accessToken)
    return { pending, identity }
  } catch (error) {
    if (error instanceof SsoAccessTokenExpiredError && allowExpiredRetry) {
      const refreshed = await refreshExpiredPending(characterId, subjectLifecycleId, pending)
      return verifyPendingCharacterToken(characterId, subjectLifecycleId, refreshed, false)
    }
    if (error instanceof SsoTokenRejectedError) {
      await revokeInvalidPendingCharacterToken(characterId, subjectLifecycleId, pending)
      throw error
    }
    throw new TokenRefreshUnavailableError()
  }
}

const samePendingAttempt = (
  stored: StoredCharacterToken,
  latest: PendingCharacterToken | null,
  expected: PendingCharacterToken,
) =>
  stored.userId === expected.userId &&
  stored.tokenVersion === expected.baseTokenVersion &&
  latest?.attemptId === expected.attemptId &&
  latest.userId === expected.userId &&
  latest.baseTokenVersion === expected.baseTokenVersion

const revokeInvalidPendingCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  pending: PendingCharacterToken,
) => {
  await withLifecycleRefreshLock(characterId, subjectLifecycleId, async (stored, transaction) => {
    const latest = await findPendingCharacterToken(characterId, subjectLifecycleId, transaction)
    if (!samePendingAttempt(stored, latest, pending)) {
      throw new TokenRefreshUnavailableError()
    }
    await deleteRevokedCharacterAuthorization(characterId, subjectLifecycleId, stored, transaction)
  })
}

const promotePendingCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  pending: PendingCharacterToken,
  identity: Awaited<ReturnType<typeof verifyAccessToken>>,
): Promise<RefreshedCharacterAuthorization> => {
  const result = await withLifecycleRefreshLock(
    characterId,
    subjectLifecycleId,
    async (stored, transaction) => {
      const latest = await findPendingCharacterToken(characterId, subjectLifecycleId, transaction)
      if (!samePendingAttempt(stored, latest, pending)) {
        if (!latest && stored.tokenVersion !== pending.baseTokenVersion) {
          return toRefreshedCharacterAuthorization(stored)
        }
        throw new TokenRefreshUnavailableError()
      }
      if (identity.ownerHash !== stored.ownerHash) {
        await deleteRevokedCharacterAuthorization(
          characterId,
          subjectLifecycleId,
          stored,
          transaction,
          'owner-mismatch',
        )
        return { authorizationRevoked: new CharacterOwnerMismatchError() }
      }
      return commitVerifiedPendingToken(characterId, stored, pending, identity, transaction)
    },
  )
  if ('authorizationRevoked' in result) {
    throw result.authorizationRevoked
  }
  return result
}

const commitVerifiedPendingToken = async (
  characterId: number,
  stored: StoredCharacterToken,
  pending: PendingCharacterToken,
  identity: Awaited<ReturnType<typeof verifyAccessToken>>,
  transaction: DatabaseTransaction,
): Promise<RefreshedCharacterAuthorization> => {
  const previousScopes = new Set(normalizeScopeSet(stored.scopes))
  const nextScopes = normalizeScopeSet(identity.scopes)
  const nextScopeSet = new Set(nextScopes)
  const addedScopes = nextScopes.filter((scope) => !previousScopes.has(scope))
  const removedScopes = [...previousScopes].filter((scope) => !nextScopeSet.has(scope))
  const scopesChanged = addedScopes.length > 0 || removedScopes.length > 0
  const organizationVersion = scopesChanged
    ? await lockCurrentOrganizationVersionForCompliance(transaction)
    : null

  if (!(await deletePendingCharacterToken(transaction, pending))) {
    throw new TokenRefreshUnavailableError()
  }
  const updated = await updateCharacterToken(
    {
      characterId,
      encryptedTokens: pending.encryptedTokens,
      expiresAt: pending.accessTokenExpiresAt,
      scopes: nextScopes,
      tokenVersion: stored.tokenVersion,
    },
    transaction,
  )
  if (!updated) {
    throw new TokenRefreshUnavailableError()
  }

  if (scopesChanged) {
    await recordRefreshedScopeChange(
      characterId,
      stored,
      addedScopes,
      removedScopes,
      organizationVersion,
      transaction,
    )
  } else {
    await advanceCharacterAuthorityAuthorizationGenerationInTransaction(transaction, {
      authorizationGeneration: stored.tokenVersion + 1,
      characterId,
    })
  }
  return {
    authorization: {
      accessToken: decryptTokens(pending.encryptedTokens).accessToken,
      tokenVersion: stored.tokenVersion + 1,
    },
    scopes: nextScopes,
  }
}

function rethrowRefreshError(error: unknown): never {
  if (error instanceof SsoTokenRejectedError) {
    throw error
  }
  throw new TokenRefreshUnavailableError()
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
    aggregateId: String(characterId),
    payload: { addedScopes, characterId, removedScopes, userId: stored.userId },
    payloadVersion: 1,
    type: 'character.scopes-changed',
  })
  if (organizationVersion) {
    await recomputeOrganizationAccountCompliance(
      { deploymentId: 1, organizationVersion, userId: stored.userId },
      transaction,
    )
  }
  await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
    characterId,
    outcome: 'authorization-generation-changed',
  })
}

async function deleteRevokedCharacterAuthorization(
  characterId: number,
  subjectLifecycleId: string,
  stored: StoredCharacterToken,
  transaction: Parameters<Parameters<typeof withCharacterTokenLifecycleLock>[2]>[1],
  outcome: 'authorization-revoked' | 'owner-mismatch' = 'authorization-revoked',
) {
  const deleted = await deleteCharacterTokenAuthorization(
    characterId,
    stored.tokenVersion,
    transaction,
  )
  if (!deleted) {
    return
  }

  if (outcome === 'owner-mismatch') {
    await enqueueInstalledResourceLifecyclePurges(transaction, subjectLifecycleId)
  }

  const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
  const removedScopes = normalizeScopeSet(stored.scopes)
  if (removedScopes.length > 0) {
    await appendDomainEvent(transaction, {
      aggregateId: String(characterId),
      payload: {
        addedScopes: [],
        characterId,
        removedScopes,
        userId: stored.userId,
      },
      payloadVersion: 1,
      type: 'character.scopes-changed',
    })
  }
  if (organizationVersion) {
    await recomputeOrganizationAccountCompliance(
      { deploymentId: 1, organizationVersion, userId: stored.userId },
      transaction,
    )
  }
  await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
    characterId,
    outcome,
  })
}

async function mapRefreshLockError<T>(locked: Promise<T>) {
  try {
    return await locked
  } catch (error) {
    if (error instanceof TokenRefreshLockUnavailableError) {
      throw new TokenRefreshUnavailableError()
    }
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
  if (!stored) {
    throw new CharacterTokenNotFoundError()
  }
  requireScope(stored.scopes, requiredScope)
  return { scopes: stored.scopes, tokenVersion: stored.tokenVersion }
}

function toRefreshedCharacterAuthorization(
  stored: StoredCharacterToken,
  requiredScope?: string,
): RefreshedCharacterAuthorization {
  if (requiredScope) {
    requireScope(stored.scopes, requiredScope)
  }
  return {
    authorization: {
      accessToken: decryptTokens(stored.encryptedTokens).accessToken,
      tokenVersion: stored.tokenVersion,
    },
    scopes: stored.scopes,
  }
}

function requireScope(scopes: readonly string[], requiredScope: string) {
  if (!scopes.includes(requiredScope)) {
    throw new ScopeRequiredError(requiredScope)
  }
}

function isDefinitiveTokenRejection(
  error: unknown,
): error is EveSsoTokenRefreshError | SsoTokenRejectedError {
  return error instanceof EveSsoTokenRefreshError
    ? error.authorizationRevoked
    : error instanceof SsoTokenRejectedError
}
