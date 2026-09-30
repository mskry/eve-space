import { inject, type InjectionKey, type Ref } from 'vue'
import type { MarketType } from './market-catalogue-types'
import {
  canMoveMarketQuickbarFolder,
  rootQuickbarFolderId,
  type MarketQuickbarDragData,
  type MarketQuickbarFolderOption,
  type MarketQuickbarState,
} from './market-quickbar'

interface MarketQuickbarImage {
  source: string
  sourceSet: string
}

export interface MarketQuickbarMoveTarget {
  id: string
  label: string
  current: boolean
  disabled: boolean
}

export interface MarketQuickbarPanelContext {
  state: Readonly<Ref<MarketQuickbarState>>
  folderOptions: Readonly<Ref<readonly MarketQuickbarFolderOption[]>>
  selectedId: Readonly<Ref<number | null>>
  editingFolderId: Ref<string | null>
  moveTargetKey: Ref<string | null>
  itemImage: (item: MarketType) => MarketQuickbarImage
  select: (item: MarketType) => void
  removeItem: (id: number) => void
  moveItem: (id: number, destinationId: string) => void
  moveFolder: (id: string, destinationId: string) => void
  renameFolder: (id: string, name: string) => void
  removeFolder: (id: string) => void
  toggleFolder: (id: string) => void
  drop: (data: MarketQuickbarDragData, destinationId: string) => void
}

export const marketQuickbarMoveTargets = (
  state: MarketQuickbarState,
  options: readonly MarketQuickbarFolderOption[],
  currentFolderId: string,
  movingFolderId?: string,
): MarketQuickbarMoveTarget[] =>
  options.map((option) => ({
    id: option.id,
    label: option.id === rootQuickbarFolderId ? 'No folder' : option.label,
    current: option.id === currentFolderId,
    disabled:
      movingFolderId !== undefined &&
      !canMoveMarketQuickbarFolder(state, movingFolderId, option.id),
  }))

export const marketQuickbarPanelKey: InjectionKey<MarketQuickbarPanelContext> =
  Symbol('market-quickbar-panel')

export const useMarketQuickbarPanel = () => {
  const context = inject(marketQuickbarPanelKey)
  if (!context) throw new Error('Market Quickbar rows must render inside MarketQuickbarPanel')
  return context
}
