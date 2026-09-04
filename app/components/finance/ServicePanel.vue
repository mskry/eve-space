<script setup lang="ts">
import type { FinanceResourceState } from '../../types/finance'
import { formatValidatedAt } from '../../utils/format'
import { toFinanceEsiResourceState } from '../../utils/finance'

const props = defineProps<{
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

const resourceState = computed(() => toFinanceEsiResourceState(props.state, props.title))
</script>

<template>
  <section class="finance-service" :aria-busy="state.loading" :aria-label="title">
    <EsiResourceBoundary :state="resourceState" :has-data="hasData" @retry="$emit('retry')">
      <div class="finance-service-content">
        <output v-if="state.stale" class="finance-stale-notice">
          Retained data is shown after an upstream refresh failure.
          <template v-if="validatedAt"
            >Validated {{ formatValidatedAt(validatedAt) }} UTC.</template
          >
        </output>
        <p
          v-if="state.errorMessage && resourceState.status !== 'authorization-required'"
          class="finance-inline-error"
          role="alert"
        >
          {{ state.errorMessage }}
        </p>
        <slot />
      </div>
    </EsiResourceBoundary>
  </section>
</template>
