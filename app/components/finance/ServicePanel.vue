<script setup lang="ts">
import type { FinanceResourceState } from '../../types/finance'
import { formatValidatedAt } from '../../utils/format'

defineProps<{
  hasData: boolean
  state: FinanceResourceState
  title: string
  validatedAt?: string
}>()

defineEmits<{
  retry: []
}>()

defineSlots<{
  default(): unknown
}>()
</script>

<template>
  <section class="finance-service" :aria-busy="state.loading" :aria-label="title">
    <UiStatePanel
      v-if="state.authorizationRequired && !hasData"
      code="SCOPE REQUIRED"
      :title="`${title} not authorized`"
      compact
      role="alert"
    >
      <p>{{ state.errorMessage }}</p>
      <template v-if="state.authorizationAction" #action>
        <a class="ui-action-primary" :href="state.authorizationAction.href">
          {{ state.authorizationAction.label }}
        </a>
      </template>
    </UiStatePanel>

    <UiStatePanel v-else-if="state.loading && !hasData" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true"></div></template>
      <p>Loading {{ title.toLocaleLowerCase('en-US') }}...</p>
    </UiStatePanel>

    <UiStatePanel
      v-else-if="state.errorMessage && !hasData"
      :code="state.errorCode ?? 'ESI 502 / FINANCE'"
      :title="`${title} unavailable`"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ state.errorMessage }}</p>
      <template v-if="state.canRetry" #action>
        <button class="ui-action-secondary" type="button" @click="$emit('retry')">RETRY</button>
      </template>
    </UiStatePanel>

    <div v-else class="finance-service-content">
      <output v-if="state.stale" class="finance-stale-notice">
        Retained data is shown after an upstream refresh failure.
        <template v-if="validatedAt">Validated {{ formatValidatedAt(validatedAt) }} UTC.</template>
      </output>
      <p v-if="state.errorMessage" class="finance-inline-error" role="alert">
        {{ state.errorMessage }}
      </p>
      <slot />
    </div>
  </section>
</template>
