import type { QueryCache } from '@pinia/colada'
import { computed } from 'vue'
import {
  unauthenticatedSession,
  type AuthSession,
  type CacheAdmissionContext,
  type CacheAdmissionBootstrap,
} from '../queries/auth'
import { clearAuthenticatedQueriesAfterSessionTransition } from '../queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../queries/query-keys'
import {
  applyVerifiedQueryIdentity,
  invalidatePrivateQueryScope,
  suspendPrivateQueryAdmission,
} from '../query-persistence/runtime'

const AUTH_VERIFICATION_STATE = 'auth-verification-state'

export type AuthVerificationStatus =
  | 'idle'
  | 'verifying'
  | 'refreshing'
  | 'verified'
  | 'unavailable'

interface AuthVerificationState {
  generation: number
  status: AuthVerificationStatus
}

export function useAuthVerification() {
  const state = useState<AuthVerificationState>(AUTH_VERIFICATION_STATE, () => ({
    generation: 0,
    status: 'idle',
  }))
  const accepted = computed(() => hasAcceptedSession(state.value.status))
  const inFlight = computed(() => isVerificationInFlight(state.value.status))

  function beginVerification({ resetIdentity = false } = {}) {
    const currentGeneration = state.value.generation + 1
    state.value = {
      generation: currentGeneration,
      status: !resetIdentity && hasAcceptedSession(state.value.status) ? 'refreshing' : 'verifying',
    }
    return currentGeneration
  }

  function markUnavailable(
    queryCache: QueryCache,
    currentGeneration: number,
    { retainPrivateData }: { retainPrivateData: boolean },
  ) {
    if (!ownsVerification(state.value, currentGeneration)) {
      return false
    }
    state.value = { generation: currentGeneration, status: 'unavailable' }
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
    admission?: CacheAdmissionBootstrap,
  ) {
    if (!ownsVerification(state.value, currentGeneration) || signal?.aborted) {
      return false
    }
    const previousSession = queryCache.getQueryData<AuthSession>(PRIVATE_QUERY_KEYS.session())
    if (
      previousSession?.authenticated !== session.authenticated ||
      (session.authenticated &&
        previousSession?.authenticated &&
        previousSession.account.userId !== session.account.userId)
    ) {
      state.value = { generation: currentGeneration, status: 'verifying' }
    }
    await applyVerifiedQueryIdentity(queryCache, session, loadAdmission, signal, admission)
    if (!ownsVerification(state.value, currentGeneration) || signal?.aborted) {
      return false
    }
    state.value = { generation: currentGeneration, status: 'verified' }
    return true
  }

  return {
    accepted,
    beginVerification,
    inFlight,
    markUnavailable,
    markVerified,
    state: readonly(state),
  }
}

function hasAcceptedSession(status: AuthVerificationStatus) {
  return status === 'verified' || status === 'refreshing'
}

function isVerificationInFlight(status: AuthVerificationStatus) {
  return status === 'verifying' || status === 'refreshing'
}

function ownsVerification(state: AuthVerificationState, generation: number) {
  return state.generation === generation && isVerificationInFlight(state.status)
}
