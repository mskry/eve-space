import { useQuery } from '@pinia/colada'
import { computed, useRuntimeConfig } from '#imports'

export interface PlatformNavigationIdentity {
  readonly ownerId: string
  readonly navigationId: string
}

interface PlatformModuleRuntimeState {
  readonly enabledModuleIds: readonly string[]
  readonly shellNavigationOrder: {
    readonly dashboard: readonly PlatformNavigationIdentity[]
    readonly character: readonly PlatformNavigationIdentity[]
  }
}

const platformModuleRuntimeQueryKey = ['private', 'modules', 'runtime'] as const

export function usePlatformModuleRuntime() {
  const runtimeConfig = useRuntimeConfig()
  const runtimeQuery = useQuery({
    key: platformModuleRuntimeQueryKey,
    enabled: typeof window !== 'undefined',
    staleTime: 30_000,
    query: ({ signal }) => loadPlatformModuleRuntimeState(runtimeConfig.public.apiBase, signal),
  })
  const enabledModuleIds = computed(() => new Set(runtimeQuery.data.value?.enabledModuleIds ?? []))

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
  if (!response.ok) throw new Error('Module runtime state is unavailable.')
  return (await response.json()) as PlatformModuleRuntimeState
}
