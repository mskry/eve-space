import { computed, onBeforeUnmount, onMounted, ref, watchEffect, type Ref } from 'vue'
import type { Instruction, ItemMode } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'
import type { DropTargetRecord } from '@atlaskit/pragmatic-drag-and-drop/types'
import type { ElementDragPayload } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { useUiSortableTreeContext } from './ui-sortable-tree-context'
import { uiSortableTreeSiblings, uiSortableTreeDataKey } from './ui-sortable-tree'

export interface UiSortableTreeItemOptions {
  itemKey: Readonly<Ref<string>>
  disabled: Readonly<Ref<boolean>>
}

export const useUiSortableTreeItem = (
  element: Readonly<Ref<HTMLElement | null>>,
  options: UiSortableTreeItemOptions,
) => {
  const tree = useUiSortableTreeContext()
  const dragging = ref(false)
  const instruction = ref<Instruction | null>(null)
  const entry = computed(() => tree.index.value.get(options.itemKey.value))
  const mode = computed<ItemMode>(() => {
    const item = entry.value
    if (item?.children.length && tree.expanded.value.includes(item.key)) return 'expanded'
    const siblings = uiSortableTreeSiblings(tree.index.value, item?.parentKey ?? null)
    return siblings.at(-1) === options.itemKey.value ? 'last-in-group' : 'standard'
  })
  const indicatorLevel = computed(() => {
    const current = instruction.value
    if (current?.type === 'reparent') return current.desiredLevel + 1
    return entry.value?.level ?? 1
  })
  const indicatorStyle = computed(() => ({
    left: `${(indicatorLevel.value - 1) * tree.indent + 14}px`,
  }))
  let stop: (() => void) | undefined
  let disposed = false
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let allowDrag = true
  const clearHover = () => {
    clearTimeout(hoverTimer)
    hoverTimer = undefined
  }
  const reset = () => {
    clearHover()
    instruction.value = null
  }
  const pointerDown = (event: PointerEvent) => {
    allowDrag = !(
      event.target instanceof Element &&
      event.target.closest('input, textarea, [data-sortable-no-drag]')
    )
  }
  onMounted(async () => {
    const [
      adapter,
      hitbox,
      { combine },
      { setCustomNativeDragPreview },
      { pointerOutsideOfPreview },
    ] = await Promise.all([
      import('@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'),
      import('@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'),
      import('@atlaskit/pragmatic-drag-and-drop/combine'),
      import('@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'),
      import('@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview'),
    ])
    if (disposed) return
    stop = watchEffect((onCleanup) => {
      const node = element.value
      if (!node) return
      const key = options.itemKey.value
      const showInstruction = (data: DropTargetRecord['data'], source: ElementDragPayload) => {
        const next = hitbox.extractInstruction(data)
        const sourceKey = uiSortableTreeDataKey(source.data, tree.instanceId, tree.index.value)
        instruction.value = sourceKey && next && tree.resolve(sourceKey, key, next) ? next : null
        if (instruction.value?.type !== 'make-child') {
          clearHover()
          return
        }
        if (hoverTimer !== undefined || tree.expanded.value.includes(key)) return
        hoverTimer = setTimeout(() => {
          tree.expand(key)
          hoverTimer = undefined
        }, 600)
      }
      const cleanup = combine(
        adapter.draggable({
          element: node,
          canDrag: () => !options.disabled.value && allowDrag,
          getInitialData: () => ({ treeId: tree.instanceId, key }),
          onDragStart: () => {
            dragging.value = true
            tree.start(key)
          },
          onDrop: () => {
            dragging.value = false
          },
          onGenerateDragPreview: ({ nativeSetDragImage }) => {
            setCustomNativeDragPreview({
              nativeSetDragImage,
              getOffset: pointerOutsideOfPreview({ x: '16px', y: '8px' }),
              render: ({ container }) => {
                const preview = document.createElement('div')
                preview.className = 'ui-sortable-tree-preview'
                preview.textContent = entry.value?.label ?? key
                container.append(preview)
              },
            })
          },
        }),
        adapter.dropTargetForElements({
          element: node,
          canDrop: ({ source }) => {
            if (
              options.disabled.value ||
              source.data.treeId !== tree.instanceId ||
              source.data.key === key
            )
              return false
            let ancestor: string | null = key
            while (ancestor !== null) {
              if (ancestor === source.data.key) return false
              ancestor = tree.index.value.get(ancestor)?.parentKey ?? null
            }
            return true
          },
          getData: ({ input, element: target }) => {
            const config = {
              input,
              element: target,
              currentLevel: (entry.value?.level ?? 1) - 1,
              indentPerLevel: tree.indent,
              mode: mode.value,
            }
            const data = { treeId: tree.instanceId, key }
            const result = hitbox.attachInstruction(data, config)
            if (
              entry.value?.canHaveChildren ||
              hitbox.extractInstruction(result)?.type !== 'make-child'
            )
              return result
            const rect = target.getBoundingClientRect()
            const clientY = input.clientY < rect.top + rect.height / 2 ? rect.top : rect.bottom
            return hitbox.attachInstruction(data, { ...config, input: { ...input, clientY } })
          },
          getIsSticky: () => true,
          onDrag: ({ self, source }) => showInstruction(self.data, source),
          onDragEnter: ({ self, source }) => showInstruction(self.data, source),
          onDragLeave: reset,
          onDrop: reset,
        }),
      )
      onCleanup(() => {
        cleanup()
        reset()
      })
    })
  })
  onBeforeUnmount(() => {
    disposed = true
    stop?.()
    reset()
  })
  return { dragging, instruction, indicatorStyle, pointerDown, keyboardMove: tree.keyboardMove }
}
