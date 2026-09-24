import { useQuery, useQueryCache } from '@pinia/colada'
import { platformQueryAdmissionScopes } from '#build/eve-space-platform/query-admission-scopes'
import { computed, useRuntimeConfig } from '#imports'
import { watch } from 'vue'
import type { PlatformNavigationIdentity } from '../../navigation.js'
import {
  removePlatformModuleQueries,
  removePlatformModuleSectionQueries,
} from '../../query-lifecycle.js'
import { toApiQueryError } from '../../query-error.js'
import type { PlatformQueryPersistenceInvalidator } from '../../query-persistence-invalidation.js'

export interface PlatformModuleRuntimeState {
  readonly enabledModuleIds: readonly string[]
  readonly enabledSections: readonly {
    readonly moduleId: string
    readonly sectionId: string
    readonly kind: 'workspace' | 'sensitive-evidence' | 'access-management'
    readonly disclosureVersion: number
    readonly activationVersion: number
  }[]
  readonly shellNavigationOrder: {
    readonly dashboard: readonly PlatformNavigationIdentity[]
    readonly character: readonly PlatformNavigationIdentity[]
  }
}

const platformModuleRuntimeQueryKey = ['public', 'modules', 'runtime'] as const

export function usePlatformModuleRuntime() {
  const runtimeConfig = useRuntimeConfig()
  const runtimeQuery = useQuery({
    enabled: globalThis.window !== undefined,
    key: platformModuleRuntimeQueryKey,
    query: ({ signal }) => loadPlatformModuleRuntimeState(runtimeConfig.public.apiBase, signal),
    staleTime: 30_000,
  })
  const enabledModuleIds = computed(() => new Set(runtimeQuery.data.value?.enabledModuleIds ?? []))
  const enabledSectionKeys = computed(
    () =>
      new Set(
        (runtimeQuery.data.value?.enabledSections ?? []).map(({ moduleId, sectionId }) =>
          sectionKey(moduleId, sectionId),
        ),
      ),
  )

  async function ensureRuntimeState() {
    await runtimeQuery.refresh(true)
  }

  return { enabledModuleIds, enabledSectionKeys, ensureRuntimeState, runtimeQuery }
}

export function usePlatformModulePersistenceLifecycle(
  invalidateQueryPersistence: PlatformQueryPersistenceInvalidator,
) {
  const queryCache = useQueryCache()
  const { enabledModuleIds, enabledSectionKeys } = usePlatformModuleRuntime()
  let previousEnabledModuleIds = new Set(enabledModuleIds.value)
  let previousEnabledSectionKeys = new Set(enabledSectionKeys.value)

  watch(
    enabledModuleIds,
    (currentEnabledModuleIds) => {
      for (const moduleId of previousEnabledModuleIds) {
        if (currentEnabledModuleIds.has(moduleId)) {
          continue
        }
        const admissionScopes = [
          ...new Set(
            platformQueryAdmissionScopes
              .filter((scope) => scope.moduleId === moduleId)
              .map((scope) => scope.admissionScope),
          ),
        ]
        invalidateQueryPersistence({ admissionScopes, moduleId })
        removePlatformModuleQueries(queryCache, moduleId)
      }
      previousEnabledModuleIds = new Set(currentEnabledModuleIds)
    },
    { flush: 'sync' },
  )
  watch(
    enabledSectionKeys,
    (currentEnabledSectionKeys) => {
      for (const key of previousEnabledSectionKeys) {
        if (currentEnabledSectionKeys.has(key)) {
          continue
        }
        const [moduleId, sectionId] = key.split('/')
        if (!moduleId || !sectionId || !enabledModuleIds.value.has(moduleId)) {
          continue
        }
        const admissionScopes = [
          ...new Set(
            platformQueryAdmissionScopes
              .filter((scope) => scope.moduleId === moduleId && scope.sectionId === sectionId)
              .map((scope) => scope.admissionScope),
          ),
        ]
        invalidateQueryPersistence({ admissionScopes, moduleId })
        removePlatformModuleSectionQueries(queryCache, moduleId, sectionId)
      }
      previousEnabledSectionKeys = new Set(currentEnabledSectionKeys)
    },
    { flush: 'sync' },
  )
}

export async function loadPlatformModuleRuntimeState(apiBase: string, signal?: AbortSignal) {
  const response = await fetch(`${apiBase}/api/modules`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) {
    throw await toApiQueryError(response, 'Module runtime state is unavailable.')
  }
  return (await response.json()) as PlatformModuleRuntimeState
}

function sectionKey(moduleId: string, sectionId: string) {
  return `${moduleId}/${sectionId}`
}
