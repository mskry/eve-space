import type { OwnedReadBinding } from '../auth/read-admission.js'
import { toEsiReadResultMetadata } from '../esi-gateway/feature-execution.js'
import {
  assetFingerprint,
  AssetCursorRestartError,
  decodeAssetCursor,
  encodeAssetCursor,
  type AssetCursor,
} from './asset-cursor.js'
import { enrichCharacterAssetWindow } from './asset-enrichment.js'
import { loadCharacterAssetPage } from './asset-pages.js'
import type { CharacterAssetWindowWork } from './asset-work.js'

type AssetPage = Awaited<ReturnType<typeof loadCharacterAssetPage>>

const restartUnless = (valid: boolean): void => {
  if (!valid) throw new AssetCursorRestartError()
}

const readCursor = (binding: OwnedReadBinding, first: number, after: string | null) => {
  restartUnless(Number.isSafeInteger(first) && first >= 1 && first <= 100)
  if (after === null) return null
  const cursor = decodeAssetCursor(after)
  restartUnless(
    cursor.owner === binding.userId &&
      cursor.characterId === binding.character.characterId &&
      cursor.lifecycle === binding.character.subjectLifecycleId &&
      cursor.revision === binding.authorizationRevision &&
      Date.parse(cursor.expiresAt) > Date.now(),
  )
  return cursor
}

const isFresh = (page: AssetPage) => !page.stale && Date.parse(page.cachedUntil) > Date.now()

const checkSource = (anchor: AssetPage, selected: AssetPage, cursor: AssetCursor | null) => {
  restartUnless(anchor.data.assets.length <= 1000 && selected.data.assets.length <= 1000)
  restartUnless(selected.data.totalPages === anchor.data.totalPages)
  if (!cursor) return
  restartUnless(
    cursor.anchor === assetFingerprint(anchor) &&
      cursor.pages === anchor.data.totalPages &&
      isFresh(anchor),
  )
  restartUnless(isFresh(selected))
  if (cursor.selected) restartUnless(cursor.selected === assetFingerprint(selected))
  restartUnless(cursor.offset === 0 || cursor.offset < selected.data.assets.length)
}

const nextPageInfo = (
  binding: OwnedReadBinding,
  anchor: AssetPage,
  selected: AssetPage,
  cursor: AssetCursor | null,
  count: number,
) => {
  const nextOffset = (cursor?.offset ?? 0) + count
  const samePage = nextOffset < selected.data.assets.length
  const hasMore = samePage || selected.data.page < anchor.data.totalPages
  const expiresAt = [
    anchor.cachedUntil,
    selected.cachedUntil,
    cursor?.expiresAt ?? anchor.cachedUntil,
  ].toSorted((left, right) => left.localeCompare(right))[0]!
  const canContinue =
    hasMore && isFresh(anchor) && isFresh(selected) && Date.parse(expiresAt) > Date.now()
  if (!canContinue) return { hasNextPage: false, endCursor: null, restartRequired: hasMore }
  const endCursor = encodeAssetCursor({
    version: 1,
    owner: binding.userId,
    characterId: binding.character.characterId,
    lifecycle: binding.character.subjectLifecycleId,
    revision: binding.authorizationRevision,
    anchor: assetFingerprint(anchor),
    pages: anchor.data.totalPages,
    page: samePage ? selected.data.page : selected.data.page + 1,
    offset: samePage ? nextOffset : 0,
    selected: samePage ? assetFingerprint(selected) : null,
    expiresAt,
  })
  return { hasNextPage: true, endCursor, restartRequired: false }
}

export const readCharacterAssetConnection = async (
  binding: OwnedReadBinding,
  first: number,
  after: string | null,
  work: CharacterAssetWindowWork,
) => {
  const { characterId, subjectLifecycleId } = binding.character
  const cursor = readCursor(binding, first, after)
  const anchor = await work.run(() =>
    loadCharacterAssetPage(characterId, subjectLifecycleId, 1, work.signal),
  )
  if (cursor) checkSource(anchor, anchor, { ...cursor, selected: null, offset: 0 })
  const pageNumber = cursor?.page ?? 1
  const selected =
    pageNumber === 1
      ? anchor
      : await work.run(() =>
          loadCharacterAssetPage(characterId, subjectLifecycleId, pageNumber, work.signal),
        )
  checkSource(anchor, selected, cursor)
  const offset = cursor?.offset ?? 0
  const rows = selected.data.assets.slice(offset, offset + first)
  const enriched = await enrichCharacterAssetWindow(characterId, subjectLifecycleId, rows, work)
  work.signal.throwIfAborted()
  if (cursor) restartUnless(Date.parse(cursor.expiresAt) > Date.now())
  return {
    ...enriched,
    characterId,
    sourcePage: pageNumber,
    totalSourcePages: anchor.data.totalPages,
    anchor: assetFingerprint(anchor),
    anchorSource: toEsiReadResultMetadata(anchor),
    source: toEsiReadResultMetadata(selected),
    pageInfo: nextPageInfo(binding, anchor, selected, cursor, rows.length),
    completeness: 'source-page' as const,
  }
}
