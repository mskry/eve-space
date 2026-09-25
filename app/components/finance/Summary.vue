<script setup lang="ts">
import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'
import type { VNode } from 'vue'
import type {
  FinanceBalance,
  FinanceResourceState,
  FinanceSummaryMetric,
} from '../../types/finance'
import { formatFinanceIsk, toFinanceEsiResourceState } from '../../utils/finance'

const props = defineProps<{
  balance: FinanceBalance | null
  balanceLabel: string
  eyebrow: string
  metrics: readonly FinanceSummaryMetric[]
  presentation?: EsiQueryPersistencePresentation
  state: FinanceResourceState
}>()

defineEmits<{
  refresh: []
  'review-awaiting-contracts': []
}>()

defineSlots<{
  icon(): VNode[]
}>()

const resourceState = computed(() => {
  const state = toFinanceEsiResourceState(props.state, 'Wallet')
  if (state.status !== 'authorization-required') {
    return state
  }
  return {
    ...state,
    code: 'ESI 403 / WALLET',
    retryLabel: state.action ? undefined : 'RETRY BALANCE',
  }
})
</script>

<template>
  <EsiResourceBoundary
    :state="resourceState"
    has-data
    :presentation="presentation"
    @retry="$emit('refresh')"
  >
    <AppSummaryCard>
      <template #icon><slot name="icon" /></template>
      <template #eyebrow>{{ eyebrow }}</template>
      <template #value
        >{{ balance ? formatFinanceIsk(balance.balance) : 'UNAVAILABLE' }} ISK</template
      >
      <template #label>{{ balanceLabel }}</template>

      <dl v-if="metrics.length > 0" class="character-summary-stats finance-hero-metrics">
        <UiTooltip v-for="metric in metrics" :key="metric.id" :content="metric.detail">
          <div>
            <dt>{{ metric.label }}</dt>
            <dd>
              <button
                v-if="metric.link"
                class="finance-hero-link"
                type="button"
                @click="$emit('review-awaiting-contracts')"
              >
                {{ metric.value }}
              </button>
              <template v-else>{{ metric.value }}</template>
            </dd>
          </div>
        </UiTooltip>
      </dl>

      <div
        v-if="state.canRetry && resourceState.status !== 'authorization-required'"
        class="finance-hero-actions"
      >
        <button
          class="ui-action-secondary"
          type="button"
          :disabled="state.loading"
          @click="$emit('refresh')"
        >
          {{ state.loading ? 'RETRYING...' : 'RETRY BALANCE' }}
        </button>
      </div>
    </AppSummaryCard>

    <output v-if="state.stale" class="finance-stale-notice">
      The current wallet balance is retained stale data.
    </output>
    <p
      v-if="state.errorMessage && resourceState.status !== 'authorization-required'"
      class="finance-inline-error"
      role="alert"
    >
      {{ state.errorMessage }}
    </p>
  </EsiResourceBoundary>
</template>
