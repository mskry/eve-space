import { useQuery, useQueryCache } from '@pinia/colada'
import { computed } from 'vue'
import { readOrganizationReadiness } from '../query-persistence/runtime'
import { organizationContextQuery } from '../queries/organization'
import { createApiClient } from '../utils/api-client'

export function usePlatformHostIdentity() {
  const organizationReady = readOrganizationReadiness(useQueryCache())
  const api = createApiClient(useRuntimeConfig().public.apiBase)
  const { authSession } = useAuthSession(api)
  const { characters } = useCharacterRoster(api)
  const organizationQuery = useQuery({
    ...organizationContextQuery(api),
    enabled: () =>
      import.meta.client && authSession.value.authenticated && organizationReady.value === 'ready',
  })
  return {
    authenticated: computed(() => authSession.value.authenticated),
    characters,
    organizationAuthorized: computed(
      () =>
        organizationReady.value === 'ready' &&
        authSession.value.authenticated &&
        organizationQuery.data.value?.memberAccess === true,
    ),
    organizationVersion: computed(() =>
      organizationReady.value === 'ready'
        ? (organizationQuery.data.value?.organization.organizationVersion ?? 0)
        : 0,
    ),
  }
}
