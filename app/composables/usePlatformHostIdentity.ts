import { useQuery, useQueryCache } from '@pinia/colada'
import { computed } from 'vue'
import { readOrganizationReadiness, readOrganizationRevision } from '../query-persistence/runtime'
import { PRIVATE_QUERY_KEYS } from '../queries/query-keys'
import type { AuthSession } from '../queries/auth'
import { organizationContextQuery } from '../queries/organization'
import { createApiClient } from '../utils/api-client'

const privateVerificationStatus = {
  idle: 'checking',
  verifying: 'checking',
  refreshing: 'checking',
  verified: 'verified',
  unavailable: 'unavailable',
} as const

export const usePlatformHostIdentity = () => {
  const cache = useQueryCache()
  const organizationReady = readOrganizationReadiness(cache)
  const organizationRevision = readOrganizationRevision(cache)
  const api = createApiClient(useRuntimeConfig().public.apiBase)
  const { authSession, authVerificationStatus } = useAuthSession(api)
  const { characters } = useCharacterRoster(api)
  const organizationQuery = useQuery({
    ...organizationContextQuery(api),
    enabled: () =>
      import.meta.client && authSession.value.authenticated && organizationReady.value === 'ready',
  })
  return {
    privateIdentity: computed(() => {
      const status = authVerificationStatus.value
      const retained = authSession.value.authenticated
        ? authSession.value
        : cache.getQueryData<AuthSession>(PRIVATE_QUERY_KEYS.session())
      return {
        ownerId: retained?.authenticated ? retained.account.userId : null,
        status: privateVerificationStatus[status],
        revision: JSON.stringify([organizationRevision.value, characters.value]),
      }
    }),
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
