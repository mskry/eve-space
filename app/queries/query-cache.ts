import type { QueryCache, UseQueryOptions } from '@pinia/colada'
import {
  canRunPlatformProtectedQuery,
  clearAuthenticatedQueries,
  prefetchQuery,
  removePlatformQueryScope,
} from '@eve-space/platform-module-nuxt/runtime'
import { PRIVATE_QUERY_KEYS } from './query-keys'

export { clearAuthenticatedQueries, prefetchQuery }

export function canRunProtectedQuery(
  isClient: boolean,
  authenticated: boolean,
  characterId?: number,
) {
  if (characterId === undefined) return false
  return canRunPlatformProtectedQuery({
    authenticated,
    isClient,
    moduleEnabled: true,
    ownsCharacter: true,
    subject: { kind: 'character', characterId },
  })
}

export function removeCharacterQueries(queryCache: QueryCache, characterId: number) {
  removePlatformQueryScope(queryCache, PRIVATE_QUERY_KEYS.character(characterId))
}

export function prefetchProtectedQuery<
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
>(
  queryCache: QueryCache,
  options: UseQueryOptions<TData, TError, TDataInitial>,
  isClient: boolean,
  authenticated: boolean,
  characterId?: number,
) {
  if (!canRunProtectedQuery(isClient, authenticated, characterId)) return Promise.resolve()
  return prefetchQuery(queryCache, options)
}
