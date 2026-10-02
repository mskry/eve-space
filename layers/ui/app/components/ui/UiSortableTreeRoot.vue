<script setup lang="ts" generic="T extends object">
import { TreeRoot } from 'reka-ui'
import {
  canMoveUiSortableTree,
  indexUiSortableTree,
  keyboardUiSortableTreeMove,
  resolveUiSortableTreeMove,
  uiSortableTreeDataKey,
  type UiSortableTreeMove,
} from '../../composables/ui-sortable-tree'
import {
  uiSortableTreeKey,
  type UiSortableTreeContext,
} from '../../composables/ui-sortable-tree-context'

const props = withDefaults(
  defineProps<{
    expanded: string[]
    getChildren: (item: T) => T[] | undefined
    getKey: (item: T) => string
    getLabel: (item: T) => string
    items: T[]
    modelValue?: T
    indent?: number
    canMove?: (key: string, parentKey: string | null, beforeKey: string | null) => boolean
  }>(),
  { indent: 26 },
)
const emit = defineEmits<{
  'update:expanded': [keys: string[]]
  move: [key: string, parentKey: string | null, beforeKey: string | null]
}>()
defineOptions({ inheritAttrs: false })
const expandedKeys = ref([...props.expanded])
watch(
  () => props.expanded,
  (keys) => {
    expandedKeys.value = keys
  },
  { flush: 'sync' },
)
const setExpanded = (keys: string[]) => {
  expandedKeys.value = keys
  emit('update:expanded', keys)
}
const instanceId = useId()
const instructionsId = useId()
const zone = ref<HTMLElement | null>(null)
const rootOver = ref(false)
const announcement = ref('')
const index = computed(() =>
  indexUiSortableTree(props.items, props.getKey, props.getChildren, props.getLabel),
)
let collapsedKey: string | null = null

const allowed = (move: UiSortableTreeMove) =>
  canMoveUiSortableTree(index.value, move) &&
  (props.canMove?.(move.key, move.parentKey, move.beforeKey) ?? true)
const expand = (key: string) => {
  if (!expandedKeys.value.includes(key)) setExpanded([...expandedKeys.value, key])
}
const focusItem = async (key: string) => {
  await nextTick()
  const element = [
    ...(zone.value?.querySelectorAll<HTMLElement>('[data-sortable-key]') ?? []),
  ].find((node) => node.dataset.sortableKey === key)
  element?.focus()
}
const moveItem = (move: UiSortableTreeMove) => {
  if (!allowed(move)) return
  const label = index.value.get(move.key)?.label ?? 'Item'
  const destination = index.value.get(move.parentKey ?? '')?.label ?? 'root'
  const before = index.value.get(move.beforeKey ?? '')?.label
  const position = before ? `before ${before}` : 'at the end'
  emit('move', move.key, move.parentKey, move.beforeKey)
  if (move.parentKey !== null) expand(move.parentKey)
  announcement.value = `${label} moved in ${destination}, ${position}.`
  void focusItem(move.key)
}
const resolve: UiSortableTreeContext['resolve'] = (key, targetKey, instruction) => {
  const move = resolveUiSortableTreeMove(index.value, key, targetKey, instruction)
  return move && allowed(move) ? move : null
}
const finish = () => {
  rootOver.value = false
  if (collapsedKey !== null) expand(collapsedKey)
  collapsedKey = null
}
const findScrollContainer = () => {
  let element = zone.value?.parentElement ?? null
  while (element) {
    if (['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) return element
    element = element.parentElement
  }
  return null
}
provide(uiSortableTreeKey, {
  instanceId,
  indent: props.indent,
  index,
  expanded: expandedKeys,
  resolve,
  expand,
  start: (key) => {
    collapsedKey = expandedKeys.value.includes(key) ? key : null
    if (collapsedKey !== null) setExpanded(expandedKeys.value.filter((entry) => entry !== key))
  },
  keyboardMove: (key, event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !event.key.startsWith('Arrow')) return
    event.preventDefault()
    event.stopPropagation()
    const move = keyboardUiSortableTreeMove(index.value, key, event.key)
    if (move) moveItem(move)
  },
})

let cleanup: (() => void) | undefined
let disposed = false
onMounted(async () => {
  const [
    { dropTargetForElements, monitorForElements },
    { extractInstruction },
    { combine },
    { autoScrollForElements },
  ] = await Promise.all([
    import('@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'),
    import('@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'),
    import('@atlaskit/pragmatic-drag-and-drop/combine'),
    import('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'),
  ])
  if (disposed || !zone.value) return
  const cleanups = [
    dropTargetForElements({
      element: zone.value,
      canDrop: ({ source, input }) => {
        const key = uiSortableTreeDataKey(source.data, instanceId, index.value)
        if (!key) return false
        const overRow = [...(zone.value?.querySelectorAll('[data-sortable-key]') ?? [])].some(
          (node) => {
            const rect = node.getBoundingClientRect()
            return input.clientY >= rect.top && input.clientY <= rect.bottom
          },
        )
        return !overRow && allowed({ key, parentKey: null, beforeKey: null })
      },
      getData: () => ({ treeId: instanceId, root: true }),
      onDrag: ({ location, self }) => {
        rootOver.value = location.current.dropTargets[0]?.element === self.element
      },
      onDragLeave: () => {
        rootOver.value = false
      },
      onDrop: () => {
        rootOver.value = false
      },
    }),
    monitorForElements({
      canMonitor: ({ source }) => source.data.treeId === instanceId,
      onDrop: ({ source, location }) => {
        finish()
        const target = location.current.dropTargets[0]
        const key = uiSortableTreeDataKey(source.data, instanceId, index.value)
        if (!target || !key) return
        if (target.data.root === true) {
          moveItem({ key, parentKey: null, beforeKey: null })
          return
        }
        const instruction = extractInstruction(target.data)
        const targetKey = uiSortableTreeDataKey(target.data, instanceId, index.value)
        if (!instruction || !targetKey) return
        const move = resolve(key, targetKey, instruction)
        if (move) moveItem(move)
      },
    }),
  ]
  const scrollContainer = findScrollContainer()
  if (scrollContainer)
    cleanups.push(
      autoScrollForElements({
        element: scrollContainer,
        canScroll: ({ source }) => source.data.treeId === instanceId,
        getAllowedAxis: () => 'vertical',
      }),
    )
  cleanup = combine(...cleanups)
})
onBeforeUnmount(() => {
  disposed = true
  cleanup?.()
})
</script>

<template>
  <div ref="zone" class="ui-sortable-tree" :data-root-over="rootOver || undefined">
    <p :id="instructionsId" class="ui-sortable-tree__sr-only">
      Drag to reorder or move into folders. Use Alt and the arrow keys to move the focused item: up
      or down to reorder, right to nest, left to move up a level.
    </p>
    <TreeRoot
      v-slot="{ flattenItems }"
      v-bind="$attrs"
      :aria-describedby="instructionsId"
      :expanded="expandedKeys"
      :get-children="getChildren"
      :get-key="getKey"
      :items="items"
      :model-value="modelValue"
      @update:expanded="setExpanded"
    >
      <slot :flatten-items="flattenItems" />
    </TreeRoot>
    <output class="ui-sortable-tree__sr-only" aria-live="polite" aria-atomic="true">{{
      announcement
    }}</output>
  </div>
</template>

<style>
.ui-sortable-tree {
  min-height: 2rem;
  padding-bottom: 1.25rem;
}
.ui-sortable-tree > [role='tree'] {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ui-sortable-tree[data-root-over] {
  box-shadow: inset 0 -2px var(--ui-primary);
}
.ui-sortable-tree__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
