import type { QueryCache, UseQueryOptions } from '@pinia/colada'
import { prefetchQuery, removePlatformQueryScope } from '@eve-space/platform-module-nuxt/runtime'
import {
  canRunProtectedCharacterQuery,
  type ProtectedCharacterQueryAccess,
} from './protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from './query-keys'

export { clearAuthenticatedQueries } from '@eve-space/platform-module-nuxt/runtime'
export { clearAuthenticatedQueriesAfterSessionTransition } from '@eve-space/platform-module-nuxt/runtime'
export { prefetchQuery }

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
  access: ProtectedCharacterQueryAccess,
  characterId?: number,
) {
  if (characterId === undefined || !canRunProtectedCharacterQuery(access, characterId)) {
    return Promise.resolve()
  }
  return prefetchQuery(queryCache, options)
}
