<script setup lang="ts">
import { formatMarketIskCompact } from '../market-isk'
import { marketBookSummary } from '../market-book-summary'
import type { MarketObservedBook } from '../useMarketOverview'

const props = defineProps<{ book: MarketObservedBook }>()
const summary = computed(() => marketBookSummary(props.book.sellers, props.book.buyers))
</script>

<template>
  <dl class="market-book-summary" aria-label="Market summary">
    <div class="market-book-summary__pair">
      <div class="market-book-summary__cell">
        <dt>Best sell</dt>
        <dd
          class="market-book-summary__value market-book-summary__value--sell"
          :title="summary.bestSell ? `${summary.bestSell} ISK` : undefined"
          :aria-label="summary.bestSell ? `Best sell ${summary.bestSell} ISK` : undefined"
        >
          {{ summary.bestSell ? formatMarketIskCompact(summary.bestSell) : '—' }}
          <span
            v-if="summary.bestSell"
            class="market-book-summary__arrow market-book-summary__arrow--sell"
            aria-hidden="true"
            >↓</span
          >
        </dd>
      </div>
      <div class="market-book-summary__cell">
        <dt>Best buy</dt>
        <dd
          class="market-book-summary__value market-book-summary__value--buy"
          :title="summary.bestBuy ? `${summary.bestBuy} ISK` : undefined"
          :aria-label="summary.bestBuy ? `Best buy ${summary.bestBuy} ISK` : undefined"
        >
          {{ summary.bestBuy ? formatMarketIskCompact(summary.bestBuy) : '—' }}
          <span
            v-if="summary.bestBuy"
            class="market-book-summary__arrow market-book-summary__arrow--buy"
            aria-hidden="true"
            >↑</span
          >
        </dd>
      </div>
    </div>
    <div class="market-book-summary__pair">
      <div class="market-book-summary__cell">
        <dt>Spread</dt>
        <dd class="market-book-summary__inline">
          <span
            class="market-book-summary__value"
            :title="summary.spread ? `${summary.spread} ISK` : undefined"
            :aria-label="summary.spread ? `${summary.spread} ISK` : undefined"
            >{{ summary.spread ? formatMarketIskCompact(summary.spread) : '—' }}</span
          >
          <span v-if="summary.spreadShare" class="market-book-summary__note">{{
            summary.spreadShare
          }}</span>
        </dd>
      </div>
      <div class="market-book-summary__cell">
        <dt>Listed units</dt>
        <dd class="market-book-summary__inline market-book-summary__units">
          <span class="market-book-summary__value--sell">{{ summary.sellUnits }} sell</span>
          <span class="market-book-summary__value--buy">{{ summary.buyUnits }} buy</span>
        </dd>
      </div>
    </div>
  </dl>
</template>

<style scoped>
.market-book-summary {
  display: flex;
  flex-wrap: wrap;
  margin: 0 0 1.25rem;
  border-bottom: 1px solid var(--ui-border);
}
.market-book-summary__pair {
  flex: 1 1 18.75rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.market-book-summary__cell {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 0.375rem;
  padding: 0.75rem 1.125rem;
  border-right: 1px solid var(--ui-border);
}
.market-book-summary__pair:last-child .market-book-summary__cell:last-child {
  border-right: 0;
}
dt {
  color: var(--ui-text-muted);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.market-book-summary__arrow {
  margin-left: 0.25rem;
  font-size: 0.75em;
  line-height: 1;
  vertical-align: 0.08em;
}
.market-book-summary__arrow--sell {
  color: var(--ui-danger);
}
.market-book-summary__arrow--buy {
  color: var(--ui-success);
}
dd {
  min-width: 0;
  margin: 0;
}
.market-book-summary__value {
  font: 400 1.1875rem/1 var(--ui-font-mono);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.market-book-summary__value--sell {
  color: var(--ui-primary-hover);
}
.market-book-summary__value--buy {
  color: var(--ui-text-muted);
}
.market-book-summary__inline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.5rem;
}
.market-book-summary__note {
  color: var(--ui-text-muted);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.market-book-summary__units {
  column-gap: 0.625rem;
  font: 400 0.9375rem/1 var(--ui-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
