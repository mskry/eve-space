<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { formatMarketIsk } from '../market-isk'
import { marketHistorySeries } from '../market-history-presentation'
import type { MarketDailyHistory } from '../useMarketOverview'

const props = defineProps<{ history: MarketDailyHistory }>()
const MarketHistoryChart = defineAsyncComponent(() => import('./MarketHistoryChart.vue'))
const days = computed(() => marketHistorySeries(props.history.days))
const singleDay = computed(() => {
  const day = days.value[0]
  return day
    ? `${day.date} · Daily Average ${formatMarketIsk(day.averageIsk)} · high ${formatMarketIsk(day.highIsk)} · low ${formatMarketIsk(day.lowIsk)} · volume ${day.volume.toLocaleString('en-US')}`
    : ''
})
</script>

<template>
  <section class="market-price-history" aria-label="Daily price history">
    <output v-if="history.freshness === 'stale'"
      >Daily price history is stale; the current order book has a separate source time.</output
    >
    <output v-if="history.status === 'uncollected'"
      >Daily price history has not been collected for this item and market.</output
    >
    <output v-else-if="!days.length">No valid daily history is available.</output>
    <template v-else>
      <MarketHistoryChart v-if="days.length >= 2" :days="days" />
      <output v-else>Only one day is available; no price series is drawn. {{ singleDay }}</output>
    </template>
  </section>
</template>

<style scoped>
.market-price-history {
  min-width: 0;
}
</style>
