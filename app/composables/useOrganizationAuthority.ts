import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { readonly, ref, shallowRef } from 'vue'
import { adminSetupQuery } from '../queries/admin'
import {
  organizationContextQuery,
  organizationRolesQuery,
  type DelegatedOrganizationRole,
} from '../queries/organization'
import { refreshPrivateAuthorization } from '../queries/query-cache'
import {
  reportPrivateQueryAuthorizationDenial,
  subscribePrivateQueryInvalidation,
} from '../query-persistence/runtime'
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
  const setupQuery = useQuery(() => ({
    ...adminSetupQuery(apiClient),
    enabled: import.meta.client,
  }))
  const deploymentConfigured = computed(() =>
    setupQuery.data.value ? !setupQuery.data.value.required : undefined,
  )
  const contextQuery = useQuery({
    ...organizationContextQuery(apiClient),
    enabled: () =>
      import.meta.client && authSession.value.authenticated && deploymentConfigured.value === true,
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
  const invalidationRevision = ref(0)
  const actionError = shallowRef<unknown>()

  subscribePrivateQueryInvalidation(queryCache, { kind: 'organization' }, resetAuthorityState)

  const authorityContext = computed(() => contextQuery.data.value)
  const roleGrants = computed(() => rolesQuery.data.value?.grants ?? [])
  const loading = computed(
    () =>
      setupQuery.asyncStatus.value === 'loading' ||
      (deploymentConfigured.value === true && contextQuery.asyncStatus.value === 'loading') ||
      (authorityContext.value?.isOrganizationOwner && rolesQuery.asyncStatus.value === 'loading'),
  )
  const mutationPending = computed(
    () =>
      grantMutation.asyncStatus.value === 'loading' ||
      revokeMutation.asyncStatus.value === 'loading',
  )
  const errorMessage = computed(() => {
    const error =
      actionError.value ??
      grantMutation.error.value ??
      revokeMutation.error.value ??
      setupQuery.error.value ??
      contextQuery.error.value ??
      rolesQuery.error.value
    return error instanceof Error ? error.message : ''
  })

  async function initialize() {
    const [authenticated, setupState] = await Promise.all([initializeAuth(), setupQuery.refresh()])
    if (authenticated && setupState.data?.required === false) await contextQuery.refresh()
  }

  async function refreshRoles() {
    await refreshPrivateAuthorization(queryCache, { kind: 'organization' })
  }

  async function grantRole(input: GrantOrganizationRoleInput) {
    const operationRevision = invalidationRevision.value
    actionError.value = undefined
    try {
      await grantMutation.mutateAsync(input)
    } catch (error) {
      const current = operationRevision === invalidationRevision.value
      if (reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)) {
        if (current) actionError.value = error
      }
      throw error
    }
    if (operationRevision !== invalidationRevision.value) return false
    await refreshRoles()
    return true
  }

  async function revokeRole(grantId: string, reason: string) {
    const operationRevision = invalidationRevision.value
    actionError.value = undefined
    try {
      await revokeMutation.mutateAsync({ grantId, reason })
    } catch (error) {
      const current = operationRevision === invalidationRevision.value
      if (reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)) {
        if (current) actionError.value = error
      }
      throw error
    }
    if (operationRevision !== invalidationRevision.value) return false
    await refreshRoles()
    return true
  }

  function resetAuthorityState() {
    invalidationRevision.value += 1
    actionError.value = undefined
    grantMutation.reset()
    revokeMutation.reset()
  }

  return {
    authorityContext,
    deploymentConfigured,
    errorMessage,
    grantRole,
    initialize,
    invalidationRevision: readonly(invalidationRevision),
    loading,
    mutationPending,
    revokeRole,
    roleGrants,
  }
}
