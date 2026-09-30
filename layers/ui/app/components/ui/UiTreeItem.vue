<script setup lang="ts" generic="T extends object">
import { TreeItem } from 'reka-ui'

defineProps<{
  level: number
  value: T
}>()

const emit = defineEmits<{
  select: [event: CustomEvent<{ originalEvent: Event }>]
}>()
</script>

<template>
  <TreeItem v-slot="{ isExpanded }" :level="level" :value="value" @select="emit('select', $event)">
    <slot :is-expanded="isExpanded" />
  </TreeItem>
</template>
