import type { EntryKey, QueryCache, UseQueryOptions } from '@pinia/colada'
import { prefetchQuery, removePlatformQueryScope } from '@eve-space/platform-module-nuxt/runtime'
import {
  canRunProtectedCharacterQuery,
  type ProtectedCharacterQueryAccess,
} from './protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { canPrefetchPrivateQuery, refreshPrivateQueryAdmission } from '../query-persistence/runtime'

export {
  clearAuthenticatedQueries,
  clearAuthenticatedQueriesAfterSessionTransition,
} from '@eve-space/platform-module-nuxt/runtime'
export { prefetchQuery }

export function removeCharacterQueries(queryCache: QueryCache, characterId: number) {
  removePlatformQueryScope(queryCache, PRIVATE_QUERY_KEYS.character(characterId))
  void refreshPrivateAuthorization(queryCache, { characterId, kind: 'character' })
}

export async function refreshPrivateAuthorization(
  queryCache: QueryCache,
  scope: Parameters<typeof refreshPrivateQueryAdmission>[1],
) {
  await refreshPrivateQueryAdmission(queryCache, scope)
  let keys: EntryKey[]
  if (scope.kind === 'all') {
    keys = [PRIVATE_QUERY_KEYS.root]
  } else if (scope.kind === 'organization') {
    keys = [PRIVATE_QUERY_KEYS.organization()]
  } else {
    keys = [PRIVATE_QUERY_KEYS.characters(), PRIVATE_QUERY_KEYS.organization()]
  }
  await Promise.allSettled(keys.map((key) => queryCache.invalidateQueries({ key })))
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
  if (
    characterId === undefined ||
    !canRunProtectedCharacterQuery(access, characterId) ||
    !canPrefetchPrivateQuery(queryCache, options)
  ) {
    return Promise.resolve()
  }
  return prefetchQuery(queryCache, options)
}
