<script setup lang="ts">
import { useUiTreeDragDrop, type UiTreeDropData } from '../../composables/useUiTreeDragDrop'

const props = defineProps<{
  dragScope: string
  dropId: string
}>()
const emit = defineEmits<{ drop: [data: UiTreeDropData, destinationId: string] }>()
const element = ref<HTMLElement | null>(null)
useUiTreeDragDrop(element, {
  scope: props.dragScope,
  dropId: props.dropId,
  onDrop: (data, destinationId) => emit('drop', data, destinationId),
})
</script>

<template>
  <div ref="element"><slot /></div>
</template>
