import { defineEsiQueryOptions } from '@eve-space/platform-module-nuxt/runtime'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { API_BOOTSTRAP_TIMEOUT_MS, createRequestSignal } from '../utils/request-signal'
import { PUBLIC_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export const systemStatusQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
  key: PUBLIC_QUERY_KEYS.systemStatus(),
  query: async ({ signal }) => {
    const startedAt = performance.now()
    const response = await apiClient.api.status.$get(undefined, {
      init: { signal: createRequestSignal(API_BOOTSTRAP_TIMEOUT_MS, signal) },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'System telemetry is unavailable.')
    }
    return {
      telemetry: await response.json(),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  },
  ...QUERY_POLICY.systemStatus,
  autoRefetch: true,
  esiPersistence: { kind: 'none' },
  ssrCatchError: true,
}))
