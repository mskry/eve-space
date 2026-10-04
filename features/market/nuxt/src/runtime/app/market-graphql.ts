import type { GraphQLDocument } from '@eve-space/platform-module-nuxt/runtime'
export const marketGraphQLIdentity = [
  'db521f41b113d4aad6001b48d2a6032c247c070c04ce24435e638b2673e0a876',
  'b07176a4ef61276714d1fa21fbd9f1740979fe5b3b154e89d7da45104978a929',
] as const
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
export type MarketOrderSide = 'buy' | 'sell'

export type MarketItemQueryVariables = Exact<{
  revision: string
  typeId: string
}>

export type MarketItemQuery = {
  readonly market: {
    readonly catalogueType: {
      readonly revision: string
      readonly item: { readonly id: string; readonly groupId: string; readonly name: string }
    } | null
  } | null
}

export type MarketProfilesQueryVariables = Exact<{ [key: string]: never }>

export type MarketProfilesQuery = {
  readonly market: {
    readonly profiles: ReadonlyArray<{
      readonly profileId: string
      readonly revision: string
      readonly regionId: string
      readonly marketScope: string
      readonly mode: string
      readonly stationIds: ReadonlyArray<string>
      readonly watchedTypeIds: ReadonlyArray<string>
    }> | null
  } | null
}

export type MarketObservationFieldsFragment = {
  readonly observationId: string
  readonly profileId: string
  readonly regionId: string
  readonly typeId: string
  readonly observedAt: string
  readonly validatedAt: string
  readonly freshUntil: string
  readonly expectedPages: number
  readonly totalBookOrders: string
}

export type MarketOrderPageFieldsFragment = {
  readonly observationId: string
  readonly profileRevision: string
  readonly hasMore: boolean
  readonly nextCursor: string | null
  readonly labelsComplete: boolean
  readonly observation: {
    readonly observationId: string
    readonly profileId: string
    readonly regionId: string
    readonly typeId: string
    readonly observedAt: string
    readonly validatedAt: string
    readonly freshUntil: string
    readonly expectedPages: number
    readonly totalBookOrders: string
  }
  readonly rows: ReadonlyArray<{
    readonly orderId: string
    readonly side: MarketOrderSide
    readonly price: string
    readonly volumeRemain: string
    readonly locationId: string
    readonly solarSystemId: string | null
    readonly locationName: string | null
    readonly solarSystemSecurityStatus: number | null
    readonly issuedAt: string
    readonly durationDays: number
    readonly expiryAt: string
    readonly minimumVolume: string
    readonly range: string
  }>
}

export type MarketBookQueryVariables = Exact<{
  profileId: string
  typeId: string
}>

export type MarketBookQuery = {
  readonly market: {
    readonly book: {
      readonly profileId: string
      readonly profileRevision: string
      readonly typeId: string
      readonly status: string
      readonly collectionStatus: string
      readonly replacement: { readonly status: string; readonly attemptedAt: string } | null
      readonly observation: {
        readonly observationId: string
        readonly profileId: string
        readonly regionId: string
        readonly typeId: string
        readonly observedAt: string
        readonly validatedAt: string
        readonly freshUntil: string
        readonly expectedPages: number
        readonly totalBookOrders: string
      } | null
    } | null
  } | null
}

export type MarketInitialOrdersQueryVariables = Exact<{
  profileId: string
  typeId: string
  observationId: string
}>

export type MarketInitialOrdersQuery = {
  readonly market: {
    readonly sellers: {
      readonly observationId: string
      readonly profileRevision: string
      readonly hasMore: boolean
      readonly nextCursor: string | null
      readonly labelsComplete: boolean
      readonly observation: {
        readonly observationId: string
        readonly profileId: string
        readonly regionId: string
        readonly typeId: string
        readonly observedAt: string
        readonly validatedAt: string
        readonly freshUntil: string
        readonly expectedPages: number
        readonly totalBookOrders: string
      }
      readonly rows: ReadonlyArray<{
        readonly orderId: string
        readonly side: MarketOrderSide
        readonly price: string
        readonly volumeRemain: string
        readonly locationId: string
        readonly solarSystemId: string | null
        readonly locationName: string | null
        readonly solarSystemSecurityStatus: number | null
        readonly issuedAt: string
        readonly durationDays: number
        readonly expiryAt: string
        readonly minimumVolume: string
        readonly range: string
      }>
    } | null
    readonly buyers: {
      readonly observationId: string
      readonly profileRevision: string
      readonly hasMore: boolean
      readonly nextCursor: string | null
      readonly labelsComplete: boolean
      readonly observation: {
        readonly observationId: string
        readonly profileId: string
        readonly regionId: string
        readonly typeId: string
        readonly observedAt: string
        readonly validatedAt: string
        readonly freshUntil: string
        readonly expectedPages: number
        readonly totalBookOrders: string
      }
      readonly rows: ReadonlyArray<{
        readonly orderId: string
        readonly side: MarketOrderSide
        readonly price: string
        readonly volumeRemain: string
        readonly locationId: string
        readonly solarSystemId: string | null
        readonly locationName: string | null
        readonly solarSystemSecurityStatus: number | null
        readonly issuedAt: string
        readonly durationDays: number
        readonly expiryAt: string
        readonly minimumVolume: string
        readonly range: string
      }>
    } | null
  } | null
}

export type MarketOrderContinuationQueryVariables = Exact<{
  profileId: string
  typeId: string
  observationId: string
  side: MarketOrderSide
  after: string
}>

export type MarketOrderContinuationQuery = {
  readonly market: {
    readonly orders: {
      readonly observationId: string
      readonly profileRevision: string
      readonly hasMore: boolean
      readonly nextCursor: string | null
      readonly labelsComplete: boolean
      readonly observation: {
        readonly observationId: string
        readonly profileId: string
        readonly regionId: string
        readonly typeId: string
        readonly observedAt: string
        readonly validatedAt: string
        readonly freshUntil: string
        readonly expectedPages: number
        readonly totalBookOrders: string
      }
      readonly rows: ReadonlyArray<{
        readonly orderId: string
        readonly side: MarketOrderSide
        readonly price: string
        readonly volumeRemain: string
        readonly locationId: string
        readonly solarSystemId: string | null
        readonly locationName: string | null
        readonly solarSystemSecurityStatus: number | null
        readonly issuedAt: string
        readonly durationDays: number
        readonly expiryAt: string
        readonly minimumVolume: string
        readonly range: string
      }>
    } | null
  } | null
}

export type MarketHistoryQueryVariables = Exact<{
  profileId: string
  typeId: string
}>

export type MarketHistoryQuery = {
  readonly market: {
    readonly history: {
      readonly profileId: string
      readonly profileRevision: string
      readonly regionId: string
      readonly typeId: string
      readonly status: string
      readonly freshness: string
      readonly validatedAt: string | null
      readonly freshUntil: string | null
      readonly days: ReadonlyArray<{
        readonly date: string
        readonly averageIsk: string
        readonly highIsk: string
        readonly lowIsk: string
        readonly volume: string
        readonly orderCount: string
      }>
    } | null
  } | null
}

// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketBookDocument =
  'fragment MarketObservationFields on MarketObservation {\n  observationId\n  profileId\n  regionId\n  typeId\n  observedAt\n  validatedAt\n  freshUntil\n  expectedPages\n  totalBookOrders\n}\n\nquery MarketBook($profileId: UUID!, $typeId: EveId!) {\n  market {\n    book(profileId: $profileId, typeId: $typeId) {\n      profileId\n      profileRevision\n      typeId\n      status\n      collectionStatus\n      replacement {\n        status\n        attemptedAt\n      }\n      observation {\n        ...MarketObservationFields\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketBookQuery, MarketBookQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketHistoryDocument =
  'query MarketHistory($profileId: UUID!, $typeId: EveId!) {\n  market {\n    history(profileId: $profileId, typeId: $typeId) {\n      profileId\n      profileRevision\n      regionId\n      typeId\n      status\n      freshness\n      validatedAt\n      freshUntil\n      days {\n        date\n        averageIsk\n        highIsk\n        lowIsk\n        volume\n        orderCount\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketHistoryQuery, MarketHistoryQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketInitialOrdersDocument =
  'fragment MarketObservationFields on MarketObservation {\n  observationId\n  profileId\n  regionId\n  typeId\n  observedAt\n  validatedAt\n  freshUntil\n  expectedPages\n  totalBookOrders\n}\n\nfragment MarketOrderPageFields on MarketOrderPage {\n  observationId\n  profileRevision\n  observation {\n    ...MarketObservationFields\n  }\n  hasMore\n  nextCursor\n  labelsComplete\n  rows {\n    orderId\n    side\n    price\n    volumeRemain\n    locationId\n    solarSystemId\n    locationName\n    solarSystemSecurityStatus\n    issuedAt\n    durationDays\n    expiryAt\n    minimumVolume\n    range\n  }\n}\n\nquery MarketInitialOrders($profileId: UUID!, $typeId: EveId!, $observationId: UUID!) {\n  market {\n    sellers: orders(\n      profileId: $profileId\n      typeId: $typeId\n      observationId: $observationId\n      side: sell\n      first: 100\n    ) {\n      ...MarketOrderPageFields\n    }\n    buyers: orders(\n      profileId: $profileId\n      typeId: $typeId\n      observationId: $observationId\n      side: buy\n      first: 100\n    ) {\n      ...MarketOrderPageFields\n    }\n  }\n}' as string &
    GraphQLDocument<MarketInitialOrdersQuery, MarketInitialOrdersQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketItemDocument =
  'query MarketItem($revision: String!, $typeId: EveId!) {\n  market {\n    catalogueType(revision: $revision, typeId: $typeId) {\n      revision\n      item {\n        id\n        groupId\n        name\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketItemQuery, MarketItemQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketOrderContinuationDocument =
  'fragment MarketObservationFields on MarketObservation {\n  observationId\n  profileId\n  regionId\n  typeId\n  observedAt\n  validatedAt\n  freshUntil\n  expectedPages\n  totalBookOrders\n}\n\nfragment MarketOrderPageFields on MarketOrderPage {\n  observationId\n  profileRevision\n  observation {\n    ...MarketObservationFields\n  }\n  hasMore\n  nextCursor\n  labelsComplete\n  rows {\n    orderId\n    side\n    price\n    volumeRemain\n    locationId\n    solarSystemId\n    locationName\n    solarSystemSecurityStatus\n    issuedAt\n    durationDays\n    expiryAt\n    minimumVolume\n    range\n  }\n}\n\nquery MarketOrderContinuation($profileId: UUID!, $typeId: EveId!, $observationId: UUID!, $side: MarketOrderSide!, $after: String!) {\n  market {\n    orders(\n      profileId: $profileId\n      typeId: $typeId\n      observationId: $observationId\n      side: $side\n      first: 100\n      after: $after\n    ) {\n      ...MarketOrderPageFields\n    }\n  }\n}' as string &
    GraphQLDocument<MarketOrderContinuationQuery, MarketOrderContinuationQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketProfilesDocument =
  'query MarketProfiles {\n  market {\n    profiles {\n      profileId\n      revision\n      regionId\n      marketScope\n      mode\n      stationIds\n      watchedTypeIds\n    }\n  }\n}' as string &
    GraphQLDocument<MarketProfilesQuery, MarketProfilesQueryVariables>
