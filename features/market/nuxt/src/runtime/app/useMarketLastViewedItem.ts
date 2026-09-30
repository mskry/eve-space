import { onMounted, onUnmounted, watch, type Ref } from 'vue'

const storageKey = 'eve-space-market-last-item-v1'

interface MarketLastViewedItemOptions {
  readonly itemId: Readonly<Ref<number | null>>
  readonly hasExplicitSelection: () => boolean
  readonly restore: (typeId: number) => void
}

const readLastViewedItem = () => {
  try {
    const stored = globalThis.localStorage.getItem(storageKey)
    if (!stored || stored.length > 16) return null
    const typeId = Number(stored)
    return Number.isSafeInteger(typeId) && typeId > 0 && String(typeId) === stored ? typeId : null
  } catch {
    return null
  }
}

const rememberItem = (typeId: number | null) => {
  if (typeId === null || !Number.isSafeInteger(typeId) || typeId <= 0) return
  try {
    globalThis.localStorage.setItem(storageKey, String(typeId))
  } catch {
    return
  }
}

export const useMarketLastViewedItem = ({
  itemId,
  hasExplicitSelection,
  restore,
}: MarketLastViewedItemOptions) => {
  let stopWatching: (() => void) | undefined
  onMounted(() => {
    if (!hasExplicitSelection()) {
      const typeId = readLastViewedItem()
      if (typeId !== null) restore(typeId)
    }
    stopWatching = watch(itemId, rememberItem, { immediate: true })
  })
  onUnmounted(() => stopWatching?.())
}
