import { defineQueryOptions } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export type DelegatedOrganizationRole = 'hr_auditor' | 'director'

export const organizationContextQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationContext(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.context.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization authority is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationContext,
  meta: { globalErrorMessage: 'Organization authority is unavailable.' },
}))

export const organizationRolesQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationRoles(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.roles.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization roles are unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationRoles,
  meta: { globalErrorMessage: 'Organization roles are unavailable.' },
}))

export const organizationRosterCoverageQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationRosterCoverage(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization['roster-coverage'].$get(undefined, {
      init: { signal },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization roster coverage is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationRosterCoverage,
  meta: { globalErrorMessage: 'Organization roster coverage is unavailable.' },
}))
