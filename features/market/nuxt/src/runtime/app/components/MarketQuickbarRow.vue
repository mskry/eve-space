<script setup lang="ts">
const { selected = false, actionsVisible = false } = defineProps<{
  selected?: boolean
  actionsVisible?: boolean
}>()
</script>

<template>
  <div
    class="market-quickbar-row"
    :class="{
      'market-quickbar-row--selected': selected,
      'market-quickbar-row--actions-visible': actionsVisible,
    }"
  >
    <div class="market-quickbar-row__main"><slot /></div>
    <span v-if="$slots.actions" class="market-quickbar-row__actions"><slot name="actions" /></span>
  </div>
</template>

<style scoped>
.market-quickbar-row {
  position: relative;
  min-width: 0;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.5rem 0 var(--market-quickbar-indent, 0.875rem);
  color: var(--ui-text);
  font: 0.875rem/1.2 var(--ui-font-body);
}
.market-quickbar-row::before {
  content: '';
  position: absolute;
  inset: 5px auto 5px 0;
  width: 2px;
  background: transparent;
}
.market-quickbar-row:hover {
  background: color-mix(in srgb, var(--ui-primary) 5%, transparent);
}
.market-quickbar-row--selected {
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
}
.market-quickbar-row--selected::before {
  background: var(--ui-primary);
}
.market-quickbar-row__main {
  min-width: 0;
  height: 100%;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.market-quickbar-row__actions {
  display: flex;
  gap: 2px;
  opacity: 0;
}
.market-quickbar-row:hover .market-quickbar-row__actions,
.market-quickbar-row:focus-within .market-quickbar-row__actions,
.market-quickbar-row--actions-visible .market-quickbar-row__actions {
  opacity: 1;
}
@media (hover: none) {
  .market-quickbar-row__actions {
    opacity: 1;
  }
}
</style>
