import type { QueryCache, UseQueryOptions, UseQueryEntry, EntryKey } from '@pinia/colada'
import { PRIVATE_QUERY_KEYS } from './query-keys'

export function canRunProtectedQuery(
  isClient: boolean,
  authenticated: boolean,
  characterId?: number,
) {
  return isClient && authenticated && characterId !== undefined
}

export function clearAuthenticatedQueries<TSession>(
  queryCache: QueryCache,
  unauthenticatedSession: TSession,
) {
  const filter = { key: PRIVATE_QUERY_KEYS.root }
  const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
  queryCache.cancelQueries(filter, new Error('Authenticated query state cleared.'))

  for (const entry of queryCache.getEntries(filter)) {
    if (entry !== sessionEntry) queryCache.remove(entry)
  }
  queryCache.setQueryData(PRIVATE_QUERY_KEYS.session(), unauthenticatedSession)
}

export function removeCharacterQueries(queryCache: QueryCache, characterId: number) {
  removeQueries(queryCache, PRIVATE_QUERY_KEYS.character(characterId))
}

function removeQueries(queryCache: QueryCache, key: EntryKey) {
  const filter = { key }
  queryCache.cancelQueries(filter, new Error('Authenticated query state cleared.'))
  for (const entry of queryCache.getEntries(filter)) queryCache.remove(entry)
}

export function prefetchQuery<
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
>(queryCache: QueryCache, options: UseQueryOptions<TData, TError, TDataInitial>) {
  const entry = queryCache.ensure(options)
  return queryCache.refresh(entry as UseQueryEntry<TData, TError, TDataInitial>)
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
