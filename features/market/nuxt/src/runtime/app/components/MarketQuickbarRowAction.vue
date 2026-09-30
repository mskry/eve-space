<script setup lang="ts">
const {
  icon,
  label,
  tone = 'default',
} = defineProps<{
  icon: 'rename' | 'delete' | 'move' | 'remove'
  label: string
  tone?: 'default' | 'danger'
}>()
const emit = defineEmits<{ run: [] }>()
const paths = {
  rename: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  delete: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  move: 'M3 6h6l2 2h10v11H3zM10 13.5h6M13.5 11l2.5 2.5-2.5 2.5',
  remove: 'M6 6l12 12M18 6 6 18',
} as const
</script>

<template>
  <button
    type="button"
    class="market-quickbar-row-action"
    :class="{ 'market-quickbar-row-action--danger': tone === 'danger' }"
    :aria-label="label"
    :title="label"
    @click.stop="emit('run')"
    @keydown.enter.stop
    @keydown.space.stop
  >
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path :d="paths[icon]" />
    </svg>
  </button>
</template>

<style scoped>
.market-quickbar-row-action {
  width: 1.625rem;
  height: 1.625rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}
.market-quickbar-row-action:hover,
.market-quickbar-row-action:focus-visible,
.market-quickbar-row-action[aria-expanded='true'] {
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
  color: var(--ui-primary);
}
.market-quickbar-row-action--danger:hover,
.market-quickbar-row-action--danger:focus-visible {
  background: color-mix(in srgb, var(--ui-danger) 10%, transparent);
  color: var(--ui-danger);
}
.market-quickbar-row-action:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.market-quickbar-row-action svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}
</style>
