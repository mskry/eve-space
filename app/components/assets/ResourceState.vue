<script setup lang="ts">
import type { AssetResourceState } from '../../types/assets'

defineProps<{
  state: AssetResourceState
}>()

const emit = defineEmits<{
  authorize: []
  retry: []
}>()
</script>

<template>
  <UiStatePanel
    v-if="state.phase === 'loading'"
    class="assets-resource-state"
    compact
    role="status"
    title="Resolving personal inventory"
  >
    <template #icon><div class="app-scanner" aria-hidden="true"></div></template>
    <p>Loading the complete asset collection and container context...</p>
  </UiStatePanel>
  <UiStatePanel
    v-else-if="state.phase === 'access-required'"
    class="assets-resource-state"
    code="ESI 403 / ASSETS"
    role="alert"
    title="Asset authorization required"
  >
    <p>{{ state.message || 'Authorize personal asset access for this exact character.' }}</p>
    <template #action>
      <button
        v-if="state.action"
        class="ui-action-primary"
        type="button"
        @click="emit('authorize')"
      >
        {{ state.action.label }}
      </button>
      <button v-else class="ui-action-secondary" type="button" @click="emit('retry')">RETRY</button>
    </template>
  </UiStatePanel>
  <UiStatePanel
    v-else-if="state.phase === 'authorization-rejected'"
    class="assets-resource-state"
    code="ESI 401 / ASSETS"
    role="alert"
    title="Asset authorization expired"
  >
    <p>
      {{
        state.message ||
        'EVE rejected this character authorization. Reauthorize the exact character to continue.'
      }}
    </p>
    <template #action>
      <button
        v-if="state.action"
        class="ui-action-primary"
        type="button"
        @click="emit('authorize')"
      >
        {{ state.action.label }}
      </button>
      <button v-else class="ui-action-secondary" type="button" @click="emit('retry')">RETRY</button>
    </template>
  </UiStatePanel>
  <UiStatePanel
    v-else-if="state.phase === 'cooldown'"
    class="assets-resource-state"
    code="ESI / QUOTA"
    role="alert"
    title="Asset service cooling down"
  >
    <p>{{ state.message || 'The asset request budget is recovering.' }}</p>
    <p v-if="state.retryAt">
      Do not retry before <time :datetime="state.retryAt">{{ state.retryAt }}</time
      >.
    </p>
  </UiStatePanel>
  <UiStatePanel
    v-else
    class="assets-resource-state"
    :code="state.statusLabel || 'ESI 502 / ASSETS'"
    role="alert"
    title="Personal inventory unavailable"
    tone="error"
  >
    <p>{{ state.message || 'The complete asset collection could not be loaded.' }}</p>
    <template v-if="state.canRetry" #action>
      <button class="ui-action-secondary" type="button" @click="emit('retry')">
        RETRY INVENTORY
      </button>
    </template>
  </UiStatePanel>
</template>

<style scoped>
.assets-resource-state {
  min-width: 0;
  border: 0.0625rem solid var(--ui-border-strong);
  background:
    repeating-linear-gradient(
      135deg,
      transparent 0 1.5rem,
      color-mix(in srgb, var(--ui-text) 2%, transparent) 1.5rem 1.5625rem
    ),
    var(--ui-surface);
}

.assets-resource-state :deep(button:focus-visible) {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.125rem;
}
</style>
