<script setup lang="ts">
import { ContextMenuItem } from 'reka-ui'

const { disabled = false, tone = 'default' } = defineProps<{
  disabled?: boolean
  tone?: 'default' | 'danger'
}>()

const emit = defineEmits<{
  select: [event: Event]
}>()
</script>

<template>
  <ContextMenuItem
    :class="['ui-context-menu-item', { 'ui-context-menu-item--danger': tone === 'danger' }]"
    :disabled="disabled"
    @select="emit('select', $event)"
  >
    <slot />
  </ContextMenuItem>
</template>
