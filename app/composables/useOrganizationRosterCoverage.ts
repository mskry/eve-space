import { useQuery } from '@pinia/colada'
import { adminSetupQuery } from '../queries/admin'
import { organizationContextQuery, organizationRosterCoverageQuery } from '../queries/organization'
import type { ApiClient } from '../utils/api-client'

export function useOrganizationRosterCoverage(apiClient: ApiClient) {
  const { authSession, initializeAuth } = useAuthSession(apiClient)
  const setupQuery = useQuery({ ...adminSetupQuery(apiClient), enabled: import.meta.client })
  const contextQuery = useQuery({
    ...organizationContextQuery(apiClient),
    enabled: () =>
      import.meta.client &&
      authSession.value.authenticated &&
      setupQuery.data.value?.required === false,
  })
  const coverageQuery = useQuery({
    ...organizationRosterCoverageQuery(apiClient),
    enabled: () =>
      import.meta.client &&
      authSession.value.authenticated &&
      contextQuery.data.value?.memberAccess === true &&
      contextQuery.data.value?.capabilities.viewRosterCoverage === true,
  })

  const coverage = computed(() => coverageQuery.data.value)
  const loading = computed(
    () =>
      setupQuery.asyncStatus.value === 'loading' ||
      contextQuery.asyncStatus.value === 'loading' ||
      coverageQuery.asyncStatus.value === 'loading',
  )
  const errorMessage = computed(() => {
    const error = contextQuery.error.value ?? coverageQuery.error.value
    return error instanceof Error ? error.message : ''
  })

  async function initialize() {
    const [authenticated, setup] = await Promise.all([initializeAuth(), setupQuery.refresh()])
    if (!authenticated || setup.data?.required !== false) return
    const context = await contextQuery.refresh()
    if (context.data?.memberAccess && context.data.capabilities.viewRosterCoverage)
      await coverageQuery.refresh()
  }

  return { coverage, errorMessage, initialize, loading }
}
