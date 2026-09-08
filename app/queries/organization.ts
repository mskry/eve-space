import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type OrganizationClient = ApiClient['api']['organization']

export type OrganizationContext = InferResponseType<OrganizationClient['context']['$get'], 200>
export type OrganizationCompliance = InferResponseType<
  OrganizationClient['compliance']['$get'],
  200
>
export type OrganizationActivities = InferResponseType<
  OrganizationClient['activities']['$get'],
  200
>
export type OrganizationExceptions = InferResponseType<
  OrganizationClient['exceptions']['$get'],
  200
>
export type OrganizationAudit = InferResponseType<OrganizationClient['audit']['$get'], 200>
export type OrganizationRoles = InferResponseType<OrganizationClient['roles']['$get'], 200>
export type OrganizationRosterCoverage = InferResponseType<
  OrganizationClient['roster-coverage']['$get'],
  200
>
export type DelegatedOrganizationRole = OrganizationRoles['grants'][number]['role']

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

export const organizationComplianceQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationCompliance(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.compliance.$get(undefined, {
      init: { signal },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization compliance is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationCompliance,
  meta: { globalErrorMessage: 'Organization compliance is unavailable.' },
}))

export const organizationActivitiesQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationActivities(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.activities.$get(undefined, {
      init: { signal },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization activities are unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationActivities,
  meta: { globalErrorMessage: 'Organization activities are unavailable.' },
}))

export const organizationExceptionsQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationExceptions(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.exceptions.$get(undefined, {
      init: { signal },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Character exceptions are unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationExceptions,
  meta: { globalErrorMessage: 'Character exceptions are unavailable.' },
}))

const defineOrganizationAuditQuery = defineQueryOptions(
  ({
    apiClient,
    beforeAuditSequence,
  }: {
    apiClient: ApiClient
    beforeAuditSequence: string | null
  }) => ({
    key: PRIVATE_QUERY_KEYS.organizationAudit(beforeAuditSequence),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization.audit.$get(
        {
          query: {
            limit: '50',
            ...(beforeAuditSequence ? { beforeAuditSequence } : {}),
          },
        },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Organization audit history is unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.organizationAudit,
    meta: { globalErrorMessage: 'Organization audit history is unavailable.' },
  }),
)

export function organizationAuditQuery(
  apiClient: ApiClient,
  beforeAuditSequence: string | null = null,
) {
  return defineOrganizationAuditQuery({ apiClient, beforeAuditSequence })
}

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
