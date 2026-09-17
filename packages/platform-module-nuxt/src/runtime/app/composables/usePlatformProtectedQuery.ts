import {
  useQuery,
  useQueryCache,
  type DefineQueryOptions,
  type EntryKey,
  type QueryMeta,
} from '@pinia/colada'
import { platformQueryAdmissionScopes } from '#build/eve-space-platform/query-admission-scopes'
import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  ESI_QUERY_RETENTION_MS,
  resolvePlatformEsiPersistence,
  type PlatformEsiPersistenceIntent,
} from '../../esi-query-persistence.js'
import type { PlatformProtectedQueryAccess } from '../../query-lifecycle.js'
import { canRunPlatformProtectedQuery, removePlatformQuery } from '../../query-lifecycle.js'
import { usePlatformQueryPersistence } from '../../query-persistence-presentation.js'
import type { PlatformQuerySubject } from '../../query-keys.js'
import {
  isPlatformQuerySubjectValid,
  PLATFORM_PRIVATE_QUERY_ROOT,
  platformModuleQueryKey,
} from '../../query-keys.js'

type ProtectedAccess = Omit<PlatformProtectedQueryAccess, 'isClient' | 'subject'>

export type PlatformProtectedQueryOptions<
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
> = Omit<DefineQueryOptions<TData, TError, TDataInitial>, 'enabled' | 'gcTime' | 'key' | 'meta'> & {
  readonly access: ProtectedAccess
  readonly esiPersistence: PlatformEsiPersistenceIntent
  readonly gcTime?: number
  readonly meta?: Omit<QueryMeta, 'esiPersistence'>
  readonly moduleId: string
  readonly resource?: EntryKey
  readonly routeId: string
  readonly subject: PlatformQuerySubject
}

export function usePlatformProtectedQuery<
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
>(options: MaybeRefOrGetter<PlatformProtectedQueryOptions<TData, TError, TDataInitial>>) {
  const queryCache = useQueryCache()
  const state = computed(() => {
    const {
      access,
      esiPersistence: persistenceIntent,
      moduleId,
      resource = [],
      routeId,
      subject,
      ...queryOptions
    } = toValue(options)
    const authorization = subject.kind === 'character' ? 'owned-character' : 'authenticated-session'
    const esiPersistence =
      persistenceIntent.kind === 'organization-esi'
        ? resolvePlatformEsiPersistence(
            platformQueryAdmissionScopes,
            moduleId,
            routeId,
            authorization,
          )
        : ({ kind: 'none' } as const)
    const routeAuthorized = platformQueryAdmissionScopes.some(
      (scope) =>
        scope.moduleId === moduleId &&
        scope.routeId === routeId &&
        scope.authorization === authorization,
    )
    const persistenceEligible = esiPersistence.kind !== 'none'
    const enabled =
      Boolean(moduleId) &&
      routeAuthorized &&
      canRunPlatformProtectedQuery({
        ...access,
        isClient: globalThis.window !== undefined,
        subject,
      })
    const key =
      moduleId && isPlatformQuerySubjectValid(subject)
        ? platformModuleQueryKey(moduleId, subject, resource, access.sectionId)
        : [...PLATFORM_PRIVATE_QUERY_ROOT, 'inactive-module-query', moduleId, ...resource]
    return {
      enabled,
      key,
      queryOptions: {
        ...queryOptions,
        gcTime: persistenceEligible ? ESI_QUERY_RETENTION_MS : queryOptions.gcTime,
        meta: {
          ...queryOptions.meta,
          esiPersistence,
        },
      },
    }
  })
  let retainedKey: EntryKey | undefined
  const query = useQuery(() => ({
    ...state.value.queryOptions,
    key: state.value.key,
    enabled: state.value.enabled,
  }))
  const persistencePresentation = usePlatformQueryPersistence(() => state.value.key)

  watch(
    state,
    ({ enabled, key }) => {
      if (retainedKey && !sameQueryKey(retainedKey, key))
        removePlatformQuery(queryCache, retainedKey)
      if (!enabled) removePlatformQuery(queryCache, key)
      retainedKey = key
    },
    { immediate: true, flush: 'sync' },
  )

  return { ...query, persistencePresentation }
}

function sameQueryKey(left: EntryKey, right: EntryKey) {
  return JSON.stringify(left) === JSON.stringify(right)
}
