import type { QueryCache } from '@pinia/colada'
import type { AuthSession, CacheAdmissionContext } from '../queries/auth'
import { unauthenticatedSession } from '../queries/auth'
import { clearAuthenticatedQueriesAfterSessionTransition } from '../queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../queries/query-keys'
import {
  applyVerifiedQueryIdentity,
  invalidatePrivateQueryScope,
  suspendPrivateQueryAdmission,
} from '../query-persistence/runtime'

const AUTH_VERIFICATION_UNAVAILABLE_STATE = 'auth-verification-unavailable'
const AUTH_VERIFIED_STATE = 'auth-verified'
const AUTH_VERIFICATION_GENERATION_STATE = 'auth-verification-generation'

export function useAuthVerification() {
  const unavailable = useState<boolean>(AUTH_VERIFICATION_UNAVAILABLE_STATE, () => false)
  const verified = useState<boolean>(AUTH_VERIFIED_STATE, () => false)
  const generation = useState<number>(AUTH_VERIFICATION_GENERATION_STATE, () => 0)

  function beginVerification({ resetIdentity = false } = {}) {
    const currentGeneration = generation.value + 1
    generation.value = currentGeneration
    unavailable.value = false
    if (resetIdentity) verified.value = false
    return currentGeneration
  }

  function markUnavailable(
    queryCache: QueryCache,
    currentGeneration: number,
    { retainPrivateData }: { retainPrivateData: boolean },
  ) {
    if (generation.value !== currentGeneration) return false
    generation.value += 1
    unavailable.value = true
    verified.value = false
    if (retainPrivateData) {
      suspendPrivateQueryAdmission(queryCache)
      return true
    }
    void invalidatePrivateQueryScope(queryCache)
    clearAuthenticatedQueriesAfterSessionTransition(queryCache, unauthenticatedSession)
    return true
  }

  async function markVerified(
    queryCache: QueryCache,
    currentGeneration: number,
    session: AuthSession,
    loadAdmission: (signal?: AbortSignal) => Promise<CacheAdmissionContext>,
    signal?: AbortSignal,
  ) {
    if (generation.value !== currentGeneration || signal?.aborted) return false
    const previousSession = queryCache.getQueryData<AuthSession>(PRIVATE_QUERY_KEYS.session())
    if (
      previousSession?.authenticated !== session.authenticated ||
      (session.authenticated &&
        previousSession?.authenticated &&
        previousSession.account.userId !== session.account.userId)
    ) {
      verified.value = false
    }
    await applyVerifiedQueryIdentity(queryCache, session, loadAdmission, signal)
    if (generation.value !== currentGeneration || signal?.aborted) return false
    unavailable.value = false
    verified.value = true
    return true
  }

  return {
    beginVerification,
    markUnavailable,
    markVerified,
    unavailable: readonly(unavailable),
    verified: readonly(verified),
  }
}
