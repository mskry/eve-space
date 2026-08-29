import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import {
  authConfigQuery,
  authSessionQuery,
  unauthenticatedSession,
  unavailableAuthConfig,
} from '../queries/auth'
import { clearAuthenticatedQueries } from '../queries/query-cache'

export function useAuthSession(apiClient: ApiClient) {
  const route = useRoute()
  const queryCache = useQueryCache()
  const configQuery = useQuery(authConfigQuery(apiClient))
  const sessionQuery = useQuery({
    ...authSessionQuery(apiClient),
    enabled: import.meta.client,
  })
  const logoutMutation = useMutation({
    mutation: async () => {
      const response = await apiClient.auth.logout.$post()
      if (!response.ok) throw await toApiQueryError(response, 'Logout failed.')
    },
  })

  const authConfig = computed(() => configQuery.data.value ?? unavailableAuthConfig)
  const authSession = computed(() => sessionQuery.data.value ?? unauthenticatedSession)
  const authLoading = computed(
    () => sessionQuery.status.value === 'pending' || sessionQuery.asyncStatus.value === 'loading',
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
    await logoutMutation.mutateAsync()
    clearAuthenticatedQueries(queryCache, unauthenticatedSession)
  }

  return {
    authConfig,
    authFeedback,
    authFeedbackIsError,
    authLoading,
    authSession,
    initializeAuth,
    logout,
    refreshAuthContext,
  }
}
