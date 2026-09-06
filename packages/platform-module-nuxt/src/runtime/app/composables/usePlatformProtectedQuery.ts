import { useQuery, useQueryCache, type DefineQueryOptions, type EntryKey } from '@pinia/colada'
import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { PlatformProtectedQueryAccess } from '../../query-lifecycle.js'
import { canRunPlatformProtectedQuery, removePlatformQuery } from '../../query-lifecycle.js'
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
> = Omit<DefineQueryOptions<TData, TError, TDataInitial>, 'enabled' | 'key'> & {
  readonly access: ProtectedAccess
  readonly moduleId: string
  readonly resource?: EntryKey
  readonly subject: PlatformQuerySubject
}

export function usePlatformProtectedQuery<
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
>(options: MaybeRefOrGetter<PlatformProtectedQueryOptions<TData, TError, TDataInitial>>) {
  const queryCache = useQueryCache()
  const state = computed(() => {
    const { access, moduleId, resource = [], subject, ...queryOptions } = toValue(options)
    const enabled =
      Boolean(moduleId) &&
      canRunPlatformProtectedQuery({
        ...access,
        isClient: typeof window !== 'undefined',
        subject,
      })
    const key =
      moduleId && isPlatformQuerySubjectValid(subject)
        ? platformModuleQueryKey(moduleId, subject, resource)
        : [...PLATFORM_PRIVATE_QUERY_ROOT, 'inactive-module-query', moduleId, ...resource]
    return { enabled, key, queryOptions }
  })
  let retainedKey: EntryKey | undefined
  const query = useQuery(() => ({
    ...state.value.queryOptions,
    key: state.value.key,
    enabled: state.value.enabled,
  }))

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

  return query
}

function sameQueryKey(left: EntryKey, right: EntryKey) {
  return JSON.stringify(left) === JSON.stringify(right)
}
