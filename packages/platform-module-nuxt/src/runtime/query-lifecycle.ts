import type { EntryKey, QueryCache, UseQueryEntry, UseQueryOptions } from '@pinia/colada'
import {
  isPlatformModuleQueryKey,
  isPlatformModuleSectionQueryKey,
  isPlatformQuerySubjectValid,
  PLATFORM_PRIVATE_QUERY_ROOT,
  platformModuleQueryKey,
  platformReviewerContributionTargetQueryKey,
  type PlatformQuerySubject,
  type PlatformReviewerContributionTargetIdentity,
} from './query-keys.js'

export interface PlatformProtectedQueryAccess {
  readonly authenticated: boolean
  readonly authorized?: boolean
  readonly isClient: boolean
  readonly moduleEnabled: boolean
  readonly sectionId?: string
  readonly ownsCharacter?: boolean
  readonly subject: PlatformQuerySubject
}

export function canRunPlatformProtectedQuery(access: PlatformProtectedQueryAccess) {
  if (
    !access.isClient ||
    !access.authenticated ||
    !access.moduleEnabled ||
    !isPlatformQuerySubjectValid(access.subject)
  ) {
    return false
  }
  if (
    (access.subject.kind === 'organization' ||
      access.subject.kind === 'corporation' ||
      access.subject.kind === 'alliance') &&
    access.authorized !== true
  ) {
    return false
  }
  return access.subject.kind !== 'character' || access.ownsCharacter === true
}

export function clearAuthenticatedQueries<TSession>(
  queryCache: QueryCache,
  unauthenticatedSession: TSession,
  sessionKey: EntryKey = [...PLATFORM_PRIVATE_QUERY_ROOT, 'session'],
) {
  clearAuthenticatedQueryEntries(queryCache, unauthenticatedSession, sessionKey, true)
}

export function clearAuthenticatedQueriesAfterSessionTransition<TSession>(
  queryCache: QueryCache,
  settledSession: TSession,
  sessionKey: EntryKey = [...PLATFORM_PRIVATE_QUERY_ROOT, 'session'],
) {
  clearAuthenticatedQueryEntries(queryCache, settledSession, sessionKey, false)
}

function clearAuthenticatedQueryEntries<TSession>(
  queryCache: QueryCache,
  sessionValue: TSession,
  sessionKey: EntryKey,
  cancelSession: boolean,
) {
  const filter = { key: PLATFORM_PRIVATE_QUERY_ROOT }
  const sessionEntry = queryCache.get(sessionKey)
  if (cancelSession) {
    queryCache.cancelQueries(filter, new Error('Authenticated query state cleared.'))
  }

  for (const entry of queryCache.getEntries(filter)) {
    if (entry === sessionEntry) {
      continue
    }
    if (!cancelSession) {
      queryCache.cancelQueries(
        { exact: true, key: entry.key },
        new Error('Authenticated query state cleared.'),
      )
    }
    queryCache.remove(entry)
  }
  queryCache.setQueryData(sessionKey, sessionValue)
}

export function removePlatformModuleQueries(queryCache: QueryCache, moduleId: string) {
  for (const entry of queryCache.getEntries({ key: PLATFORM_PRIVATE_QUERY_ROOT })) {
    if (isPlatformModuleQueryKey(entry.key, moduleId)) {
      removeQueryEntry(queryCache, entry)
    }
  }
}

export function removePlatformModuleSectionQueries(
  queryCache: QueryCache,
  moduleId: string,
  sectionId: string,
) {
  for (const entry of queryCache.getEntries({ key: PLATFORM_PRIVATE_QUERY_ROOT })) {
    if (isPlatformModuleSectionQueryKey(entry.key, moduleId, sectionId)) {
      removeQueryEntry(queryCache, entry)
    }
  }
}

export function removePlatformQueryScope(queryCache: QueryCache, key: EntryKey) {
  const filter = { key }
  queryCache.cancelQueries(filter, new Error('Protected query state cleared.'))
  for (const entry of queryCache.getEntries(filter)) {
    queryCache.remove(entry)
  }
}

export function removePlatformQuery(queryCache: QueryCache, key: EntryKey) {
  const filter = { exact: true, key }
  queryCache.cancelQueries(filter, new Error('Protected query state cleared.'))
  for (const entry of queryCache.getEntries(filter)) {
    queryCache.remove(entry)
  }
}

export function removePlatformReviewerContributionTargetQueries(
  queryCache: QueryCache,
  identity: PlatformReviewerContributionTargetIdentity,
) {
  removePlatformQueryScope(queryCache, platformReviewerContributionTargetQueryKey(identity))
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
  if (!canRunPlatformProtectedQuery(access)) {
    return Promise.resolve()
  }
  return prefetchQuery(queryCache, {
    ...options,
    key: platformModuleQueryKey(moduleId, access.subject, resource, access.sectionId),
  })
}

function removeQueryEntry(queryCache: QueryCache, entry: UseQueryEntry) {
  queryCache.cancel(entry, new Error('Protected query state cleared.'))
  queryCache.remove(entry)
}
