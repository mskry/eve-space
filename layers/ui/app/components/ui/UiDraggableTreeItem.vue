<script setup lang="ts" generic="T extends object">
import {
  useUiTreeDragDrop,
  type UiTreeDragData,
  type UiTreeDropData,
} from '../../composables/useUiTreeDragDrop'
import UiTreeItem from './UiTreeItem.vue'

const props = defineProps<{
  dragData?: UiTreeDragData
  dragScope: string
  dropId?: string
  level: number
  value: T
}>()
const emit = defineEmits<{
  select: [event: CustomEvent<{ originalEvent: Event }>]
  drop: [data: UiTreeDropData, destinationId: string]
}>()
const treeItem = ref<{ $el: Element } | null>(null)
const dragData = props.dragData
const element = computed(() => {
  const node = treeItem.value?.$el
  return node instanceof HTMLElement ? node : null
})
useUiTreeDragDrop(element, {
  scope: props.dragScope,
  dragData: dragData ? () => dragData : undefined,
  dropId: props.dropId,
  onDrop: (data, destinationId) => emit('drop', data, destinationId),
})
</script>

<template>
  <UiTreeItem
    ref="treeItem"
    v-slot="{ isExpanded }"
    :level="level"
    :value="value"
    @select="emit('select', $event)"
  >
    <slot :is-expanded="isExpanded" />
  </UiTreeItem>
</template>
