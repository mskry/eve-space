import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PUBLIC_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export type PublicTypeDetail = InferResponseType<
  ApiClient['api']['universe']['types'][':typeId']['$get'],
  200
>

interface PublicTypeDetailParameters {
  apiClient: ApiClient
  typeId: number
}

export const publicTypeDetailQuery = defineQueryOptions(
  ({ apiClient, typeId }: PublicTypeDetailParameters) => ({
    key: PUBLIC_QUERY_KEYS.universeType(typeId),
    query: async ({ signal }) => {
      const response = await apiClient.api.universe.types[':typeId'].$get(
        { param: { typeId: String(typeId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Item information is unavailable.')
      }
      return response.json() as Promise<PublicTypeDetail>
    },
    ...QUERY_POLICY.staticTypeDetail,
    ssrCatchError: true,
  }),
)
