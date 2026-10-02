import {
  canMoveMarketQuickbarFolder,
  copyMarketQuickbar,
  decodeMarketQuickbar,
  marketQuickbarChildKeys,
  rootQuickbarFolderId,
  type MarketQuickbarState,
} from './market-quickbar'

interface QuickbarSortPlacement {
  sourceId: string
  destinationId: string
  folder: boolean
  id: string
  order: string[]
}

const destinationFolderId = (parentKey: string | null): string | null => {
  if (parentKey === null) return rootQuickbarFolderId
  return parentKey.startsWith('folder:') ? parentKey.slice(7) : null
}

const findPlacement = (
  state: MarketQuickbarState,
  key: string,
  parentKey: string | null,
  beforeKey: string | null,
): QuickbarSortPlacement | null => {
  const destinationId = destinationFolderId(parentKey)
  if (!destinationId) return null
  const sourceId = Object.keys(state).find((id) =>
    marketQuickbarChildKeys(state[id]!).includes(key),
  )
  const destination = state[destinationId]
  if (!sourceId || !destination || key === beforeKey) return null
  const folder = key.startsWith('folder:')
  const id = key.slice(folder ? 7 : 5)
  if (folder && !canMoveMarketQuickbarFolder(state, id, destinationId)) return null
  const order = marketQuickbarChildKeys(destination).filter((entry) => entry !== key)
  const index = beforeKey === null ? order.length : order.indexOf(beforeKey)
  if (index < 0) return null
  order.splice(index, 0, key)
  return { sourceId, destinationId, folder, id, order }
}

export const sortMarketQuickbar = (
  state: MarketQuickbarState,
  key: string,
  parentKey: string | null,
  beforeKey: string | null,
): MarketQuickbarState => {
  const placement = findPlacement(state, key, parentKey, beforeKey)
  if (!placement) return state
  const { sourceId, destinationId, folder, id, order } = placement
  const unchangedOrder =
    JSON.stringify(order) === JSON.stringify(marketQuickbarChildKeys(state[destinationId]!))
  if (sourceId === destinationId && unchangedOrder) return state
  const next = copyMarketQuickbar(state)
  const source = next[sourceId]!
  const target = next[destinationId]!
  source.order = marketQuickbarChildKeys(source).filter((entry) => entry !== key)
  if (folder) {
    source.childFolders = source.childFolders.filter((entry) => entry !== id)
    target.childFolders.push(id)
  } else {
    source.types = source.types.filter((entry) => entry !== Number(id))
    target.types.push(Number(id))
  }
  target.order = order
  return decodeMarketQuickbar(next) ?? state
}
