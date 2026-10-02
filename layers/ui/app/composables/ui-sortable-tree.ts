import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'
import type { DropTargetRecord } from '@atlaskit/pragmatic-drag-and-drop/types'

export interface UiSortableTreeEntry {
  key: string
  parentKey: string | null
  level: number
  children: string[]
  canHaveChildren: boolean
  label: string
}

export interface UiSortableTreeMove {
  key: string
  parentKey: string | null
  beforeKey: string | null
}

export type UiSortableTreeIndex = ReadonlyMap<string, UiSortableTreeEntry>

export const uiSortableTreeDataKey = (
  data: DropTargetRecord['data'],
  treeId: string,
  index: UiSortableTreeIndex,
): string | undefined => {
  if (data.treeId !== treeId) return undefined
  return [...index.keys()].find((key) => key === data.key)
}

export const indexUiSortableTree = <T>(
  items: readonly T[],
  getKey: (item: T) => string,
  getChildren: (item: T) => T[] | undefined,
  getLabel: (item: T) => string,
): UiSortableTreeIndex => {
  const entries = new Map<string, UiSortableTreeEntry>()
  const visit = (children: readonly T[], parentKey: string | null, level: number) => {
    for (const item of children) {
      const key = getKey(item)
      const descendants = getChildren(item)
      entries.set(key, {
        key,
        parentKey,
        level,
        children: (descendants ?? []).map(getKey),
        canHaveChildren: descendants !== undefined,
        label: getLabel(item),
      })
      visit(descendants ?? [], key, level + 1)
    }
  }
  visit(items, null, 1)
  return entries
}

export const uiSortableTreeSiblings = (index: UiSortableTreeIndex, parentKey: string | null) => {
  if (parentKey !== null) return index.get(parentKey)?.children ?? []
  return [...index.values()].filter((entry) => entry.parentKey === null).map((entry) => entry.key)
}

export const canMoveUiSortableTree = (index: UiSortableTreeIndex, move: UiSortableTreeMove) => {
  const entry = index.get(move.key)
  if (!entry || move.key === move.beforeKey) return false
  if (move.parentKey !== null && !index.get(move.parentKey)?.canHaveChildren) return false
  let parentKey = move.parentKey
  while (parentKey !== null) {
    if (parentKey === move.key) return false
    parentKey = index.get(parentKey)?.parentKey ?? null
  }
  const siblings = uiSortableTreeSiblings(index, move.parentKey)
  if (move.beforeKey !== null && !siblings.includes(move.beforeKey)) return false
  const position = siblings.indexOf(move.key)
  const nextKey = siblings[position + 1] ?? null
  return entry.parentKey !== move.parentKey || position < 0 || nextKey !== move.beforeKey
}

export const resolveUiSortableTreeMove = (
  index: UiSortableTreeIndex,
  key: string,
  targetKey: string,
  instruction: Instruction,
): UiSortableTreeMove | null => {
  let target = index.get(targetKey)
  if (!target || key === targetKey || instruction.type === 'instruction-blocked') return null
  if (instruction.type === 'make-child') {
    return { key, parentKey: targetKey, beforeKey: target.children[0] ?? null }
  }
  if (instruction.type === 'reparent') {
    while (target.level > instruction.desiredLevel + 1) {
      const parent = index.get(target.parentKey ?? '')
      if (!parent) return null
      target = parent
    }
  }
  const siblings = uiSortableTreeSiblings(index, target.parentKey)
  const beforeKey =
    instruction.type === 'reorder-above'
      ? target.key
      : (siblings[siblings.indexOf(target.key) + 1] ?? null)
  return { key, parentKey: target.parentKey, beforeKey }
}

export const keyboardUiSortableTreeMove = (
  index: UiSortableTreeIndex,
  key: string,
  direction: string,
): UiSortableTreeMove | null => {
  const entry = index.get(key)
  if (!entry) return null
  const siblings = uiSortableTreeSiblings(index, entry.parentKey)
  const position = siblings.indexOf(key)
  if (direction === 'ArrowUp' && position > 0) {
    return { key, parentKey: entry.parentKey, beforeKey: siblings[position - 1]! }
  }
  if (direction === 'ArrowDown' && position < siblings.length - 1) {
    return { key, parentKey: entry.parentKey, beforeKey: siblings[position + 2] ?? null }
  }
  if (direction === 'ArrowRight' && position > 0) {
    return { key, parentKey: siblings[position - 1]!, beforeKey: null }
  }
  const parent = index.get(entry.parentKey ?? '')
  if (direction !== 'ArrowLeft' || !parent) return null
  const uncles = uiSortableTreeSiblings(index, parent.parentKey)
  return {
    key,
    parentKey: parent.parentKey,
    beforeKey: uncles[uncles.indexOf(parent.key) + 1] ?? null,
  }
}
