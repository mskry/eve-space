import { inject, type InjectionKey, type Ref } from 'vue'
import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'
import type { UiSortableTreeIndex, UiSortableTreeMove } from './ui-sortable-tree'

export interface UiSortableTreeContext {
  instanceId: string
  indent: number
  index: Readonly<Ref<UiSortableTreeIndex>>
  expanded: Readonly<Ref<string[]>>
  resolve: (key: string, targetKey: string, instruction: Instruction) => UiSortableTreeMove | null
  expand: (key: string) => void
  start: (key: string) => void
  keyboardMove: (key: string, event: KeyboardEvent) => void
}

export const uiSortableTreeKey: InjectionKey<UiSortableTreeContext> = Symbol('ui-sortable-tree')

export const useUiSortableTreeContext = () => {
  const context = inject(uiSortableTreeKey)
  if (!context) throw new Error('UiSortableTreeItem requires UiSortableTreeRoot')
  return context
}
