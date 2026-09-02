<script setup lang="ts">
import type {
  FinanceBalance,
  FinanceResourceState,
  FinanceSummaryMetric,
} from '../../types/finance'
import { formatFinanceIsk, formatFinanceSynced } from '../../utils/finance'

defineProps<{
  balance: FinanceBalance | null
  balanceLabel: string
  eyebrow: string
  metrics: readonly FinanceSummaryMetric[]
  now: number
  state: FinanceResourceState
}>()

defineEmits<{
  refresh: []
  'review-awaiting-contracts': []
}>()

defineSlots<{
  icon(): unknown
}>()
</script>

<template>
  <AppSummaryCard>
    <template #icon><slot name="icon" /></template>
    <template #eyebrow>{{ eyebrow }}</template>
    <template #value
      >{{ balance ? formatFinanceIsk(balance.balance) : 'UNAVAILABLE' }} ISK</template
    >
    <template #label>{{ balanceLabel }}</template>

    <dl v-if="metrics.length > 0" class="finance-hero-metrics">
      <div v-for="metric in metrics" :key="metric.id">
        <dt>
          {{ metric.label }}
          <span>{{ metric.detail }}</span>
        </dt>
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
    </dl>

    <div class="finance-hero-actions">
      <a
        v-if="state.authorizationAction"
        class="ui-action-primary"
        :href="state.authorizationAction.href"
      >
        {{ state.authorizationAction.label }}
      </a>
      <button
        v-else
        class="ui-action-secondary"
        type="button"
        :disabled="state.loading"
        @click="$emit('refresh')"
      >
        {{ state.loading ? 'REFRESHING...' : 'REFRESH BALANCE' }}
      </button>
      <span v-if="balance?.validatedAt" class="finance-synced">
        SYNCED {{ formatFinanceSynced(balance.validatedAt, now) }}
      </span>
    </div>
  </AppSummaryCard>

  <output v-if="state.stale" class="finance-stale-notice">
    The current wallet balance is retained stale data.
  </output>
  <p v-if="state.errorMessage && !balance" class="finance-inline-error" role="alert">
    {{ state.errorMessage }}
  </p>
</template>
