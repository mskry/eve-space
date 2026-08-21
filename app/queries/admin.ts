import { defineQueryOptions } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { ADMIN_QUERY_KEYS } from './query-keys'

export const adminSetupQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: ADMIN_QUERY_KEYS.setup,
  query: async ({ signal }) => {
    const response = await apiClient.api.admin.setup.$get({}, { init: { signal } })
    if (!response.ok) throw await toApiQueryError(response, 'Setup status is unavailable.')
    return response.json()
  },
  staleTime: 30_000,
}))

export const adminSessionQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: ADMIN_QUERY_KEYS.session,
  query: async ({ signal }) => {
    const response = await apiClient.api.admin.session.$get({}, { init: { signal } })
    if (!response.ok) throw await toApiQueryError(response, 'Administrator session is unavailable.')
    return response.json()
  },
  staleTime: 30_000,
}))
