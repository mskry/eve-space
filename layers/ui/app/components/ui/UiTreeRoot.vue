<script setup lang="ts" generic="T extends object">
import { TreeRoot } from 'reka-ui'

defineProps<{
  expanded: string[]
  getChildren: (item: T) => T[] | undefined
  getKey: (item: T) => string
  items: T[]
  modelValue?: T
}>()

const emit = defineEmits<{ 'update:expanded': [keys: string[]] }>()
</script>

<template>
  <TreeRoot
    :expanded="expanded"
    :get-children="getChildren"
    :get-key="getKey"
    :items="items"
    :model-value="modelValue"
    @update:expanded="emit('update:expanded', $event)"
  >
    <slot />
  </TreeRoot>
</template>
