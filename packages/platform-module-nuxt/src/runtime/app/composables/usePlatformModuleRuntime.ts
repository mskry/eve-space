import { useQuery, useQueryCache } from '@pinia/colada'
import { computed, useRuntimeConfig } from '#imports'
import { watch } from 'vue'
import type { PlatformNavigationIdentity } from '../../navigation.js'
import { removePlatformModuleQueries } from '../../query-lifecycle.js'
import { toApiQueryError } from '../../query-error.js'

export interface PlatformModuleRuntimeState {
  readonly enabledModuleIds: readonly string[]
  readonly shellNavigationOrder: {
    readonly dashboard: readonly PlatformNavigationIdentity[]
    readonly character: readonly PlatformNavigationIdentity[]
  }
}

const platformModuleRuntimeQueryKey = ['public', 'modules', 'runtime'] as const

export function usePlatformModuleRuntime() {
  const runtimeConfig = useRuntimeConfig()
  const queryCache = useQueryCache()
  const runtimeQuery = useQuery({
    key: platformModuleRuntimeQueryKey,
    enabled: typeof window !== 'undefined',
    staleTime: 30_000,
    query: ({ signal }) => loadPlatformModuleRuntimeState(runtimeConfig.public.apiBase, signal),
  })
  const enabledModuleIds = computed(() => new Set(runtimeQuery.data.value?.enabledModuleIds ?? []))
  let previousEnabledModuleIds = new Set<string>()

  watch(enabledModuleIds, (currentEnabledModuleIds) => {
    for (const moduleId of previousEnabledModuleIds) {
      if (!currentEnabledModuleIds.has(moduleId)) removePlatformModuleQueries(queryCache, moduleId)
    }
    previousEnabledModuleIds = new Set(currentEnabledModuleIds)
  })

  async function ensureRuntimeState() {
    await runtimeQuery.refresh(true)
  }

  return { enabledModuleIds, ensureRuntimeState, runtimeQuery }
}

export async function loadPlatformModuleRuntimeState(apiBase: string, signal?: AbortSignal) {
  const response = await fetch(`${apiBase}/api/modules`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw await toApiQueryError(response, 'Module runtime state is unavailable.')
  return (await response.json()) as PlatformModuleRuntimeState
}
