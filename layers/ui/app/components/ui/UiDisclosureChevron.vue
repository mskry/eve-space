<script setup lang="ts">
const { open = false } = defineProps<{
  open?: boolean
}>()
</script>

<template>
  <svg
    class="ui-disclosure-chevron"
    :class="{ 'ui-disclosure-chevron--open': open }"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
</template>

<style scoped>
.ui-disclosure-chevron {
  width: 0.625rem;
  height: 0.625rem;
  flex: 0 0 0.625rem;
  fill: none;
  stroke: var(--ui-text-muted);
  stroke-width: 2.4;
  transition: transform 120ms ease;
}

.ui-disclosure-chevron--open {
  stroke: var(--ui-primary);
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .ui-disclosure-chevron {
    transition: none;
  }
}
</style>
