import { useQuery } from '@pinia/colada'
import { computed } from 'vue'
import { organizationContextQuery } from '../queries/organization'
import { createApiClient } from '../utils/api-client'

export function usePlatformHostIdentity() {
  const api = createApiClient(useRuntimeConfig().public.apiBase)
  const { authSession } = useAuthSession(api)
  const { characters } = useCharacterRoster(api)
  const organizationQuery = useQuery({
    ...organizationContextQuery(api),
    enabled: () => import.meta.client && authSession.value.authenticated,
  })
  return {
    authenticated: computed(() => authSession.value.authenticated),
    organizationAuthorized: computed(
      () => authSession.value.authenticated && organizationQuery.data.value?.memberAccess === true,
    ),
    organizationVersion: computed(
      () => organizationQuery.data.value?.organization.organizationVersion ?? 0,
    ),
    characters,
  }
}
