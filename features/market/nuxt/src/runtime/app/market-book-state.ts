import type { MarketBook } from './market-models'

export const marketBookState = (book: MarketBook | null, unavailable: boolean) => {
  if (!book)
    return {
      coverage: unavailable ? 'unavailable' : 'loading',
      freshness: null,
      profileFailed: false,
      replacementIncomplete: false,
    }
  if (book.status === 'uncollected') {
    return {
      coverage: 'uncollected',
      freshness: null,
      profileFailed: book.collectionStatus === 'profile-failed',
      replacementIncomplete: book.replacement !== null,
    }
  }
  const empty =
    book.sellers.kind !== 'unavailable' &&
    book.buyers.kind !== 'unavailable' &&
    book.sellers.rows.length === 0 &&
    book.buyers.rows.length === 0 &&
    !book.sellers.hasMore &&
    !book.buyers.hasMore
  return {
    coverage: empty ? 'observed-empty' : 'observed',
    freshness: book.status,
    profileFailed: book.collectionStatus === 'profile-failed',
    replacementIncomplete: book.replacement !== null,
  }
}
