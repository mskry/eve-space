import { useRuntimeConfig } from '#imports'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { usePlatformIdentity } from '../../identity.js'
import { createRequestSignal } from '../../request-signal.js'
import { usePlatformModuleRuntime } from './usePlatformModuleRuntime.js'

export const usePlatformInventoryCorporations = () => {
  const identity = usePlatformIdentity()
  const baseUrl = useRuntimeConfig().public.apiBase
  const corporations = ref<readonly number[]>([])
  const runtime = usePlatformModuleRuntime()
  const enabled = computed(
    () =>
      runtime.enabledModuleIds.value.has('trading') &&
      runtime.enabledModuleIds.value.has('member-audit') &&
      runtime.enabledSectionKeys.value.has('member-audit/assets'),
  )
  let generation = 0
  let request: AbortController | undefined
  let mounted = false
  let renewal: ReturnType<typeof setInterval> | undefined
  const refresh = async () => {
    const current = ++generation
    request?.abort()
    request = new AbortController()
    const owner = identity.privateIdentity?.value.ownerId
    corporations.value = []
    if (!mounted || !enabled.value || identity.privateIdentity?.value.status !== 'verified') return
    try {
      const response = await fetch(`${baseUrl}/api/inventory/corporations`, {
        credentials: 'include',
        cache: 'no-store',
        signal: createRequestSignal(16_000, request.signal),
      })
      if (!response.ok) return
      const result: { corporations: readonly number[] } = await response.json()
      if (
        current === generation &&
        identity.privateIdentity?.value.status === 'verified' &&
        owner === identity.privateIdentity.value.ownerId
      )
        corporations.value = result.corporations
    } catch {
      if (current === generation) corporations.value = []
    }
  }
  const onFocus = () => {
    void refresh()
  }
  if (identity.privateIdentity) watch(identity.privateIdentity, onFocus, { flush: 'sync' })
  watch(enabled, onFocus, { flush: 'sync' })
  onMounted(() => {
    mounted = true
    globalThis.addEventListener('focus', onFocus)
    globalThis.addEventListener('online', onFocus)
    renewal = setInterval(onFocus, 45_000)
    void refresh()
  })
  onScopeDispose(() => {
    clearInterval(renewal)
    generation += 1
    request?.abort()
    if (mounted) {
      globalThis.removeEventListener('focus', onFocus)
      globalThis.removeEventListener('online', onFocus)
    }
    mounted = false
  })
  return corporations
}
