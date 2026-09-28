import type { PlatformReviewerCharacterDirectoryInput } from '@eve-space/platform-module-contract/reviewer-directory'
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
  OrganizationReviewClient['characters']['$get'],
  200
>
export type OrganizationReviewDirectoryCharacter = OrganizationReviewDirectory['items'][number]
export type OrganizationReviewDirectoryGroupFacet =
  OrganizationReviewDirectory['groupFacets'][number]
type OrganizationReviewAccountTarget = InferResponseType<
  OrganizationReviewClient['members'][':userId']['$get'],
  200
>
type OrganizationReviewCharacterTarget = InferResponseType<
  OrganizationReviewClient['members'][':userId']['characters'][':characterId']['$get'],
  200
>
export type OrganizationReviewTargetMember =
  | OrganizationReviewAccountTarget['member']
  | OrganizationReviewCharacterTarget['member']

export interface OrganizationReviewDirectoryInput extends PlatformReviewerCharacterDirectoryInput {
  readonly organizationVersion: number
  readonly limit: number
}

export interface OrganizationReviewTargetInput {
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly targetCharacterId?: number
  readonly managedMemberLifecycleId?: string
}

export interface OrganizationReviewTargetResult extends OrganizationReviewTargetInput {
  readonly member: OrganizationReviewTargetMember | null
}

export const organizationReviewEntryQuery = defineEsiQueryOptions(
  ({ apiClient, authenticated }: { apiClient: ApiClient; authenticated: boolean }) => ({
    key: PRIVATE_QUERY_KEYS.organizationReviewerEntry(),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization.review.$get(undefined, { init: { signal } })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Organization review workspace is unavailable.')
      }
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
    key: PRIVATE_QUERY_KEYS.organizationReviewerDirectory(input.organizationVersion, input),
    query: async ({ signal }) => {
      const response = await apiClient.api.organization.review.characters.$get(
        {
          query: {
            ...(input.query && { query: input.query }),
            ...(input.corporationId && { corporationId: String(input.corporationId) }),
            ...(input.groupId && { groupId: input.groupId }),
            ...(input.complianceState && { complianceState: input.complianceState }),
            ...(input.blocked !== undefined && {
              blocked: input.blocked ? ('true' as const) : ('false' as const),
            }),
            ...(input.auditState && { auditState: input.auditState }),
            ...(input.sort && { sort: input.sort }),
            ...(input.direction && { direction: input.direction }),
            ...(input.cursor && { cursor: input.cursor }),
            limit: String(input.limit),
          },
        },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Managed character directory is unavailable.')
      }
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
    meta: { globalErrorMessage: 'Managed character directory is unavailable.' },
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
      input.managedMemberLifecycleId,
    ),
    query: async ({ signal }) => {
      if (input.targetCharacterId !== undefined) {
        const response = await apiClient.api.organization.review.members[':userId'].characters[
          ':characterId'
        ].$get(
          { param: { userId: input.targetUserId, characterId: String(input.targetCharacterId) } },
          { init: { signal } },
        )
        if (response.status !== 200) {
          throw await toApiQueryError(response, 'Managed character target is unavailable.')
        }
        const target = await response.json()
        const candidate = target.member
        const member =
          target.organizationVersion === input.organizationVersion &&
          candidate.account.userId === input.targetUserId &&
          candidate.character.characterId === input.targetCharacterId &&
          (input.managedMemberLifecycleId === undefined ||
            candidate.managedMemberLifecycleId === input.managedMemberLifecycleId)
            ? candidate
            : null
        return { ...input, member } satisfies OrganizationReviewTargetResult
      }
      const response = await apiClient.api.organization.review.members[':userId'].$get(
        { param: { userId: input.targetUserId } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Managed member target is unavailable.')
      }
      const target = await response.json()
      const candidate = target.member
      const member =
        target.organizationVersion === input.organizationVersion &&
        candidate.account.userId === input.targetUserId &&
        (input.managedMemberLifecycleId === undefined ||
          candidate.managedMemberLifecycleId === input.managedMemberLifecycleId)
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
