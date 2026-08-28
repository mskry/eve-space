import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { ApiQueryError, toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type MailClient = ApiClient['api']['me']['characters'][':characterId']['mail']

export type MailHeaders = InferResponseType<MailClient['$get'], 200>
export type MailDetail = InferResponseType<MailClient[':mailId']['$get'], 200>
export type MailLabels = InferResponseType<MailClient['labels']['$get'], 200>
type MailingLists = InferResponseType<MailClient['lists']['$get'], 200>
export type MailHeader = MailHeaders['messages'][number]
export type MailParty = NonNullable<MailHeader['sender']>
export type MailLabel = MailLabels['labels'][number]
export type MailingList = MailingLists['mailingLists'][number]

interface MailQueryParameters {
  apiClient: ApiClient
  characterId: number
}

interface MailHeadersQueryParameters extends MailQueryParameters {
  labels?: readonly number[]
  lastMailId?: number | null
}

interface MailDetailQueryParameters extends MailQueryParameters {
  mailId: number
}

export interface MailReadMutationParameters extends MailDetailQueryParameters {
  read: boolean
}

export type MailDeleteMutationParameters = MailDetailQueryParameters

const mailIdentityMismatch = () =>
  new ApiQueryError('Mail response did not match the requested identity.', {
    status: 409,
    code: 'MAIL_IDENTITY_MISMATCH',
  })

export const mailHeadersQuery = defineQueryOptions(
  ({ apiClient, characterId, labels = [], lastMailId = null }: MailHeadersQueryParameters) => {
    const normalizedLabels = [...new Set(labels)].toSorted((left, right) => left - right)
    return {
      key: PRIVATE_QUERY_KEYS.mailHeaders(characterId, normalizedLabels, lastMailId),
      query: async ({ signal }) => {
        const response = await apiClient.api.me.characters[':characterId'].mail.$get(
          {
            param: { characterId: String(characterId) },
            query: {
              ...(normalizedLabels.length > 0 ? { labels: normalizedLabels.map(String) } : {}),
              ...(lastMailId === null ? {} : { lastMailId: String(lastMailId) }),
            },
          },
          { init: { signal } },
        )
        if (response.status !== 200) {
          throw await toApiQueryError(response, 'Mail headers are unavailable.')
        }
        const mail: MailHeaders = await response.json()
        if (mail.characterId !== characterId) throw mailIdentityMismatch()
        return mail
      },
      ...QUERY_POLICY.mailHeaders,
    }
  },
)

export const mailDetailQuery = defineQueryOptions(
  ({ apiClient, characterId, mailId }: MailDetailQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.mailDetail(characterId, mailId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].mail[':mailId'].$get(
        { param: { characterId: String(characterId), mailId: String(mailId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Mail detail is unavailable.')
      }
      const mail: MailDetail = await response.json()
      if (mail.characterId !== characterId || mail.mailId !== mailId) {
        throw mailIdentityMismatch()
      }
      return mail
    },
    ...QUERY_POLICY.mailDetail,
  }),
)

export const mailLabelsQuery = defineQueryOptions(
  ({ apiClient, characterId }: MailQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.mailLabels(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].mail.labels.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Mail labels are unavailable.')
      }
      const labels: MailLabels = await response.json()
      if (labels.characterId !== characterId) throw mailIdentityMismatch()
      return labels
    },
    ...QUERY_POLICY.mailLabels,
  }),
)

export const mailingListsQuery = defineQueryOptions(
  ({ apiClient, characterId }: MailQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.mailingLists(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].mail.lists.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Mailing lists are unavailable.')
      }
      const lists: MailingLists = await response.json()
      if (lists.characterId !== characterId) throw mailIdentityMismatch()
      return lists
    },
    ...QUERY_POLICY.mailingLists,
  }),
)

export async function mailReadMutation({
  apiClient,
  characterId,
  mailId,
  read,
}: MailReadMutationParameters) {
  const response = await apiClient.api.me.characters[':characterId'].mail[':mailId'].$put({
    param: { characterId: String(characterId), mailId: String(mailId) },
    json: { read },
  })
  if (response.status !== 204) {
    throw await toApiQueryError(response, 'Mail read state could not be changed.')
  }
}

export async function mailDeleteMutation({
  apiClient,
  characterId,
  mailId,
}: MailDeleteMutationParameters) {
  const response = await apiClient.api.me.characters[':characterId'].mail[':mailId'].$delete({
    param: { characterId: String(characterId), mailId: String(mailId) },
  })
  if (response.status !== 204) {
    throw await toApiQueryError(response, 'Mail could not be deleted.')
  }
}
