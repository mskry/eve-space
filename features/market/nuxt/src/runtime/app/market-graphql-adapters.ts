import {
  ApiQueryError,
  toGraphQLFieldError,
  type ApplicationGraphQLResult,
} from '@eve-space/platform-module-nuxt/runtime'
import type {
  MarketItemQuery,
  MarketProfilesQuery,
  MarketBookQuery,
  MarketHistoryQuery,
  MarketOrderPageFieldsFragment,
} from './market-graphql'
import {
  marketKnownState,
  marketSafeInteger,
  marketSafeTotal,
  marketExactPrice,
} from './market-graphql-values'
import { marketHistorySeries } from './market-history-presentation'
import type {
  MarketBookDiscovery,
  MarketContinuation,
  MarketDailyHistory,
  MarketObservation,
  MarketReadySide,
  MarketUnavailableSide,
} from './market-models'

type FieldPath = readonly (string | number)[]

export const marketField = <Result, Value>(
  envelope: ApplicationGraphQLResult<Result>,
  path: FieldPath,
  value: Value | null | undefined,
): Value => {
  const error = envelope.errors?.find(
    (entry) =>
      !entry.path ||
      entry.path
        .slice(0, Math.min(entry.path.length, path.length))
        .every((part, index) => path[index] === part),
  )
  if (error || value == null) {
    const rejectedOperation = Boolean(error) && !error?.path && envelope.data == null
    const fallbackStatus = rejectedOperation ? 400 : 502
    if (error) throw toGraphQLFieldError(error, fallbackStatus, 'MARKET_FIELD_UNAVAILABLE')
    throw new ApiQueryError('Market field is unavailable.', {
      status: fallbackStatus,
      code: 'MARKET_FIELD_UNAVAILABLE',
    })
  }
  return value
}

export const adaptMarketItem = (
  value: NonNullable<NonNullable<MarketItemQuery['market']>['catalogueType']>,
) => ({
  revision: value.revision,
  item: {
    ...value.item,
    id: marketSafeInteger(value.item.id),
    groupId: marketSafeInteger(value.item.groupId),
  },
})

export const adaptMarketProfiles = (
  values: NonNullable<NonNullable<MarketProfilesQuery['market']>['profiles']>,
) =>
  values.map((value) => ({
    ...value,
    revision: marketSafeInteger(value.revision),
    regionId: marketSafeInteger(value.regionId),
    marketScope: marketKnownState(value.marketScope, ['region', 'global-plex']),
    mode: marketKnownState(value.mode, ['region', 'watched-types']),
    stationIds: value.stationIds.map(marketSafeInteger),
    watchedTypeIds: value.watchedTypeIds.map(marketSafeInteger),
  }))

const adaptObservation = (
  value: MarketOrderPageFieldsFragment['observation'],
): MarketObservation => ({
  ...value,
  regionId: marketSafeInteger(value.regionId),
  typeId: marketSafeInteger(value.typeId),
  totalBookOrders: marketSafeInteger(value.totalBookOrders),
  expectedPages: marketSafeInteger(String(value.expectedPages)),
})

export const adaptMarketBook = (
  value: NonNullable<NonNullable<MarketBookQuery['market']>['book']>,
): MarketBookDiscovery => {
  const status = marketKnownState(value.status, ['current', 'stale', 'uncollected'])
  const base = {
    profileId: value.profileId,
    typeId: marketSafeInteger(value.typeId),
    profileRevision: marketSafeInteger(value.profileRevision),
    collectionStatus: marketKnownState(value.collectionStatus, ['ready', 'profile-failed']),
    replacement: value.replacement
      ? { ...value.replacement, status: marketKnownState(value.replacement.status, ['incomplete']) }
      : null,
  }
  if (status === 'uncollected') {
    if (value.observation) throw new Error('Uncollected Market book has an observation.')
    return { ...base, status, observation: null }
  }
  if (!value.observation) throw new Error('Market observation is missing.')
  return { ...base, status, observation: adaptObservation(value.observation) }
}

const adaptContinuation = (value: MarketOrderPageFieldsFragment): MarketContinuation => {
  if (!value.hasMore) return { hasMore: false, nextCursor: null }
  if (!value.nextCursor) throw new Error('Invalid Market continuation.')
  return { hasMore: true, nextCursor: value.nextCursor }
}

export const adaptMarketOrders = (value: MarketOrderPageFieldsFragment): MarketReadySide => {
  if (value.rows.length > 100) throw new Error('Invalid Market continuation.')
  const continuation = adaptContinuation(value)
  const rows = value.rows.map((row) => ({
    ...row,
    orderId: marketSafeInteger(row.orderId),
    side: marketKnownState(row.side, ['sell', 'buy']),
    price: marketExactPrice(row.price),
    durationDays: marketSafeInteger(String(row.durationDays)),
    volumeRemain: marketSafeInteger(row.volumeRemain),
    minimumVolume: marketSafeInteger(row.minimumVolume),
    locationId: marketSafeInteger(row.locationId),
    solarSystemId: row.solarSystemId === null ? null : marketSafeInteger(row.solarSystemId),
  }))
  marketSafeTotal(rows.map((row) => row.volumeRemain))
  return {
    rows,
    ...continuation,
    labelsComplete: value.labelsComplete,
    kind: 'ready' as const,
    error: null,
  }
}

export const unavailableMarketSide = (code: string): MarketUnavailableSide => ({
  rows: [],
  hasMore: false,
  nextCursor: null,
  labelsComplete: false,
  kind: 'unavailable',
  error: code,
})

export const adaptMarketHistory = (
  value: NonNullable<NonNullable<MarketHistoryQuery['market']>['history']>,
): MarketDailyHistory => {
  const days = value.days.map((day) => ({
    ...day,
    volume: marketSafeInteger(day.volume),
    orderCount: marketSafeInteger(day.orderCount),
  }))
  marketSafeTotal(days.map((day) => day.volume))
  marketSafeTotal(days.map((day) => day.orderCount))
  if (marketHistorySeries(days).length !== days.length)
    throw new Error('Unsupported Market history values.')
  return {
    ...value,
    days,
    regionId: marketSafeInteger(value.regionId),
    typeId: marketSafeInteger(value.typeId),
    status: marketKnownState(value.status, ['observed', 'uncollected']),
    freshness: marketKnownState(value.freshness, ['current', 'stale', 'uncollected']),
  }
}
