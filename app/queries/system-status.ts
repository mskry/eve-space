import { defineQueryOptions } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { PUBLIC_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export const systemStatusQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PUBLIC_QUERY_KEYS.systemStatus(),
  query: async ({ signal }) => {
    const startedAt = performance.now()
    const response = await apiClient.api.status.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'System telemetry is unavailable.')
    }
    return {
      telemetry: await response.json(),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  },
  ...QUERY_POLICY.systemStatus,
  ssrCatchError: true,
}))
