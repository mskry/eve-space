<script setup lang="ts">
defineProps<{
  assetCount: number
  knownVolume: number
  locationCount: number
}>()

function formatNumber(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
</script>

<template>
  <AppSummaryCard class="assets-summary">
    <template #icon>
      <img src="/images/7_64_13.png" alt="" width="64" height="64" />
    </template>
    <template #eyebrow>PERSONAL ASSET INDEX</template>
    <template #value>{{ formatNumber(assetCount) }}</template>
    <template #label>TOTAL ASSETS</template>

    <dl class="character-summary-stats" aria-label="Inventory summary">
      <div>
        <dt>Locations</dt>
        <dd>{{ formatNumber(locationCount) }}</dd>
      </div>
      <div>
        <dt>Known volume</dt>
        <dd>{{ formatNumber(knownVolume) }} m³</dd>
      </div>
    </dl>
  </AppSummaryCard>
</template>

<style scoped>
.assets-summary :deep(.character-summary-stats) {
  justify-content: flex-end;
}
</style>
