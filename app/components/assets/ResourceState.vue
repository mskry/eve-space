<script setup lang="ts">
import type { AssetResourceState } from '../../types/assets'
import type { EsiResourceState } from '../../types/esi-resource'

const props = defineProps<{
  state: AssetResourceState
}>()

const emit = defineEmits<{
  retry: []
}>()

const resourceState = computed<EsiResourceState>(() => {
  const state = props.state
  if (state.phase === 'loading') {
    return {
      status: 'loading',
      title: 'Resolving personal inventory',
      message: 'Loading the complete asset collection and container context...',
    }
  }
  if (state.phase === 'access-required' || state.phase === 'authorization-rejected') {
    const rejected = state.phase === 'authorization-rejected'
    return {
      status: 'authorization-required',
      code: rejected ? 'ESI 401 / ASSETS' : 'ESI 403 / ASSETS',
      title: rejected ? 'Asset authorization expired' : 'Asset authorization required',
      message:
        state.message ??
        (rejected
          ? 'EVE rejected this character authorization. Reauthorize the exact character to continue.'
          : 'Authorize personal asset access for this exact character.'),
      action: state.action,
      retryLabel: state.action ? undefined : 'RETRY',
    }
  }
  if (state.phase === 'cooldown') {
    return {
      status: 'error',
      code: 'ESI / QUOTA',
      title: 'Asset service cooling down',
      message: state.message ?? 'The asset request budget is recovering.',
      retryAt: state.retryAt,
      tone: 'default',
    }
  }
  if (state.phase === 'unavailable') {
    return {
      status: 'error',
      code: state.statusLabel ?? 'ESI 502 / ASSETS',
      title: 'Personal inventory unavailable',
      message: state.message ?? 'The complete asset collection could not be loaded.',
      retryLabel: state.canRetry ? 'RETRY INVENTORY' : undefined,
    }
  }
  return { status: 'ready' }
})
</script>

<template>
  <EsiResourceBoundary :state="resourceState" @retry="emit('retry')" />
</template>
