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

export function useAuthSession(apiClient: ApiClient) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const authVerification = useAuthVerification()
  const configQuery = useQuery({
    ...authConfigQuery(apiClient),
    enabled: import.meta.client,
  })
  const sessionOptions = authSessionQuery(apiClient)
  const sessionQuery = useQuery({
    ...sessionOptions,
    enabled: import.meta.client,
    query: async (context) => {
      const verificationGeneration = authVerification.beginVerification()
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
          queryCache.cancel(context.entry, new Error('Session verification superseded.'))
        }
        return session
      } catch (error) {
        if (!context.signal.aborted) {
          authVerification.markUnavailable(queryCache, verificationGeneration, {
            retainPrivateData: !isAuthenticationDenial(error),
          })
        }
        throw error
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
  const authUnavailable = computed(() => authVerification.unavailable.value)
  const authSession = computed(() =>
    authUnavailable.value || !authVerification.verified.value
      ? unauthenticatedSession
      : (sessionQuery.data.value ?? unauthenticatedSession),
  )
  const authLoading = computed(() => !authVerification.verified.value && !authUnavailable.value)
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
    const loadSession = force ? sessionQuery.refetch : sessionQuery.refresh
    const [, sessionState] = await Promise.all([loadConfig(), loadSession()])
    return sessionState.data?.authenticated ?? false
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
    initializeAuth,
    logout,
    refreshAuthContext,
  }
}
