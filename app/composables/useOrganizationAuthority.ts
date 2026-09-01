import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import {
  organizationContextQuery,
  organizationRolesQuery,
  type DelegatedOrganizationRole,
} from '../queries/organization'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'

interface GrantOrganizationRoleInput {
  userId: string
  role: DelegatedOrganizationRole
  reason: string
}

export function useOrganizationAuthority(apiClient: ApiClient) {
  const queryCache = useQueryCache()
  const { authSession, initializeAuth } = useAuthSession(apiClient)
  const contextQuery = useQuery({
    ...organizationContextQuery(apiClient),
    enabled: () => import.meta.client && authSession.value.authenticated,
  })
  const rolesQuery = useQuery({
    ...organizationRolesQuery(apiClient),
    enabled: () =>
      import.meta.client &&
      authSession.value.authenticated &&
      contextQuery.data.value?.isOrganizationOwner === true,
  })
  const grantMutation = useMutation({
    mutation: async (input: GrantOrganizationRoleInput) => {
      const response = await apiClient.api.organization.roles.$post({ json: input })
      if (response.status !== 201) {
        throw await toApiQueryError(response, 'Organization role could not be granted.')
      }
      return response.json()
    },
  })
  const revokeMutation = useMutation({
    mutation: async ({ grantId, reason }: { grantId: string; reason: string }) => {
      const response = await apiClient.api.organization.roles[':grantId'].revoke.$post({
        param: { grantId },
        json: { reason },
      })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Organization role could not be revoked.')
      }
      return response.json()
    },
  })

  const authorityContext = computed(() => contextQuery.data.value)
  const roleGrants = computed(() => rolesQuery.data.value?.grants ?? [])
  const loading = computed(
    () =>
      contextQuery.asyncStatus.value === 'loading' ||
      (authorityContext.value?.isOrganizationOwner && rolesQuery.asyncStatus.value === 'loading'),
  )
  const mutationPending = computed(
    () =>
      grantMutation.asyncStatus.value === 'loading' ||
      revokeMutation.asyncStatus.value === 'loading',
  )
  const errorMessage = computed(() => {
    const error =
      grantMutation.error.value ??
      revokeMutation.error.value ??
      contextQuery.error.value ??
      rolesQuery.error.value
    return error instanceof Error ? error.message : ''
  })

  async function initialize() {
    const authenticated = await initializeAuth()
    if (authenticated) await contextQuery.refresh()
  }

  async function refreshRoles() {
    await queryCache.invalidateQueries({
      exact: true,
      key: organizationRolesQuery(apiClient).key,
    })
  }

  async function grantRole(input: GrantOrganizationRoleInput) {
    await grantMutation.mutateAsync(input)
    await refreshRoles()
  }

  async function revokeRole(grantId: string, reason: string) {
    await revokeMutation.mutateAsync({ grantId, reason })
    await refreshRoles()
  }

  return {
    authorityContext,
    errorMessage,
    grantRole,
    initialize,
    loading,
    mutationPending,
    revokeRole,
    roleGrants,
  }
}
