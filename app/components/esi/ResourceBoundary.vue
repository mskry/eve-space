<script setup lang="ts">
import type { EsiResourceState } from '../../types/esi-resource'

withDefaults(
  defineProps<{
    compact?: boolean
    hasData?: boolean
    state: EsiResourceState
  }>(),
  {
    compact: true,
    hasData: false,
  },
)

const emit = defineEmits<{
  retry: []
}>()

defineSlots<{
  default(): unknown
  error(props: { state: Extract<EsiResourceState, { status: 'error' }> }): unknown
  loading(props: { state: Extract<EsiResourceState, { status: 'loading' }> }): unknown
  retained(props: { state: Exclude<EsiResourceState, { status: 'ready' }> }): unknown
}>()
</script>

<template>
  <slot v-if="hasData || state.status === 'ready'" />

  <slot v-if="!hasData && state.status === 'loading'" name="loading" :state="state">
    <UiStatePanel :code="state.code" :title="state.title" :compact="compact" role="status">
      <template #icon><div class="app-scanner" aria-hidden="true"></div></template>
      <p v-if="state.message">{{ state.message }}</p>
    </UiStatePanel>
  </slot>

  <EsiAuthorizationRequired
    v-else-if="state.status === 'authorization-required'"
    :code="state.code"
    :title="state.title"
    :message="state.message"
    :authorize-url="state.action?.href"
    :action-label="state.action?.label"
  >
    <template v-if="!state.action && state.retryLabel" #action>
      <button type="button" @click="emit('retry')">{{ state.retryLabel }}</button>
    </template>
  </EsiAuthorizationRequired>

  <slot v-else-if="!hasData && state.status === 'error'" name="error" :state="state">
    <UiStatePanel
      :code="state.code"
      :title="state.title"
      :compact="compact"
      role="alert"
      :tone="state.tone ?? 'error'"
    >
      <p v-if="state.message">{{ state.message }}</p>
      <p v-if="state.retryAt">
        Do not retry before <time :datetime="state.retryAt">{{ state.retryAt }}</time
        >.
      </p>
      <template v-if="state.retryLabel" #action>
        <button class="ui-action-secondary" type="button" @click="emit('retry')">
          {{ state.retryLabel }}
        </button>
      </template>
    </UiStatePanel>
  </slot>

  <slot v-else-if="hasData && state.status !== 'ready'" name="retained" :state="state" />
</template>
