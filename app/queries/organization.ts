import { coreOrganizationAdmissionScopes } from '@eve-space/platform-module-contract/server'
import {
  defineEsiQueryOptions,
  organizationEsiPersistence,
} from '@eve-space/platform-module-nuxt/runtime'
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
export type OrganizationPermissionCatalog = InferResponseType<
  OrganizationClient['permission-catalog']['$get'],
  200
>
export type OrganizationPermissionBundles = InferResponseType<
  OrganizationClient['permission-bundles']['$get'],
  200
>
export type OrganizationRosterCoverage = InferResponseType<
  OrganizationClient['roster-coverage']['$get'],
  200
>
export type DelegatedOrganizationRole = OrganizationRoles['grants'][number]['role']

export interface OrganizationOwnerQueryAccess {
  authenticated: boolean
  blocked: boolean
  isOrganizationOwner: boolean
  memberAccess: boolean
}

interface OrganizationOwnerQueryParameters {
  apiClient: ApiClient
  organizationVersion: number
  access: OrganizationOwnerQueryAccess
}

export function canRunOrganizationOwnerQuery(
  access: OrganizationOwnerQueryAccess,
  organizationVersion: number,
) {
  return (
    organizationVersion > 0 &&
    access.authenticated &&
    access.isOrganizationOwner &&
    access.memberAccess &&
    !access.blocked
  )
}

export const organizationContextQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationContext(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.context.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization authority is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationContext,
  esiPersistence: { kind: 'none' },
  meta: { globalErrorMessage: 'Organization authority is unavailable.' },
}))

export const organizationComplianceQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
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
  esiPersistence: { kind: 'none' },
  meta: { globalErrorMessage: 'Organization compliance is unavailable.' },
}))

export const organizationActivitiesQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
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
  esiPersistence: organizationEsiPersistence(coreOrganizationAdmissionScopes.activities),
  meta: { globalErrorMessage: 'Organization activities are unavailable.' },
}))

export const organizationExceptionsQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
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
  esiPersistence: { kind: 'none' },
  meta: { globalErrorMessage: 'Character exceptions are unavailable.' },
}))

const defineOrganizationAuditQuery = defineEsiQueryOptions(
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
    esiPersistence: { kind: 'none' },
    meta: { globalErrorMessage: 'Organization audit history is unavailable.' },
  }),
)

export function organizationAuditQuery(
  apiClient: ApiClient,
  beforeAuditSequence: string | null = null,
) {
  return defineOrganizationAuditQuery({ apiClient, beforeAuditSequence })
}

export const organizationRolesQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.organizationRoles(),
  query: async ({ signal }) => {
    const response = await apiClient.api.organization.roles.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Organization roles are unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.organizationRoles,
  esiPersistence: { kind: 'none' },
  meta: { globalErrorMessage: 'Organization roles are unavailable.' },
}))

export const organizationPermissionCatalogQuery = defineEsiQueryOptions(
  ({ apiClient, organizationVersion, access }: OrganizationOwnerQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.organizationPermissionCatalog(organizationVersion),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization['permission-catalog'].$get(undefined, {
        init: { signal },
      })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Organization permission catalog is unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.organizationPermissionCatalog,
    esiPersistence: { kind: 'none' },
    enabled: import.meta.client && canRunOrganizationOwnerQuery(access, organizationVersion),
    meta: { globalErrorMessage: 'Organization permission catalog is unavailable.' },
  }),
)

export const organizationPermissionBundlesQuery = defineEsiQueryOptions(
  ({ apiClient, organizationVersion, access }: OrganizationOwnerQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.organizationPermissionBundles(organizationVersion),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization['permission-bundles'].$get(undefined, {
        init: { signal },
      })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Organization permission bundles are unavailable.')
      }
      return response.json()
    },
    ...QUERY_POLICY.organizationPermissionBundles,
    esiPersistence: { kind: 'none' },
    enabled: import.meta.client && canRunOrganizationOwnerQuery(access, organizationVersion),
    meta: { globalErrorMessage: 'Organization permission bundles are unavailable.' },
  }),
)

export const organizationRosterCoverageQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
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
  esiPersistence: organizationEsiPersistence(coreOrganizationAdmissionScopes.rosterCoverage),
  meta: { globalErrorMessage: 'Organization roster coverage is unavailable.' },
}))
