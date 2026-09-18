import { defineEsiQueryOptions } from '@eve-space/platform-module-nuxt/runtime'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type OrganizationReviewClient = ApiClient['api']['organization']['review']

type OrganizationReviewEntry = InferResponseType<OrganizationReviewClient['$get'], 200>
export type OrganizationReviewContribution = OrganizationReviewEntry['contributions'][number]
type OrganizationReviewDirectory = InferResponseType<
  OrganizationReviewClient['members']['$get'],
  200
>
export type OrganizationReviewDirectoryMember = OrganizationReviewDirectory['items'][number]

export interface OrganizationReviewDirectoryInput {
  readonly organizationVersion: number
  readonly query?: string
  readonly corporationId?: number
  readonly cursor?: string
  readonly limit: number
}

export interface OrganizationReviewTargetInput {
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly targetCharacterId?: number
}

export interface OrganizationReviewTargetResult extends OrganizationReviewTargetInput {
  readonly member: OrganizationReviewDirectoryMember | null
}

export const organizationReviewEntryQuery = defineEsiQueryOptions(
  ({ apiClient, authenticated }: { apiClient: ApiClient; authenticated: boolean }) => ({
    key: PRIVATE_QUERY_KEYS.organizationReviewerEntry(),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization.review.$get(undefined, { init: { signal } })
      if (response.status !== 200)
        throw await toApiQueryError(response, 'Organization review workspace is unavailable.')
      return response.json()
    },
    enabled: import.meta.client && authenticated,
    retry: 0,
    ...QUERY_POLICY.organizationReviewerEntry,
    esiPersistence: { kind: 'none' },
    meta: { globalErrorMessage: 'Organization review workspace is unavailable.' },
  }),
)

export const organizationReviewDirectoryQuery = defineEsiQueryOptions(
  ({
    apiClient,
    enabled,
    input,
  }: {
    apiClient: ApiClient
    enabled: boolean
    input: OrganizationReviewDirectoryInput
  }) => ({
    key: PRIVATE_QUERY_KEYS.organizationReviewerDirectory(
      input.organizationVersion,
      input.query,
      input.corporationId,
      input.cursor,
      input.limit,
    ),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization.review.members.$get(
        {
          query: {
            ...(input.query ? { query: input.query } : {}),
            ...(input.corporationId ? { corporationId: String(input.corporationId) } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            limit: String(input.limit),
          },
        },
        { init: { signal } },
      )
      if (response.status !== 200)
        throw await toApiQueryError(response, 'Managed member directory is unavailable.')
      return response.json()
    },
    enabled:
      import.meta.client &&
      enabled &&
      Number.isSafeInteger(input.organizationVersion) &&
      input.organizationVersion > 0,
    retry: 0,
    ...QUERY_POLICY.organizationReviewerDirectory,
    esiPersistence: { kind: 'none' },
    meta: { globalErrorMessage: 'Managed member directory is unavailable.' },
  }),
)

export const organizationReviewTargetQuery = defineEsiQueryOptions(
  ({
    apiClient,
    enabled,
    input,
  }: {
    apiClient: ApiClient
    enabled: boolean
    input: OrganizationReviewTargetInput
  }) => ({
    key: PRIVATE_QUERY_KEYS.organizationReviewerTarget(
      input.organizationVersion,
      input.targetUserId,
      input.targetCharacterId,
    ),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization.review.members.$get(
        {
          query: {
            query: String(input.targetCharacterId ?? input.targetUserId),
            limit: '1',
          },
        },
        { init: { signal } },
      )
      if (response.status !== 200)
        throw await toApiQueryError(response, 'Managed member target is unavailable.')
      const directory = await response.json()
      const candidate = directory.items[0]
      const member =
        directory.organizationVersion === input.organizationVersion &&
        candidate?.account.userId === input.targetUserId &&
        (input.targetCharacterId === undefined ||
          candidate.managedAffiliation.characterId === input.targetCharacterId)
          ? candidate
          : null
      return { ...input, member } satisfies OrganizationReviewTargetResult
    },
    enabled:
      import.meta.client &&
      enabled &&
      Number.isSafeInteger(input.organizationVersion) &&
      input.organizationVersion > 0 &&
      input.targetUserId.length > 0,
    retry: 0,
    ...QUERY_POLICY.organizationReviewerTarget,
    esiPersistence: { kind: 'none' },
    meta: { globalErrorMessage: 'Managed member target is unavailable.' },
  }),
)
