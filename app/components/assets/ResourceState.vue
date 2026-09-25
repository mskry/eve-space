<script setup lang="ts">
import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'
import type { VNode } from 'vue'
import type { AssetResourceState } from '../../types/assets'
import type { EsiResourceState } from '../../types/esi-resource'

const props = defineProps<{
  hasData?: boolean
  presentation?: EsiQueryPersistencePresentation
  state: AssetResourceState
}>()

const emit = defineEmits<{
  retry: []
}>()

defineSlots<{
  default(): VNode[]
}>()

const resourceState = computed<EsiResourceState>(() => {
  const state = props.state
  if (state.phase === 'loading') {
    return {
      message: 'Loading the complete asset collection and container context...',
      status: 'loading',
      title: 'Resolving personal inventory',
    }
  }
  if (state.phase === 'access-required' || state.phase === 'authorization-rejected') {
    const rejected = state.phase === 'authorization-rejected'
    return {
      action: state.action,
      code: rejected ? 'ESI 401 / ASSETS' : 'ESI 403 / ASSETS',
      message:
        state.message ??
        (rejected
          ? 'EVE rejected this character authorization. Reauthorize the exact character to continue.'
          : 'Authorize personal asset access for this exact character.'),
      retryLabel: state.action ? undefined : 'RETRY',
      status: 'authorization-required',
      title: rejected ? 'Asset authorization expired' : 'Asset authorization required',
    }
  }
  if (state.phase === 'cooldown') {
    return {
      code: 'ESI / QUOTA',
      message: state.message ?? 'The asset request budget is recovering.',
      retryAt: state.retryAt,
      status: 'error',
      title: 'Asset service cooling down',
      tone: 'default',
    }
  }
  if (state.phase === 'unavailable') {
    return {
      code: state.statusLabel ?? 'ESI 502 / ASSETS',
      message: state.message ?? 'The complete asset collection could not be loaded.',
      retryLabel: state.canRetry ? 'RETRY INVENTORY' : undefined,
      status: 'error',
      title: 'Personal inventory unavailable',
    }
  }
  return { status: 'ready' }
})
</script>

<template>
  <EsiResourceBoundary
    :state="resourceState"
    :has-data="hasData"
    :presentation="presentation"
    @retry="emit('retry')"
  >
    <slot />
  </EsiResourceBoundary>
</template>
