import { defineQueryOptions } from '@pinia/colada'
import type { InferRequestType, InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { ApiQueryError, toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type MailClient = ApiClient['api']['me']['characters'][':characterId']['mail']

export type MailHeaders = InferResponseType<MailClient['$get'], 200>
export type MailDetail = InferResponseType<MailClient[':mailId']['$get'], 200>
export type MailLabels = InferResponseType<MailClient['labels']['$get'], 200>
type MailingLists = InferResponseType<MailClient['lists']['$get'], 200>
type MailRecipientResolution = InferResponseType<MailClient['recipients']['resolve']['$post'], 200>
type MailRecipientSearch = InferResponseType<MailClient['recipients']['search']['$get'], 200>
type MailCspaCharge = InferResponseType<MailClient['cspa']['$post'], 200>
type SendMailBody = InferRequestType<MailClient['$post']>['json']
export type MailHeader = MailHeaders['messages'][number]
export type MailParty = NonNullable<MailHeader['sender']>
export type MailLabel = MailLabels['labels'][number]
export type MailingList = MailingLists['mailingLists'][number]
type MailRecipientType = SendMailBody['recipients'][number]['type']
export interface MailRecipient {
  id: number
  name: string | null
  type: MailRecipientType
}

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

interface ResolveMailRecipientsQueryParameters extends MailQueryParameters {
  names: readonly string[]
}

interface SearchMailRecipientsQueryParameters extends MailQueryParameters {
  query: string
}

export interface MailReadMutationParameters extends MailDetailQueryParameters {
  read: boolean
}

export type MailDeleteMutationParameters = MailDetailQueryParameters

export interface SendMailMutationParameters extends MailQueryParameters, SendMailBody {}

export interface CalculateMailCspaMutationParameters extends MailQueryParameters {
  recipientIds: readonly number[]
}

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

export const resolveMailRecipientsQuery = defineQueryOptions(
  ({ apiClient, characterId, names }: ResolveMailRecipientsQueryParameters) => {
    const normalizedNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    const cacheName = normalizedNames.map((name) => name.toLocaleLowerCase()).join('\u0000')
    return {
      key: PRIVATE_QUERY_KEYS.mailRecipientResolution(characterId, cacheName),
      query: async ({ signal }) => {
        const response = await apiClient.api.me.characters[
          ':characterId'
        ].mail.recipients.resolve.$post(
          {
            param: { characterId: String(characterId) },
            json: { names: normalizedNames },
          },
          { init: { signal } },
        )
        if (response.status !== 200) {
          throw await toApiQueryError(response, 'Mail recipients could not be resolved.')
        }
        const result: MailRecipientResolution = await response.json()
        return result
      },
      ...QUERY_POLICY.mailRecipientResolution,
    }
  },
)

export const searchMailRecipientsQuery = defineQueryOptions(
  ({ apiClient, characterId, query }: SearchMailRecipientsQueryParameters) => {
    const normalizedQuery = query.trim()
    return {
      key: PRIVATE_QUERY_KEYS.mailRecipientSearch(characterId, normalizedQuery.toLocaleLowerCase()),
      query: async ({ signal }) => {
        const response = await apiClient.api.me.characters[
          ':characterId'
        ].mail.recipients.search.$get(
          {
            param: { characterId: String(characterId) },
            query: { search: normalizedQuery },
          },
          { init: { signal } },
        )
        if (response.status !== 200) {
          throw await toApiQueryError(response, 'Mail recipients could not be searched.')
        }
        const result: MailRecipientSearch = await response.json()
        if (result.characterId !== characterId) throw mailIdentityMismatch()
        return result
      },
      ...QUERY_POLICY.mailRecipientSearch,
    }
  },
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

export async function sendMailMutation({
  apiClient,
  characterId,
  recipients,
  subject,
  body,
  approvedCost,
}: SendMailMutationParameters) {
  const response = await apiClient.api.me.characters[':characterId'].mail.$post({
    param: { characterId: String(characterId) },
    json: { approvedCost, body, recipients, subject },
  })
  if (response.status !== 201) {
    throw await toApiQueryError(response, 'Mail could not be sent.')
  }
  const result = await response.json()
  if (result.characterId !== characterId) throw mailIdentityMismatch()
  return result.mailId
}

export async function calculateMailCspaMutation({
  apiClient,
  characterId,
  recipientIds,
}: CalculateMailCspaMutationParameters) {
  const response = await apiClient.api.me.characters[':characterId'].mail.cspa.$post({
    param: { characterId: String(characterId) },
    json: { characterIds: [...new Set(recipientIds)] },
  })
  if (response.status !== 200) {
    throw await toApiQueryError(response, 'The recipient charge could not be determined.')
  }
  const result: MailCspaCharge = await response.json()
  if (result.characterId !== characterId) throw mailIdentityMismatch()
  return result.cost
}
