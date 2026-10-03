<script setup lang="ts">
import type { TradingInventoryClockFragment } from '../trading-graphql'
defineProps<{ source: TradingInventoryClockFragment }>()
</script>
<template>
  <dl class="trading-clocks">
    <dt>Observed</dt>
    <dd>
      <time :datetime="source.observedAt">{{ source.observedAt }}</time>
    </dd>
    <dt>Validated</dt>
    <dd>
      <time :datetime="source.validatedAt">{{ source.validatedAt }}</time>
    </dd>
    <dt>Fresh until</dt>
    <dd>
      <time :datetime="source.freshUntil">{{ source.freshUntil }}</time>
    </dd>
    <dt>Readable until</dt>
    <dd>
      <time :datetime="source.retainedUntil">{{ source.retainedUntil }}</time>
    </dd>
  </dl>
</template>
<style scoped>
.trading-clocks {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 1rem;
  font-size: 0.8rem;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
