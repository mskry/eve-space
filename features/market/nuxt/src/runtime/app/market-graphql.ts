import type { GraphQLDocument } from '@eve-space/platform-module-nuxt/runtime'
export const marketGraphQLIdentity = [
  '4adf6b274e370cb4df593458ccadea3169cca63f019ac0755b070b8af87cab9a',
  '1e9fc393a2127d14f2bc15fbb4dac646df04b84d6b6b1a1dfa9c679b10486423',
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

export type MarketIntelligenceGenerationFieldsFragment = {
  readonly generationId: string
  readonly profileRevision: string
  readonly policyRevision: string
  readonly formulaVersion: number
  readonly anchorDate: string
  readonly bookScope: string
  readonly historyScope: string
  readonly publishedAt: string
  readonly expiresAt: string | null
  readonly catalogueRevision: {
    readonly buildNumber: string
    readonly ingestVersion: number
    readonly ingestedAt: string
  }
}

export type MarketIntelligenceMetricFieldsFragment = {
  readonly value: string | null
  readonly nullReason: string | null
  readonly observedDays: number | null
  readonly windowDays: number | null
  readonly complete: boolean | null
}

export type MarketPriceMoversQueryVariables = Exact<{
  profileId: string
  after: string | null | undefined
}>

export type MarketPriceMoversQuery = {
  readonly market: {
    readonly intelligence: {
      readonly total: number
      readonly omittedNullSortCount: number
      readonly nextCursor: string | null
      readonly generation: {
        readonly generationId: string
        readonly profileRevision: string
        readonly policyRevision: string
        readonly formulaVersion: number
        readonly anchorDate: string
        readonly bookScope: string
        readonly historyScope: string
        readonly publishedAt: string
        readonly expiresAt: string | null
        readonly catalogueRevision: {
          readonly buildNumber: string
          readonly ingestVersion: number
          readonly ingestedAt: string
        }
      }
      readonly rows: ReadonlyArray<{
        readonly typeId: string
        readonly name: string
        readonly historySource: {
          readonly validatedAt: string | null
          readonly freshUntil: string | null
        }
        readonly metrics: {
          readonly weekPriceChangePercent: {
            readonly value: string | null
            readonly nullReason: string | null
            readonly observedDays: number | null
            readonly windowDays: number | null
            readonly complete: boolean | null
          }
        }
      }>
    } | null
  } | null
}

export type MarketSupplyQueryVariables = Exact<{
  profileId: string
  after: string | null | undefined
}>

export type MarketSupplyQuery = {
  readonly market: {
    readonly intelligence: {
      readonly total: number
      readonly omittedNullSortCount: number
      readonly nextCursor: string | null
      readonly generation: {
        readonly generationId: string
        readonly profileRevision: string
        readonly policyRevision: string
        readonly formulaVersion: number
        readonly anchorDate: string
        readonly bookScope: string
        readonly historyScope: string
        readonly publishedAt: string
        readonly expiresAt: string | null
        readonly catalogueRevision: {
          readonly buildNumber: string
          readonly ingestVersion: number
          readonly ingestedAt: string
        }
      }
      readonly rows: ReadonlyArray<{
        readonly typeId: string
        readonly name: string
        readonly historySource: {
          readonly validatedAt: string | null
          readonly freshUntil: string | null
        }
        readonly bookSource: {
          readonly observationId: string
          readonly validatedAt: string
          readonly freshUntil: string
        } | null
        readonly metrics: {
          readonly daysSupply10Percent: {
            readonly value: string | null
            readonly nullReason: string | null
            readonly observedDays: number | null
            readonly windowDays: number | null
            readonly complete: boolean | null
          }
        }
      }>
    } | null
  } | null
}

export type MarketUnderpricingQueryVariables = Exact<{
  profileId: string
  after: string | null | undefined
}>

export type MarketUnderpricingQuery = {
  readonly market: {
    readonly intelligence: {
      readonly total: number
      readonly omittedNullSortCount: number
      readonly nextCursor: string | null
      readonly generation: {
        readonly generationId: string
        readonly profileRevision: string
        readonly policyRevision: string
        readonly formulaVersion: number
        readonly anchorDate: string
        readonly bookScope: string
        readonly historyScope: string
        readonly publishedAt: string
        readonly expiresAt: string | null
        readonly catalogueRevision: {
          readonly buildNumber: string
          readonly ingestVersion: number
          readonly ingestedAt: string
        }
      }
      readonly rows: ReadonlyArray<{
        readonly typeId: string
        readonly name: string
        readonly historySource: {
          readonly validatedAt: string | null
          readonly freshUntil: string | null
        }
        readonly bookSource: {
          readonly observationId: string
          readonly validatedAt: string
          readonly freshUntil: string
        } | null
        readonly metrics: {
          readonly underpriceMonthPercent: {
            readonly value: string | null
            readonly nullReason: string | null
            readonly observedDays: number | null
            readonly windowDays: number | null
            readonly complete: boolean | null
          }
        }
      }>
    } | null
  } | null
}

export type MarketTradedValueQueryVariables = Exact<{
  profileId: string
  after: string | null | undefined
}>

export type MarketTradedValueQuery = {
  readonly market: {
    readonly intelligence: {
      readonly total: number
      readonly omittedNullSortCount: number
      readonly nextCursor: string | null
      readonly generation: {
        readonly generationId: string
        readonly profileRevision: string
        readonly policyRevision: string
        readonly formulaVersion: number
        readonly anchorDate: string
        readonly bookScope: string
        readonly historyScope: string
        readonly publishedAt: string
        readonly expiresAt: string | null
        readonly catalogueRevision: {
          readonly buildNumber: string
          readonly ingestVersion: number
          readonly ingestedAt: string
        }
      }
      readonly rows: ReadonlyArray<{
        readonly typeId: string
        readonly name: string
        readonly historySource: {
          readonly validatedAt: string | null
          readonly freshUntil: string | null
        }
        readonly metrics: {
          readonly anchorTradedValueIsk: {
            readonly value: string | null
            readonly nullReason: string | null
            readonly observedDays: number | null
            readonly windowDays: number | null
            readonly complete: boolean | null
          }
        }
      }>
    } | null
  } | null
}

export type MarketVolumeSpikesQueryVariables = Exact<{
  profileId: string
  after: string | null | undefined
}>

export type MarketVolumeSpikesQuery = {
  readonly market: {
    readonly intelligence: {
      readonly total: number
      readonly omittedNullSortCount: number
      readonly nextCursor: string | null
      readonly generation: {
        readonly generationId: string
        readonly profileRevision: string
        readonly policyRevision: string
        readonly formulaVersion: number
        readonly anchorDate: string
        readonly bookScope: string
        readonly historyScope: string
        readonly publishedAt: string
        readonly expiresAt: string | null
        readonly catalogueRevision: {
          readonly buildNumber: string
          readonly ingestVersion: number
          readonly ingestedAt: string
        }
      }
      readonly rows: ReadonlyArray<{
        readonly typeId: string
        readonly name: string
        readonly historySource: {
          readonly validatedAt: string | null
          readonly freshUntil: string | null
        }
        readonly metrics: {
          readonly anchorVolumeSpike: {
            readonly value: string | null
            readonly nullReason: string | null
            readonly observedDays: number | null
            readonly windowDays: number | null
            readonly complete: boolean | null
          }
        }
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
export const MarketPriceMoversDocument =
  'fragment MarketIntelligenceGenerationFields on MarketIntelligenceGeneration {\n  generationId\n  profileRevision\n  policyRevision\n  catalogueRevision {\n    buildNumber\n    ingestVersion\n    ingestedAt\n  }\n  formulaVersion\n  anchorDate\n  bookScope\n  historyScope\n  publishedAt\n  expiresAt\n}\n\nfragment MarketIntelligenceMetricFields on MarketIntelligenceMetric {\n  value\n  nullReason\n  observedDays\n  windowDays\n  complete\n}\n\nquery MarketPriceMovers($profileId: UUID!, $after: String) {\n  market {\n    intelligence(\n      input: {profileId: $profileId, sort: weekPriceChangePercent, first: 25, after: $after}\n    ) {\n      generation {\n        ...MarketIntelligenceGenerationFields\n      }\n      total\n      omittedNullSortCount\n      nextCursor\n      rows {\n        typeId\n        name\n        historySource {\n          validatedAt\n          freshUntil\n        }\n        metrics {\n          weekPriceChangePercent {\n            ...MarketIntelligenceMetricFields\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketPriceMoversQuery, MarketPriceMoversQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketProfilesDocument =
  'query MarketProfiles {\n  market {\n    profiles {\n      profileId\n      revision\n      regionId\n      marketScope\n      mode\n      stationIds\n      watchedTypeIds\n    }\n  }\n}' as string &
    GraphQLDocument<MarketProfilesQuery, MarketProfilesQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketSupplyDocument =
  'fragment MarketIntelligenceGenerationFields on MarketIntelligenceGeneration {\n  generationId\n  profileRevision\n  policyRevision\n  catalogueRevision {\n    buildNumber\n    ingestVersion\n    ingestedAt\n  }\n  formulaVersion\n  anchorDate\n  bookScope\n  historyScope\n  publishedAt\n  expiresAt\n}\n\nfragment MarketIntelligenceMetricFields on MarketIntelligenceMetric {\n  value\n  nullReason\n  observedDays\n  windowDays\n  complete\n}\n\nquery MarketSupply($profileId: UUID!, $after: String) {\n  market {\n    intelligence(\n      input: {profileId: $profileId, sort: daysSupply10Percent, direction: ASC, first: 25, after: $after}\n    ) {\n      generation {\n        ...MarketIntelligenceGenerationFields\n      }\n      total\n      omittedNullSortCount\n      nextCursor\n      rows {\n        typeId\n        name\n        historySource {\n          validatedAt\n          freshUntil\n        }\n        bookSource {\n          observationId\n          validatedAt\n          freshUntil\n        }\n        metrics {\n          daysSupply10Percent {\n            ...MarketIntelligenceMetricFields\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketSupplyQuery, MarketSupplyQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketTradedValueDocument =
  'fragment MarketIntelligenceGenerationFields on MarketIntelligenceGeneration {\n  generationId\n  profileRevision\n  policyRevision\n  catalogueRevision {\n    buildNumber\n    ingestVersion\n    ingestedAt\n  }\n  formulaVersion\n  anchorDate\n  bookScope\n  historyScope\n  publishedAt\n  expiresAt\n}\n\nfragment MarketIntelligenceMetricFields on MarketIntelligenceMetric {\n  value\n  nullReason\n  observedDays\n  windowDays\n  complete\n}\n\nquery MarketTradedValue($profileId: UUID!, $after: String) {\n  market {\n    intelligence(\n      input: {profileId: $profileId, sort: anchorTradedValueIsk, first: 25, after: $after}\n    ) {\n      generation {\n        ...MarketIntelligenceGenerationFields\n      }\n      total\n      omittedNullSortCount\n      nextCursor\n      rows {\n        typeId\n        name\n        historySource {\n          validatedAt\n          freshUntil\n        }\n        metrics {\n          anchorTradedValueIsk {\n            ...MarketIntelligenceMetricFields\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketTradedValueQuery, MarketTradedValueQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketUnderpricingDocument =
  'fragment MarketIntelligenceGenerationFields on MarketIntelligenceGeneration {\n  generationId\n  profileRevision\n  policyRevision\n  catalogueRevision {\n    buildNumber\n    ingestVersion\n    ingestedAt\n  }\n  formulaVersion\n  anchorDate\n  bookScope\n  historyScope\n  publishedAt\n  expiresAt\n}\n\nfragment MarketIntelligenceMetricFields on MarketIntelligenceMetric {\n  value\n  nullReason\n  observedDays\n  windowDays\n  complete\n}\n\nquery MarketUnderpricing($profileId: UUID!, $after: String) {\n  market {\n    intelligence(\n      input: {profileId: $profileId, sort: underpriceMonthPercent, direction: ASC, first: 25, after: $after}\n    ) {\n      generation {\n        ...MarketIntelligenceGenerationFields\n      }\n      total\n      omittedNullSortCount\n      nextCursor\n      rows {\n        typeId\n        name\n        historySource {\n          validatedAt\n          freshUntil\n        }\n        bookSource {\n          observationId\n          validatedAt\n          freshUntil\n        }\n        metrics {\n          underpriceMonthPercent {\n            ...MarketIntelligenceMetricFields\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketUnderpricingQuery, MarketUnderpricingQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const MarketVolumeSpikesDocument =
  'fragment MarketIntelligenceGenerationFields on MarketIntelligenceGeneration {\n  generationId\n  profileRevision\n  policyRevision\n  catalogueRevision {\n    buildNumber\n    ingestVersion\n    ingestedAt\n  }\n  formulaVersion\n  anchorDate\n  bookScope\n  historyScope\n  publishedAt\n  expiresAt\n}\n\nfragment MarketIntelligenceMetricFields on MarketIntelligenceMetric {\n  value\n  nullReason\n  observedDays\n  windowDays\n  complete\n}\n\nquery MarketVolumeSpikes($profileId: UUID!, $after: String) {\n  market {\n    intelligence(\n      input: {profileId: $profileId, sort: anchorVolumeSpike, first: 25, after: $after}\n    ) {\n      generation {\n        ...MarketIntelligenceGenerationFields\n      }\n      total\n      omittedNullSortCount\n      nextCursor\n      rows {\n        typeId\n        name\n        historySource {\n          validatedAt\n          freshUntil\n        }\n        metrics {\n          anchorVolumeSpike {\n            ...MarketIntelligenceMetricFields\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<MarketVolumeSpikesQuery, MarketVolumeSpikesQueryVariables>
