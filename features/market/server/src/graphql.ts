import {
  type PlatformGraphQLDefinition,
  type PlatformGraphQLResolver,
} from '@eve-space/platform-module-contract/graphql'
import {
  catalogueRevisionRead,
  catalogueTypeRead,
  catalogueGroupTypesRead,
} from './graphql-catalogue.js'
import { profilesRead, bookRead, ordersRead } from './graphql-book.js'
import { historyRead, referencePricesRead } from './graphql-statistics.js'
import { z } from 'zod'
import { marketReadInput } from './read-input.js'

const projectList =
  (property: string): PlatformGraphQLResolver =>
  ({ parent }) => {
    return marketReadInput(z.object({ [property]: z.array(z.unknown()) }), parent)[property]
  }

export const marketGraphQL: PlatformGraphQLDefinition = {
  typeDefs: `
    extend type Query { market: MarketRead }
    type MarketRead {
      catalogueRevision: MarketCatalogueRevision
      catalogueType(revision: String!, typeId: EveId!): MarketCatalogueTypeResult
      catalogueGroupTypes(revision: String!, groupId: EveId!, first: Int = 100, after: String): MarketCatalogueGroupPage
      profiles: [MarketProfile!]
      book(profileId: UUID!, typeId: EveId!): MarketBook
      orders(profileId: UUID!, typeId: EveId!, observationId: UUID!, side: MarketOrderSide!, first: Int = 100, after: String): MarketOrderPage
      history(profileId: UUID!, typeId: EveId!): MarketHistory
      referencePrices(typeIds: [EveId!]!): MarketReferencePrices
    }
    type MarketCatalogueRevision { key: String!, buildNumber: BigInteger!, ingestVersion: Int!, ingestedAt: UTCTime! }
    type MarketCatalogueType { id: EveId!, groupId: EveId!, name: String! }
    type MarketCatalogueTypeResult { revision: String!, item: MarketCatalogueType! }
    type MarketCatalogueGroupPage { revision: String!, groupId: EveId!, items: [MarketCatalogueType!]!, nextCursor: String }
    type MarketProfile { profileId: UUID!, revision: BigInteger!, regionId: EveId!, marketScope: String!, mode: String!, stationIds: [EveId!]!, watchedTypeIds: [EveId!]! }
    type MarketBook { profileId: UUID!, typeId: EveId!, profileRevision: BigInteger!, status: String!, collectionStatus: String!, replacement: MarketReplacement, observation: MarketObservation }
    type MarketReplacement { status: String!, attemptedAt: UTCTime! }
    type MarketObservation { observationId: UUID!, profileId: UUID!, regionId: EveId!, typeId: EveId!, observedAt: UTCTime!, validatedAt: UTCTime!, freshUntil: UTCTime!, expectedPages: Int!, totalBookOrders: BigInteger! }
    enum MarketOrderSide { sell buy }
    type MarketOrderPage { observationId: UUID!, profileRevision: BigInteger!, observation: MarketObservation!, rows: [MarketOrder!]!, hasMore: Boolean!, nextCursor: String, labelsComplete: Boolean! }
    type MarketOrder { orderId: EveId!, side: MarketOrderSide!, price: Decimal!, volumeRemain: BigInteger!, locationId: EveId!, solarSystemId: EveId, locationName: String, solarSystemSecurityStatus: Float, issuedAt: UTCTime!, durationDays: Int!, expiryAt: UTCTime!, minimumVolume: BigInteger!, range: String! }
    type MarketHistory { profileId: UUID!, profileRevision: BigInteger!, regionId: EveId!, typeId: EveId!, status: String!, freshness: String!, validatedAt: UTCTime, freshUntil: UTCTime, days: [MarketHistoryDay!]! }
    type MarketHistoryDay { date: UTCDate!, averageIsk: Decimal!, highIsk: Decimal!, lowIsk: Decimal!, volume: BigInteger!, orderCount: BigInteger! }
    type MarketReferencePrices { kind: String!, rows: [MarketReferencePrice!]! }
    type MarketReferencePrice { typeId: EveId!, adjustedPriceIsk: Decimal, averagePriceIsk: Decimal, sourceHour: UTCTime!, validatedAt: UTCTime! }
  `,
  reads: {
    'Query.market': () => ({}),
    'MarketRead.catalogueRevision': (input) => catalogueRevisionRead(input),
    'MarketRead.catalogueType': (input) => catalogueTypeRead(input),
    'MarketRead.catalogueGroupTypes': (input) => catalogueGroupTypesRead(input),
    'MarketRead.profiles': (input) => profilesRead(input),
    'MarketRead.book': (input) => bookRead(input),
    'MarketRead.orders': (input) => ordersRead(input),
    'MarketRead.history': (input) => historyRead(input),
    'MarketRead.referencePrices': (input) => referencePricesRead(input),
    'MarketCatalogueGroupPage.items': (input) => projectList('items')(input),
    'MarketProfile.stationIds': (input) => projectList('stationIds')(input),
    'MarketProfile.watchedTypeIds': (input) => projectList('watchedTypeIds')(input),
    'MarketOrderPage.rows': (input) => projectList('rows')(input),
    'MarketHistory.days': (input) => projectList('days')(input),
    'MarketReferencePrices.rows': (input) => projectList('rows')(input),
  },
}
