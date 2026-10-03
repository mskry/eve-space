import type { MarketDay } from './market-history-presentation'
import type { MarketOrderPresentation } from './market-order-presentation'

export interface MarketOrderRow extends MarketOrderPresentation {
  readonly durationDays: number
  readonly solarSystemId: number | null
  readonly solarSystemSecurityStatus: number | null
}

export type MarketContinuation =
  | { readonly hasMore: true; readonly nextCursor: string }
  | { readonly hasMore: false; readonly nextCursor: null }

export type MarketReadySide = MarketContinuation & {
  readonly kind: 'ready'
  readonly rows: readonly MarketOrderRow[]
  readonly labelsComplete: boolean
  readonly error: string | null
}

export interface MarketUnavailableSide {
  readonly kind: 'unavailable'
  readonly rows: readonly []
  readonly hasMore: false
  readonly nextCursor: null
  readonly labelsComplete: false
  readonly error: string
}

export type MarketSide = MarketReadySide | MarketUnavailableSide

export interface MarketObservation {
  readonly observationId: string
  readonly profileId: string
  readonly regionId: number
  readonly typeId: number
  readonly observedAt: string
  readonly validatedAt: string
  readonly freshUntil: string
  readonly expectedPages: number
  readonly totalBookOrders: number
}

interface MarketCollectionState {
  readonly collectionStatus: 'ready' | 'profile-failed'
  readonly replacement: {
    readonly status: 'incomplete'
    readonly attemptedAt: string
  } | null
}

interface MarketUncollectedBook extends MarketCollectionState {
  readonly status: 'uncollected'
}

export interface MarketObservedBook extends MarketCollectionState {
  readonly status: 'current' | 'stale'
  readonly profileRevision: number
  readonly observation: MarketObservation
  readonly sellers: MarketSide
  readonly buyers: MarketSide
}

export type MarketBook = MarketUncollectedBook | MarketObservedBook

type MarketDiscoveredObservation =
  | { readonly status: 'uncollected'; readonly observation: null }
  | { readonly status: 'current' | 'stale'; readonly observation: MarketObservation }

export type MarketBookDiscovery = MarketCollectionState &
  MarketDiscoveredObservation & {
    readonly profileId: string
    readonly profileRevision: number
    readonly typeId: number
  }

export interface MarketDailyHistory {
  readonly regionId: number
  readonly typeId: number
  readonly status: 'observed' | 'uncollected'
  readonly freshness: 'current' | 'stale' | 'uncollected'
  readonly validatedAt: string | null
  readonly freshUntil: string | null
  readonly days: readonly MarketDay[]
}
