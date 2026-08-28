<script setup lang="ts">
withDefaults(
  defineProps<{
    code?: string
    compact?: boolean
    role?: 'alert' | 'status'
    title?: string
    tone?: 'default' | 'error'
  }>(),
  {
    code: '',
    compact: false,
    role: undefined,
    title: '',
    tone: 'default',
  },
)
</script>

<template>
  <div
    class="ui-state-panel"
    :class="{
      'ui-state-panel--compact': compact,
      'ui-state-panel--error': tone === 'error',
    }"
    :role="role"
  >
    <slot name="icon" />
    <span v-if="code" class="ui-state-panel-code">{{ code }}</span>
    <h2 v-if="title">{{ title }}</h2>
    <slot />
    <slot name="action" />
  </div>
</template>
