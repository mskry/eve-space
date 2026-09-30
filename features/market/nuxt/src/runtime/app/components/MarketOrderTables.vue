<script setup lang="ts">
import MarketOrderTable from './MarketOrderTable.vue'
import type { MarketObservedBook } from '../useMarketOverview'

defineProps<{ book: MarketObservedBook }>()
</script>

<template>
  <div class="market-order-tables">
    <MarketOrderTable :book="book" side="sell" />
    <MarketOrderTable :book="book" side="buy" />
  </div>
</template>

<style scoped>
.market-order-tables {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 32rem), 1fr));
  min-width: 0;
}
.market-order-tables > * {
  border-right: 1px solid var(--ui-border);
  border-bottom: 1px solid var(--ui-border);
  margin: 0 -1px -1px 0;
}
</style>
