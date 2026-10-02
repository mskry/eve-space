<script setup lang="ts" generic="T extends object">
import { TreeItem } from 'reka-ui'
import { useUiSortableTreeItem } from '../../composables/useUiSortableTreeItem'

const props = withDefaults(
  defineProps<{
    itemKey: string
    level: number
    value: T
    disabled?: boolean
  }>(),
  { disabled: false },
)
const emit = defineEmits<{
  select: [event: CustomEvent<{ originalEvent: Event }>]
}>()
const treeItem = ref<{ $el: Element } | null>(null)
const element = computed(() => {
  const node = treeItem.value?.$el
  return node instanceof HTMLElement ? node : null
})
const { dragging, instruction, indicatorStyle, pointerDown, keyboardMove } = useUiSortableTreeItem(
  element,
  {
    itemKey: computed(() => props.itemKey),
    disabled: computed(() => props.disabled),
  },
)
const keydown = (event: KeyboardEvent) => {
  if (props.disabled) return
  if (event.target instanceof Element && event.target.closest('input, textarea')) return
  keyboardMove(props.itemKey, event)
}
</script>

<template>
  <TreeItem
    ref="treeItem"
    v-slot="{ isExpanded }"
    class="ui-sortable-tree-item"
    :data-sortable-key="itemKey"
    :data-dragging="dragging || undefined"
    :aria-keyshortcuts="'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight'"
    :level="level"
    :value="value"
    @pointerdown="pointerDown"
    @keydown.capture="keydown"
    @select="emit('select', $event)"
  >
    <slot :is-expanded="isExpanded" />
    <span
      v-if="instruction"
      class="ui-sortable-tree-item__indicator"
      :data-instruction="instruction.type"
      :style="indicatorStyle"
      aria-hidden="true"
    />
  </TreeItem>
</template>

<style>
.ui-sortable-tree-item {
  position: relative;
  user-select: none;
}
.ui-sortable-tree-item input {
  user-select: text;
}
.ui-sortable-tree-item[data-dragging] {
  opacity: 0.45;
}
.ui-sortable-tree-item__indicator {
  position: absolute;
  right: 4px;
  pointer-events: none;
  border-color: var(--ui-primary);
  border-style: solid;
  border-width: 0;
}
.ui-sortable-tree-item__indicator[data-instruction='reorder-above'] {
  top: 0;
  border-top-width: 2px;
}
.ui-sortable-tree-item__indicator[data-instruction='reorder-below'],
.ui-sortable-tree-item__indicator[data-instruction='reparent'] {
  bottom: 0;
  border-bottom-width: 2px;
}
.ui-sortable-tree-item__indicator[data-instruction='make-child'] {
  inset-block: 0;
  border-width: 2px;
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
}
.ui-sortable-tree-preview {
  max-width: 20rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--ui-primary);
  background: var(--ui-surface-solid);
  color: var(--ui-text);
  font: 0.875rem/1.4 var(--ui-font-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
