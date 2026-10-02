import { expect, test } from 'vitest'
import {
  canMoveUiSortableTree,
  indexUiSortableTree,
  resolveUiSortableTreeMove,
} from '../../layers/ui/app/composables/ui-sortable-tree'

test('outdenting a last descendant inserts after its ancestor and rejects descendant cycles', () => {
  interface Node {
    key: string
    children?: Node[]
  }
  const nodes: Node[] = [
    { key: 'a', children: [{ key: 'b', children: [{ key: 'c' }] }] },
    { key: 'd' },
    { key: 'e' },
  ]
  const index = indexUiSortableTree(
    nodes,
    (node) => node.key,
    (node) => node.children,
    (node) => node.key,
  )
  const move = resolveUiSortableTreeMove(index, 'e', 'c', {
    type: 'reparent',
    currentLevel: 2,
    desiredLevel: 0,
    indentPerLevel: 26,
  })
  expect(move).toEqual({ key: 'e', parentKey: null, beforeKey: 'd' })
  expect(canMoveUiSortableTree(index, move!)).toBe(true)
  expect(canMoveUiSortableTree(index, { key: 'a', parentKey: 'b', beforeKey: null })).toBe(false)
})
