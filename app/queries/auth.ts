import { defineEsiQueryOptions } from '@eve-space/platform-module-nuxt/runtime'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { toApiQueryError } from '../utils/query-error'
import { API_BOOTSTRAP_TIMEOUT_MS, createRequestSignal } from '../utils/request-signal'
import { AUTH_QUERY_KEYS, PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

export type AuthConfig = InferResponseType<ApiClient['auth']['config']['$get'], 200>
export type AuthSessionResponse = InferResponseType<ApiClient['auth']['session']['$get'], 200>
export type AuthSession =
  | Pick<Extract<AuthSessionResponse, { authenticated: true }>, 'authenticated' | 'account'>
  | Extract<AuthSessionResponse, { authenticated: false }>
export type CacheAdmissionContext = InferResponseType<
  ApiClient['api']['me']['cache-admission']['$get'],
  200
>

export interface CacheAdmissionBootstrap {
  readonly context: CacheAdmissionContext | null
  readonly requestedAt: number
}

export const unauthenticatedSession: AuthSession = { authenticated: false }
export const unavailableAuthConfig: AuthConfig = {
  attachUrl: '',
  configured: false,
  loginUrl: '',
}

export const authConfigQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
  key: AUTH_QUERY_KEYS.config(),
  query: async ({ signal }) => {
    const response = await apiClient.auth.config.$get(undefined, {
      init: { signal: createRequestSignal(API_BOOTSTRAP_TIMEOUT_MS, signal) },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'EVE SSO configuration is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.authConfig,
  esiPersistence: { kind: 'none' },
  ssrCatchError: true,
}))

export const authSessionQuery = defineEsiQueryOptions((apiClient: ApiClient) => ({
  key: PRIVATE_QUERY_KEYS.session(),
  query: async ({ signal }) => {
    const response = await apiClient.auth.session.$get(
      { query: {} },
      {
        init: { signal: createRequestSignal(API_BOOTSTRAP_TIMEOUT_MS, signal) },
      },
    )
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'EVE session is unavailable.')
    }
    return response.json()
  },
  ...QUERY_POLICY.authSession,
  esiPersistence: { kind: 'none' },
  meta: { globalErrorMessage: 'Session verification is unavailable.' },
}))

export async function loadAuthBootstrap(apiClient: ApiClient, signal?: AbortSignal) {
  const requestedAt = Date.now()
  const response = await apiClient.auth.session.$get(
    { query: { includeAdmission: 'true' } },
    { init: { signal: createRequestSignal(API_BOOTSTRAP_TIMEOUT_MS, signal) } },
  )
  if (response.status !== 200) {
    throw await toApiQueryError(response, 'EVE session is unavailable.')
  }
  return readAuthBootstrap(await response.json(), requestedAt)
}

function readAuthBootstrap(response: AuthSessionResponse, requestedAt: number) {
  const session: AuthSession = response.authenticated
    ? { account: response.account, authenticated: true }
    : unauthenticatedSession
  const admission: CacheAdmissionBootstrap | undefined =
    response.authenticated && response.cacheAdmission !== undefined
      ? { context: response.cacheAdmission, requestedAt }
      : undefined
  return { admission, session }
}

export async function loadCacheAdmission(apiClient: ApiClient, signal?: AbortSignal) {
  const response = await apiClient.api.me['cache-admission'].$get(undefined, {
    init: { signal: createRequestSignal(API_BOOTSTRAP_TIMEOUT_MS, signal) },
  })
  if (response.status !== 200) {
    throw await toApiQueryError(response, 'Private cache admission is unavailable.')
  }
  return response.json()
}
