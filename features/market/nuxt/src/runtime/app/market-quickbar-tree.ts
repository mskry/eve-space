import type { MarketType } from './market-catalogue-types'
import {
  compareMarketQuickbarFolders,
  marketQuickbarItems,
  rootQuickbarFolderId,
  type MarketQuickbarState,
} from './market-quickbar'

export interface MarketQuickbarFolderNode {
  kind: 'folder'
  id: string
  name: string
  children: MarketQuickbarNode[]
}

export interface MarketQuickbarItemNode {
  kind: 'item'
  id: number
  item: MarketType
}

export type MarketQuickbarNode = MarketQuickbarFolderNode | MarketQuickbarItemNode

export const marketQuickbarNodeKey = (node: MarketQuickbarNode): string =>
  node.kind === 'folder' ? `folder:${node.id}` : `item:${node.id}`

export const marketQuickbarNodeChildren = (
  node: MarketQuickbarNode,
): MarketQuickbarNode[] | undefined => (node.kind === 'folder' ? node.children : undefined)

export const marketQuickbarFolderItemCount = (node: MarketQuickbarFolderNode): number =>
  node.children.reduce(
    (count, child) => count + (child.kind === 'folder' ? marketQuickbarFolderItemCount(child) : 1),
    0,
  )

export const buildMarketQuickbarTree = (
  state: MarketQuickbarState,
  typesById: ReadonlyMap<number, MarketType>,
): MarketQuickbarNode[] => {
  const buildChildren = (folderId: string): MarketQuickbarNode[] => {
    const folder = state[folderId]
    if (!folder) return []
    const nodes: MarketQuickbarNode[] = []
    for (const id of folder.childFolders.toSorted((left, right) =>
      compareMarketQuickbarFolders(state, left, right),
    )) {
      const child = state[id]
      if (child) nodes.push({ kind: 'folder', id, name: child.name, children: buildChildren(id) })
    }
    for (const item of marketQuickbarItems(state, folderId, typesById)) {
      nodes.push({ kind: 'item', id: item.id, item })
    }
    return nodes
  }
  return buildChildren(rootQuickbarFolderId)
}
