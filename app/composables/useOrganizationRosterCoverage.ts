import { useQuery } from '@pinia/colada'
import { organizationContextQuery, organizationRosterCoverageQuery } from '../queries/organization'
import type { ApiClient } from '../utils/api-client'

export function useOrganizationRosterCoverage(apiClient: ApiClient) {
  const { authSession, initializeAuth } = useAuthSession(apiClient)
  const contextQuery = useQuery({
    ...organizationContextQuery(apiClient),
    enabled: () => import.meta.client && authSession.value.authenticated,
  })
  const coverageQuery = useQuery({
    ...organizationRosterCoverageQuery(apiClient),
    enabled: () =>
      import.meta.client &&
      authSession.value.authenticated &&
      contextQuery.data.value?.capabilities.viewRosterCoverage === true,
  })

  const coverage = computed(() => coverageQuery.data.value)
  const loading = computed(
    () =>
      contextQuery.asyncStatus.value === 'loading' || coverageQuery.asyncStatus.value === 'loading',
  )
  const errorMessage = computed(() => {
    const error = contextQuery.error.value ?? coverageQuery.error.value
    return error instanceof Error ? error.message : ''
  })

  async function initialize() {
    if (!(await initializeAuth())) return
    const context = await contextQuery.refresh()
    if (context.data?.capabilities.viewRosterCoverage) await coverageQuery.refresh()
  }

  return { coverage, errorMessage, initialize, loading }
}
