import type { EntryKey, QueryCache, UseQueryEntry, UseQueryOptions } from '@pinia/colada'
import type { PlatformQuerySubject } from './query-keys.js'
import {
  isPlatformModuleQueryKey,
  isPlatformQuerySubjectValid,
  PLATFORM_PRIVATE_QUERY_ROOT,
  platformModuleQueryKey,
} from './query-keys.js'

export interface PlatformProtectedQueryAccess {
  readonly authenticated: boolean
  readonly authorized?: boolean
  readonly isClient: boolean
  readonly moduleEnabled: boolean
  readonly ownsCharacter?: boolean
  readonly subject: PlatformQuerySubject
}

export function canRunPlatformProtectedQuery(access: PlatformProtectedQueryAccess) {
  if (
    !access.isClient ||
    !access.authenticated ||
    !access.moduleEnabled ||
    !isPlatformQuerySubjectValid(access.subject)
  )
    return false
  if (
    (access.subject.kind === 'organization' ||
      access.subject.kind === 'corporation' ||
      access.subject.kind === 'alliance') &&
    access.authorized !== true
  )
    return false
  return access.subject.kind !== 'character' || access.ownsCharacter === true
}

export function clearAuthenticatedQueries<TSession>(
  queryCache: QueryCache,
  unauthenticatedSession: TSession,
  sessionKey: EntryKey = [...PLATFORM_PRIVATE_QUERY_ROOT, 'session'],
) {
  const filter = { key: PLATFORM_PRIVATE_QUERY_ROOT }
  const sessionEntry = queryCache.get(sessionKey)
  queryCache.cancelQueries(filter, new Error('Authenticated query state cleared.'))

  for (const entry of queryCache.getEntries(filter)) {
    if (entry !== sessionEntry) queryCache.remove(entry)
  }
  queryCache.setQueryData(sessionKey, unauthenticatedSession)
}

export function removePlatformModuleQueries(queryCache: QueryCache, moduleId: string) {
  for (const entry of queryCache.getEntries({ key: PLATFORM_PRIVATE_QUERY_ROOT })) {
    if (isPlatformModuleQueryKey(entry.key, moduleId)) removeQueryEntry(queryCache, entry)
  }
}

export function removePlatformQueryScope(queryCache: QueryCache, key: EntryKey) {
  const filter = { key }
  queryCache.cancelQueries(filter, new Error('Protected query state cleared.'))
  for (const entry of queryCache.getEntries(filter)) queryCache.remove(entry)
}

export function removePlatformQuery(queryCache: QueryCache, key: EntryKey) {
  const filter = { key, exact: true }
  queryCache.cancelQueries(filter, new Error('Protected query state cleared.'))
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

export function prefetchPlatformProtectedQuery<
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
>(
  queryCache: QueryCache,
  options: Omit<UseQueryOptions<TData, TError, TDataInitial>, 'key'>,
  moduleId: string,
  resource: EntryKey,
  access: PlatformProtectedQueryAccess,
) {
  if (!canRunPlatformProtectedQuery(access)) return Promise.resolve()
  return prefetchQuery(queryCache, {
    ...options,
    key: platformModuleQueryKey(moduleId, access.subject, resource),
  })
}

function removeQueryEntry(queryCache: QueryCache, entry: UseQueryEntry) {
  queryCache.cancel(entry, new Error('Protected query state cleared.'))
  queryCache.remove(entry)
}
