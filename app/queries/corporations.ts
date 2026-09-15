import { defineEsiQueryOptions } from '@eve-space/platform-module-nuxt/runtime'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export type CorporationResponse = InferResponseType<
  ApiClient['api']['corporations'][':corporationId']['$get'],
  200
>
type AllianceHistoryResponse = InferResponseType<
  ApiClient['api']['corporations'][':corporationId']['alliance-history']['$get'],
  200
>
interface CorporationParameters {
  apiClient: ApiClient
  corporationId: number
}

export const corporationQuery = defineEsiQueryOptions(
  ({ apiClient, corporationId }: CorporationParameters) => ({
    key: PRIVATE_QUERY_KEYS.corporationRecord(corporationId),
    query: async ({ signal }) => {
      const response = await apiClient.api.corporations[':corporationId'].$get(
        { param: { corporationId: String(corporationId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Corporation is unavailable.')
      }
      return response.json() as Promise<CorporationResponse>
    },
    ...QUERY_POLICY.corporation,
    esiPersistence: { kind: 'none' },
  }),
)

export const corporationAllianceHistoryQuery = defineEsiQueryOptions(
  ({ apiClient, corporationId }: CorporationParameters) => ({
    key: PRIVATE_QUERY_KEYS.corporationAllianceHistory(corporationId),
    query: async ({ signal }) => {
      const response = await apiClient.api.corporations[':corporationId']['alliance-history'].$get(
        { param: { corporationId: String(corporationId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Alliance history is unavailable.')
      }
      return response.json() as Promise<AllianceHistoryResponse>
    },
    ...QUERY_POLICY.corporationAllianceHistory,
    esiPersistence: { kind: 'none' },
  }),
)
