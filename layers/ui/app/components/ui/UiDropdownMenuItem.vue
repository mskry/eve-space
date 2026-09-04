<script setup lang="ts">
import { DropdownMenuItem } from 'reka-ui'

defineProps<{
  disabled?: boolean
  tone?: 'default' | 'danger'
}>()

const emit = defineEmits<{
  select: [event: Event]
}>()
</script>

<template>
  <DropdownMenuItem
    :class="['ui-dropdown-menu-item', { 'ui-dropdown-menu-item--danger': tone === 'danger' }]"
    :disabled="disabled"
    @select="emit('select', $event)"
  >
    <slot />
  </DropdownMenuItem>
</template>
