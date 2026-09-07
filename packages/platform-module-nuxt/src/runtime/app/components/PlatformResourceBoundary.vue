<script setup lang="ts">
import type { PlatformResourceState } from '../../resource-state.js'

withDefaults(
  defineProps<{
    hasData?: boolean
    state: PlatformResourceState
  }>(),
  { hasData: false },
)

const emit = defineEmits<{
  retry: []
}>()

defineSlots<{
  default(): unknown
  error(props: {
    state: Extract<PlatformResourceState, { status: 'error' | 'unavailable' }>
  }): unknown
  loading(props: { state: Extract<PlatformResourceState, { status: 'loading' }> }): unknown
  retained(props: { state: Exclude<PlatformResourceState, { status: 'ready' }> }): unknown
}>()
</script>

<template>
  <slot v-if="hasData || state.status === 'ready'" />

  <slot v-if="!hasData && state.status === 'loading'" name="loading" :state="state">
    <output class="platform-resource-state">
      <span v-if="state.code">{{ state.code }}</span>
      <strong class="platform-resource-title">{{ state.title }}</strong>
      <span v-if="state.message" class="platform-resource-message">{{ state.message }}</span>
    </output>
  </slot>

  <PlatformAuthorizationRequired
    v-else-if="!hasData && state.status === 'authorization-required'"
    :code="state.code"
    :title="state.title"
    :message="state.message"
    :authorize-url="state.action?.href"
    :action-label="state.action?.label"
  >
    <template v-if="!state.action && state.retryLabel" #action>
      <button type="button" @click="emit('retry')">{{ state.retryLabel }}</button>
    </template>
  </PlatformAuthorizationRequired>

  <slot
    v-else-if="!hasData && (state.status === 'error' || state.status === 'unavailable')"
    name="error"
    :state="state"
  >
    <section class="platform-resource-state platform-resource-state--error" role="alert">
      <span v-if="state.code">{{ state.code }}</span>
      <h2>{{ state.title }}</h2>
      <p v-if="state.message">{{ state.message }}</p>
      <p v-if="state.retryAt">
        Do not retry before <time :datetime="state.retryAt">{{ state.retryAt }}</time
        >.
      </p>
      <button v-if="state.retryLabel" type="button" @click="emit('retry')">
        {{ state.retryLabel }}
      </button>
    </section>
  </slot>

  <output v-else-if="!hasData && state.status === 'stale'" class="platform-resource-state">
    <span v-if="state.code">{{ state.code }}</span>
    <strong class="platform-resource-title">{{ state.title }}</strong>
    <span v-if="state.message" class="platform-resource-message">{{ state.message }}</span>
    <button v-if="state.retryLabel" type="button" @click="emit('retry')">
      {{ state.retryLabel }}
    </button>
  </output>

  <slot v-else-if="hasData && state.status !== 'ready'" name="retained" :state="state">
    <output v-if="state.status === 'stale'" class="platform-resource-retained">
      {{ state.message ?? state.title }}
      <button v-if="state.retryLabel" type="button" @click="emit('retry')">
        {{ state.retryLabel }}
      </button>
    </output>
  </slot>
</template>

<style scoped>
.platform-resource-state {
  display: block;
  padding: 0.75rem;
  border: 0.0625rem solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
}

.platform-resource-state--error {
  border-color: color-mix(in srgb, var(--ui-danger) 45%, var(--ui-border));
}

.platform-resource-state h2,
.platform-resource-state p,
.platform-resource-title,
.platform-resource-message,
.platform-resource-retained {
  margin: 0.25rem 0 0;
}

.platform-resource-title,
.platform-resource-message,
.platform-resource-retained {
  display: block;
}

.platform-resource-title {
  font-size: 1.5em;
}

.platform-resource-state > span:not(.platform-resource-message) {
  color: var(--ui-text-muted);
  font: 700 0.5rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.08em;
}

.platform-resource-state button,
.platform-resource-retained button {
  margin-inline-start: 0.5rem;
}
</style>
