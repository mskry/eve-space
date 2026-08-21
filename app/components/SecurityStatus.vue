<script setup lang="ts">
const props = defineProps<{
  value: number
}>()

const roundedValue = computed(() => Number(props.value.toFixed(2)))
const label = computed(() => {
  if (roundedValue.value === 0) return '0.0'
  return `${roundedValue.value > 0 ? '+' : ''}${roundedValue.value}`
})
const tone = computed(() => {
  if (props.value >= 0) return 'positive'
  if (props.value <= -5) return 'danger'
  return 'warning'
})
</script>

<template>
  <span class="security-status" :class="`security-status--${tone}`">
    <slot name="icon" :label="label" :tone="tone" :value="value">
      <svg
        class="security-status-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="7" />
        <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </slot>
    <span class="security-status-label">
      <slot name="label" :label="label" :tone="tone" :value="value">
        <span class="sr-only">Security status:</span>
        {{ label }}
      </slot>
    </span>
    <slot name="after" :label="label" :tone="tone" :value="value" />
  </span>
</template>

<style scoped>
.security-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--security-status-color);
  font: 10px/1.2 var(--ui-font-mono);
  letter-spacing: 0.02em;
}

.security-status--positive {
  --security-status-color: var(--ui-primary);
}

.security-status--warning {
  --security-status-color: var(--ui-warning);
}

.security-status--danger {
  --security-status-color: var(--ui-danger);
}

.security-status-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}
</style>
