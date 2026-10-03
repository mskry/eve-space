import type {
  MarketObservedBook,
  MarketReadySide,
  MarketSide,
} from '../../src/runtime/app/market-models'

declare const observed: MarketObservedBook
const { profileRevision: revision, ...withoutRevision } = observed
// @ts-expect-error An observed book must carry its admitted profile revision.
const invalidBook: MarketObservedBook = withoutRevision
// @ts-expect-error A continued ready page must carry its opaque cursor.
const invalidPage: MarketReadySide = {
  kind: 'ready',
  rows: [],
  labelsComplete: true,
  error: null,
  hasMore: true,
}
// @ts-expect-error An unavailable side cannot carry successful rows or pagination.
const invalidSide: MarketSide = {
  kind: 'unavailable',
  error: 'UNAVAILABLE',
  rows: observed.sellers.rows,
  labelsComplete: false,
  hasMore: true,
  nextCursor: 'cursor',
}
void revision
void invalidBook
void invalidPage
void invalidSide
