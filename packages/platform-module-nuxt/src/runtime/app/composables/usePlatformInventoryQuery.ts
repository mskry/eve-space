import { useRuntimeConfig } from '#imports'
import { computed, onMounted, onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { usePlatformIdentity } from '../../identity.js'
import {
  createPlatformInventoryQuery,
  type PlatformInventorySelection,
} from '../../inventory-query.js'
import { createRequestSignal } from '../../request-signal.js'
import { ApiQueryError, toApiQueryError } from '../../query-error.js'
import { usePlatformModuleRuntime } from './usePlatformModuleRuntime.js'

export const usePlatformInventoryQuery = <Result>(
  options: MaybeRefOrGetter<{
    readonly selection: PlatformInventorySelection
    readonly resource?: string
    readonly load: (signal: AbortSignal) => Promise<Result>
  }>,
) => {
  const identity = usePlatformIdentity()
  const baseUrl = useRuntimeConfig().public.apiBase
  const runtime = usePlatformModuleRuntime()
  const access = computed(() => identity.privateIdentity?.value)
  const selector = computed(() =>
    JSON.stringify([toValue(options).selection, toValue(options).resource]),
  )
  const enabled = computed(() => runtime.enabledModuleIds.value.has('trading'))
  const query = createPlatformInventoryQuery<Result>({
    ownerId: () => access.value?.ownerId ?? null,
    admit: async (signal) => {
      const response = await fetch(`${baseUrl}/api/inventory/admission`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toValue(options).selection),
        signal: createRequestSignal(16_000, signal),
      })
      if (!response.ok) throw await toApiQueryError(response, 'Inventory admission is unavailable.')
      return response.json()
    },
  })
  let mounted = false
  let renewal: ReturnType<typeof setInterval> | undefined
  const verify = async () => {
    if (!mounted || access.value?.status !== 'verified') {
      query.suspend()
      return false
    }
    try {
      await runtime.ensureRuntimeState()
    } catch {
      query.suspend()
      return false
    }
    if (!enabled.value) {
      query.invalidate(
        new ApiQueryError('Inventory is disabled.', { code: 'MODULE_DISABLED', status: 404 }),
      )
      return false
    }
    if (!mounted || access.value?.status !== 'verified') {
      query.suspend()
      return false
    }
    return query.check()
  }
  const refresh = async () => {
    if (await verify()) await query.run(toValue(options).load)
  }
  const onFocus = () => {
    void refresh()
  }
  watch(
    [access, selector, enabled],
    ([current, scope, moduleEnabled], previous) => {
      if (
        current?.ownerId !== previous?.[0]?.ownerId ||
        scope !== previous?.[1] ||
        (current?.revision !== previous?.[0]?.revision && current?.status === 'verified')
      )
        query.invalidate()
      if (!moduleEnabled) query.invalidate()
      if (mounted) void refresh()
    },
    { flush: 'sync' },
  )
  onMounted(() => {
    mounted = true
    globalThis.addEventListener('focus', onFocus)
    globalThis.addEventListener('online', onFocus)
    renewal = setInterval(() => {
      void refresh()
    }, 45_000)
    void refresh()
  })
  onScopeDispose(() => {
    clearInterval(renewal)
    query.dispose()
    if (mounted) {
      globalThis.removeEventListener('focus', onFocus)
      globalThis.removeEventListener('online', onFocus)
    }
    mounted = false
  })
  return { ...query, refresh, verify, execute: query.run }
}
