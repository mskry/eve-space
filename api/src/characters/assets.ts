import type { AssetSnapshot } from '@eve-space/core-eve-projections/assets'
import {
  combineEsiReadResultMetadata,
  toEsiReadResultMetadata,
  type EsiReadResult,
} from '../esi-gateway/feature-execution.js'
import {
  loadCharacterAssetPage,
  CharacterAssetsPaginationError,
  type CharacterAssetPageSnapshot,
} from './asset-pages.js'
import { enrichCharacterAssetWindow } from './asset-enrichment.js'
import { mapAssetBatches } from './asset-batches.js'
import { immediateAssetWork } from './asset-work.js'

const deduplicateAssets = (pages: readonly EsiReadResult<CharacterAssetPageSnapshot>[]) => {
  const assets = new Map<number, AssetSnapshot>()
  for (const page of pages) {
    for (const asset of page.data.assets)
      if (!assets.has(asset.itemId)) assets.set(asset.itemId, asset)
  }
  return [...assets.values()]
}

export const getCharacterAssets = async (
  characterId: number,
  subjectLifecycleId: string,
  signal?: AbortSignal,
) => {
  const work = immediateAssetWork(signal)
  const firstPage = await loadCharacterAssetPage(characterId, subjectLifecycleId, 1, work.signal)
  const pageNumbers = Array.from({ length: firstPage.data.totalPages - 1 }, (_, index) => index + 2)
  const remainingPages = await mapAssetBatches(pageNumbers, (page) =>
    loadCharacterAssetPage(characterId, subjectLifecycleId, page, work.signal),
  )
  const pages = [firstPage, ...remainingPages]
  if (pages.some((page) => page.data.totalPages !== firstPage.data.totalPages)) {
    throw new CharacterAssetsPaginationError()
  }

  const assets = deduplicateAssets(pages)
  const enriched = await enrichCharacterAssetWindow(characterId, subjectLifecycleId, assets, work)
  const metadata = combineEsiReadResultMetadata(pages.map(toEsiReadResultMetadata))
  const retryAt =
    metadata.refreshFailureClass === 'esi-cooldown'
      ? pages
          .flatMap((page) =>
            page.refreshFailureClass === 'esi-cooldown' && page.retryAt ? [page.retryAt] : [],
          )
          .toSorted((left, right) => left.localeCompare(right, 'en'))
          .at(-1)
      : undefined
  work.signal.throwIfAborted()
  return {
    ...enriched,
    characterId,
    ...metadata,
    ...(retryAt && { retryAt }),
  }
}
