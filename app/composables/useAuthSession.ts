import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { isAuthenticationDenial } from '../utils/authentication-denial'
import { toApiQueryError } from '../utils/query-error'
import {
  authConfigQuery,
  authSessionQuery,
  loadCacheAdmission,
  unauthenticatedSession,
  unavailableAuthConfig,
} from '../queries/auth'
import { useAuthVerification } from './useAuthVerification'

export function useAuthSession(apiClient: ApiClient, { autoLoad = true } = {}) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const authVerification = useAuthVerification()
  const configQuery = useQuery({
    ...authConfigQuery(apiClient),
    enabled: import.meta.client && autoLoad,
  })
  const sessionOptions = authSessionQuery(apiClient)
  const sessionQuery = useQuery({
    ...sessionOptions,
    enabled: import.meta.client && autoLoad,
    query: async (context) => {
      const verificationGeneration = authVerification.beginVerification()
      const settleCancellation = () => {
        queueMicrotask(() => {
          authVerification.markUnavailable(queryCache, verificationGeneration, {
            retainPrivateData: true,
          })
        })
      }
      context.signal.addEventListener('abort', settleCancellation, { once: true })
      try {
        const session = await sessionOptions.query(context)
        const accepted = await authVerification.markVerified(
          queryCache,
          verificationGeneration,
          session,
          (signal) => loadCacheAdmission(apiClient, signal),
          context.signal,
        )
        if (!accepted) {
          if (context.entry.pending?.abortController.signal === context.signal) {
            queryCache.cancel(context.entry, new Error('Session verification superseded.'))
          }
        }
        return session
      } catch (error) {
        if (!context.signal.aborted) {
          authVerification.markUnavailable(queryCache, verificationGeneration, {
            retainPrivateData: !isAuthenticationDenial(error),
          })
        }
        throw error
      } finally {
        context.signal.removeEventListener('abort', settleCancellation)
      }
    },
  })
  const logoutMutation = useMutation({
    mutation: async () => {
      const response = await apiClient.auth.logout.$post()
      if (!response.ok) throw await toApiQueryError(response, 'Logout failed.')
    },
  })

  const authConfig = computed(() => configQuery.data.value ?? unavailableAuthConfig)
  const authVerificationStatus = computed(() => authVerification.state.value.status)
  const authUnavailable = computed(() => authVerificationStatus.value === 'unavailable')
  const authVerificationInFlight = computed(() => authVerification.inFlight.value)
  const authSession = computed(() =>
    !authVerification.accepted.value
      ? unauthenticatedSession
      : (sessionQuery.data.value ?? unauthenticatedSession),
  )
  const authLoading = computed(
    () => authVerificationStatus.value === 'idle' || authVerificationStatus.value === 'verifying',
  )
  const authFeedback = computed(() => {
    if (route.query.auth === 'cancelled') return 'EVE login was cancelled.'
    if (route.query.auth === 'error') return 'EVE login could not be completed.'
    if (route.query.auth === 'success') return 'Character authorization completed.'
    return ''
  })
  const authFeedbackIsError = computed(() => route.query.auth !== 'success')

  async function initializeAuth(force = false) {
    if (!import.meta.client) return false
    const loadConfig = force ? configQuery.refetch : configQuery.refresh
    const requiresVerification =
      authVerificationStatus.value === 'idle' || authVerificationStatus.value === 'unavailable'
    const loadSession = force || requiresVerification ? sessionQuery.refetch : sessionQuery.refresh
    await Promise.all([loadConfig(), loadSession()])
    return authSession.value.authenticated
  }

  async function refreshAuthContext() {
    await Promise.all([
      queryCache.invalidateQueries({ exact: true, key: authConfigQuery(apiClient).key }),
      queryCache.invalidateQueries({ exact: true, key: authSessionQuery(apiClient).key }),
    ])
    return authSession.value.authenticated
  }

  async function logout() {
    authVerification.beginVerification({ resetIdentity: true })
    cancelSessionVerification()
    try {
      await logoutMutation.mutateAsync()
    } catch (error) {
      const failedGeneration = authVerification.beginVerification({ resetIdentity: true })
      authVerification.markUnavailable(queryCache, failedGeneration, { retainPrivateData: false })
      throw error
    }

    const settledGeneration = authVerification.beginVerification({ resetIdentity: true })
    cancelSessionVerification()
    await authVerification.markVerified(
      queryCache,
      settledGeneration,
      unauthenticatedSession,
      (signal) => loadCacheAdmission(apiClient, signal),
    )
  }

  function cancelSessionVerification() {
    queryCache.cancelQueries(
      { exact: true, key: sessionOptions.key },
      new Error('Session verification superseded.'),
    )
  }

  return {
    authConfig,
    authFeedback,
    authFeedbackIsError,
    authLoading,
    authSession,
    authUnavailable,
    authVerificationInFlight,
    authVerificationStatus,
    initializeAuth,
    logout,
    refreshAuthContext,
  }
}
