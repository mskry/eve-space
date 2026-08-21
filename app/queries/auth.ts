import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { AUTH_QUERY_KEYS, PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export type AuthConfig = InferResponseType<ApiClient['auth']['config']['$get'], 200>
export type AuthSession = InferResponseType<ApiClient['auth']['session']['$get'], 200>

export const unauthenticatedSession: AuthSession = { authenticated: false }
export const unavailableAuthConfig: AuthConfig = {
  configured: false,
  loginUrl: '',
  attachUrl: '',
}

export const authConfigQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: AUTH_QUERY_KEYS.config(),
  query: async ({ signal }) => {
    const response = await apiClient.auth.config.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'EVE SSO configuration is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.authConfig,
  ssrCatchError: true,
}))

export const authSessionQuery = defineQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.session(),
  query: async ({ signal }) => {
    const response = await apiClient.auth.session.$get(undefined, { init: { signal } })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'EVE session is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.authSession,
  meta: { globalErrorMessage: 'Session verification is unavailable.' },
}))
