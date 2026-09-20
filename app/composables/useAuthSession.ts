import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import {
  authConfigQuery,
  authSessionQuery,
  loadCacheAdmission,
  unauthenticatedSession,
  unavailableAuthConfig,
} from '../queries/auth'
import { useAuthSessionInitialization } from './useAuthSessionInitialization'

export function useAuthSession(apiClient: ApiClient, { autoLoad = true } = {}) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const initialization = useAuthSessionInitialization(apiClient)
  const authVerification = initialization.verification
  const configQuery = useQuery({
    ...authConfigQuery(apiClient),
    enabled: import.meta.client && autoLoad,
  })
  const sessionOptions = initialization.options
  const sessionQuery = useQuery({
    ...sessionOptions,
    enabled: import.meta.client && autoLoad,
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
    await Promise.all([loadConfig(), initialization.initialize(force)])
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
