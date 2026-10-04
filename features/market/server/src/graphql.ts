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
import {
  intelligenceRead,
  intelligenceItemRead,
  intelligenceCoverageRead,
  intelligenceHistoryRangeRead,
  intelligenceDefinitionsRead,
} from './graphql-intelligence.js'
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
      intelligenceMetricDefinitions: [MarketIntelligenceMetricDefinition!]!
      intelligenceCoverage(profileId: UUID!): MarketIntelligenceCoverage
      intelligence(input: MarketIntelligenceInput!): MarketIntelligencePage
      intelligenceItem(profileId: UUID!, typeId: EveId!, generationId: UUID): MarketIntelligenceItem
      historyRange(profileId: UUID!, typeId: EveId!, from: UTCDate!, through: UTCDate!): MarketIntelligenceHistoryRange
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
    type MarketHistory { profileId: UUID!, profileRevision: BigInteger!, regionId: EveId!, typeId: EveId!, status: String!, freshness: String!, validatedAt: UTCTime, freshUntil: UTCTime, source: MarketHistorySource, retainedEvidence: Boolean!, days: [MarketHistoryDay!]! }
    type MarketHistorySource { state: String!, validatedAt: UTCTime!, freshUntil: UTCTime, contentRevision: BigInteger!, responseCount: Int, responseFrom: UTCDate, responseThrough: UTCDate, lastAttemptAt: UTCTime!, lastFailureClass: String }
    type MarketHistoryDay { date: UTCDate!, averageIsk: Decimal!, highIsk: Decimal!, lowIsk: Decimal!, volume: BigInteger!, orderCount: BigInteger! }
    type MarketReferencePrices { kind: String!, rows: [MarketReferencePrice!]! }
    type MarketReferencePrice { typeId: EveId!, adjustedPriceIsk: Decimal, averagePriceIsk: Decimal, sourceHour: UTCTime!, validatedAt: UTCTime! }

  input MarketIntelligenceInput {
    profileId: UUID!, generationId: UUID, typeIds: [EveId!], groupIds: [EveId!],
    first: Int = 25, after: String, minimumAverageDailyValueIsk: Decimal = "5000000000",
    minimumAverageDailyOrders: Decimal = "5", minimumBaselineDays: Int = 0,
    includeStale: Boolean = false, sort: MarketIntelligenceSort = anchorTradedValueIsk,
    direction: MarketIntelligenceDirection = DESC
  }
  enum MarketIntelligenceSort { baselineWeekIsk baselineMonthIsk baselineYearIsk weekPriceChangePercent underpriceMonthPercent underpriceYearPercent anchorTradedValueIsk weekTradedValueIsk averageDailyValueIsk averageDailyOrders anchorVolumeSpike weekVolumeSpike bestBidIsk bestAskIsk spreadIsk spreadPercent sellDepth sellDepth5Percent sellDepth10Percent daysSupply daysSupply10Percent }
  enum MarketIntelligenceDirection { ASC DESC }
  type MarketIntelligenceMetricDefinition { id: MarketIntelligenceSort!, unit: String!, windowDays: Int, source: String!, formula: String!, formulaVersion: Int!, includesAnchor: Boolean!, decimalPlaces: Int!, rounding: String! }
  type MarketIntelligenceGeneration { generationId: UUID!, profileId: UUID!, profileRevision: BigInteger!, policyRevision: BigInteger!, catalogueRevision: MarketIntelligenceCatalogueRevision!, formulaVersion: Int!, anchorDate: UTCDate!, regionId: EveId!, bookScope: String!, historyScope: String!, targetCount: Int!, excludedTypeCount: Int!, createdAt: UTCTime!, publishedAt: UTCTime!, expiresAt: UTCTime }
  type MarketIntelligenceCatalogueRevision { buildNumber: BigInteger!, ingestVersion: Int!, ingestedAt: UTCTime! }
  type MarketIntelligenceHistorySource { state: String!, validatedAt: UTCTime, freshUntil: UTCTime, contentRevision: BigInteger!, lastAttemptAt: UTCTime, lastFailureClass: String }
  type MarketIntelligenceBookSource { observationId: UUID!, observedAt: UTCTime!, validatedAt: UTCTime!, freshUntil: UTCTime! }
  type MarketIntelligenceMetric { value: Decimal, numerator: BigInteger, denominator: BigInteger, nullReason: String, observedDays: Int, windowDays: Int, complete: Boolean }
  type MarketIntelligenceMetrics { baselineWeekIsk: MarketIntelligenceMetric!, baselineMonthIsk: MarketIntelligenceMetric!, baselineYearIsk: MarketIntelligenceMetric!, weekPriceChangePercent: MarketIntelligenceMetric!, underpriceMonthPercent: MarketIntelligenceMetric!, underpriceYearPercent: MarketIntelligenceMetric!, anchorTradedValueIsk: MarketIntelligenceMetric!, weekTradedValueIsk: MarketIntelligenceMetric!, averageDailyValueIsk: MarketIntelligenceMetric!, averageDailyOrders: MarketIntelligenceMetric!, anchorVolumeSpike: MarketIntelligenceMetric!, weekVolumeSpike: MarketIntelligenceMetric!, bestBidIsk: MarketIntelligenceMetric!, bestAskIsk: MarketIntelligenceMetric!, spreadIsk: MarketIntelligenceMetric!, spreadPercent: MarketIntelligenceMetric!, sellDepth: MarketIntelligenceMetric!, sellDepth5Percent: MarketIntelligenceMetric!, sellDepth10Percent: MarketIntelligenceMetric!, daysSupply: MarketIntelligenceMetric!, daysSupply10Percent: MarketIntelligenceMetric! }
  type MarketIntelligenceRow { typeId: EveId!, groupId: EveId!, name: String!, historySource: MarketIntelligenceHistorySource!, bookSource: MarketIntelligenceBookSource, metrics: MarketIntelligenceMetrics! }
  type MarketIntelligencePage { generation: MarketIntelligenceGeneration!, total: Int!, omittedNullSortCount: Int!, rows: [MarketIntelligenceRow!]!, hasMore: Boolean!, nextCursor: String }
  type MarketIntelligenceItem { typeId: EveId!, status: String!, generation: MarketIntelligenceGeneration, row: MarketIntelligenceRow }
  type MarketIntelligenceCoverageCounts { eligibleCount: Int!, neverAttempted: Int!, freshSuccess: Int!, staleSuccess: Int!, failedWithoutSuccess: Int!, emptySource: Int!, failedLastAttempt: Int!, latestAttemptAt: UTCTime, oldestDueAt: UTCTime }
  type MarketIntelligenceFrozenCoverage { generation: MarketIntelligenceGeneration!, evaluatedAt: UTCTime!, counts: MarketIntelligenceCoverageCounts! }
  type MarketIntelligenceCoverage { profileId: UUID!, profileRevision: BigInteger!, regionId: EveId!, bookScope: String!, historyScope: String!, policyRevision: BigInteger!, policyEnabled: Boolean!, ignoredGroupIds: [EveId!]!, catalogueRevision: MarketIntelligenceCatalogueRevision, excludedTypeCount: Int, evaluatedAt: UTCTime!, live: MarketIntelligenceCoverageCounts!, generation: MarketIntelligenceFrozenCoverage }
  type MarketIntelligenceHistoryRange { profileId: UUID!, profileRevision: BigInteger!, regionId: EveId!, typeId: EveId!, from: UTCDate!, through: UTCDate!, retainedEvidence: Boolean!, source: MarketIntelligenceHistorySource, days: [MarketHistoryDay!]! }
  `,
  reads: {
    'Query.market': () => ({}),
    'MarketRead.intelligenceMetricDefinitions': () => intelligenceDefinitionsRead(),
    'MarketRead.intelligence': (input) => intelligenceRead(input),
    'MarketRead.intelligenceItem': (input) => intelligenceItemRead(input),
    'MarketRead.intelligenceCoverage': (input) => intelligenceCoverageRead(input),
    'MarketRead.historyRange': (input) => intelligenceHistoryRangeRead(input),
    'MarketIntelligencePage.rows': (input) => projectList('rows')(input),
    'MarketIntelligenceCoverage.ignoredGroupIds': (input) => projectList('ignoredGroupIds')(input),
    'MarketIntelligenceHistoryRange.days': (input) => projectList('days')(input),
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
