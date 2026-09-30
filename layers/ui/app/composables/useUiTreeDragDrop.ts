import { onMounted, onUnmounted, type Ref } from 'vue'

export interface UiTreeDropData {
  scope: string
  kind: string
  id: string
}

export interface UiTreeDragData {
  kind: string
  id: string
}

interface UiTreeDragDropOptions {
  scope: string
  dragData?: () => UiTreeDragData
  dropId?: string
  onDrop?: (data: UiTreeDropData, destinationId: string) => void
}

export const useUiTreeDragDrop = (
  element: Ref<HTMLElement | null>,
  options: UiTreeDragDropOptions,
) => {
  let cleanup: (() => void) | undefined
  onMounted(async () => {
    const node = element.value
    if (!node) return
    const { draggable, dropTargetForElements } =
      await import('@atlaskit/pragmatic-drag-and-drop/element/adapter')
    if (element.value !== node) return
    const cleanups: Array<() => void> = []
    if (options.dragData) {
      cleanups.push(
        draggable({
          element: node,
          getInitialData: () => ({ scope: options.scope, ...options.dragData?.() }),
        }),
      )
    }
    const dropId = options.dropId
    if (dropId && options.onDrop) {
      cleanups.push(
        dropTargetForElements({
          element: node,
          canDrop: ({ source }) => source.data.scope === options.scope,
          onDrop: ({ location, self, source }) => {
            if (location.current.dropTargets[0]?.element !== self.element) return
            const { kind, id } = source.data
            if (typeof kind !== 'string' || typeof id !== 'string') return
            options.onDrop?.({ scope: options.scope, kind, id }, dropId)
          },
        }),
      )
    }
    cleanup = () => cleanups.forEach((dispose) => dispose())
  })
  onUnmounted(() => cleanup?.())
}
