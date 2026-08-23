<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'icon' | 'badge' }>(), {
  variant: 'badge',
})
</script>

<template>
  <UiTooltip content="Main character" :arrow="false">
    <span v-if="variant === 'icon'" class="main-mark main-mark--icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="m3.5 8 4.5 4 4-7 4 7 4.5-4-1.5 9H5L3.5 8Z" />
        <path d="M5 20h14" />
      </svg>
    </span>
    <span v-else class="main-mark main-mark--badge">MAIN</span>
  </UiTooltip>
</template>

<style scoped>
.main-mark {
  flex: 0 0 auto;
}

.main-mark--icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--ui-primary);
  opacity: 0.85;
}

.main-mark--icon svg {
  width: 14px;
  height: 14px;
}

.main-mark--badge {
  position: relative;
  z-index: 1;
  top: -0.45em;
  padding: 4px 7px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 44%, transparent);
  color: var(--ui-primary);
  font: 700 7px/1 var(--ui-font-mono);
  letter-spacing: 0.1em;
}
</style>
