<script setup lang="ts">
import type { MarketQuickbarMoveTarget } from '../market-quickbar-panel-context'

defineProps<{ label: string; targets: readonly MarketQuickbarMoveTarget[] }>()
const emit = defineEmits<{ pick: [id: string] }>()
</script>

<template>
  <div class="market-quickbar-move-targets" role="group" :aria-label="label" @click.stop>
    <span class="market-quickbar-move-targets__heading" aria-hidden="true">Move to</span>
    <button
      v-for="target in targets"
      :key="target.id"
      type="button"
      :aria-pressed="target.current"
      :disabled="target.disabled"
      @click="emit('pick', target.id)"
      @keydown.enter.stop
      @keydown.space.stop
    >
      {{ target.label }}
    </button>
  </div>
</template>

<style scoped>
.market-quickbar-move-targets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.375rem 0.625rem 0.5625rem var(--market-quickbar-indent, 0.875rem);
  background: color-mix(in srgb, var(--ui-primary) 5%, transparent);
}
.market-quickbar-move-targets__heading {
  width: 100%;
  color: var(--ui-text-muted);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.market-quickbar-move-targets button {
  max-width: 100%;
  padding: 0.3125rem 0.5rem;
  overflow: hidden;
  border: 1px solid var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text);
  font: 0.8125rem/1.1 var(--ui-font-body);
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.market-quickbar-move-targets button:hover:not(:disabled),
.market-quickbar-move-targets button[aria-pressed='true'] {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}
.market-quickbar-move-targets button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.market-quickbar-move-targets button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}
</style>
