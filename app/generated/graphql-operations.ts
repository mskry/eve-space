/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core'
export type Maybe<T> = T | null
export type InputMaybe<T> = Maybe<T>
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string }
  String: { input: string; output: string }
  Boolean: { input: boolean; output: boolean }
  Int: { input: number; output: number }
  Float: { input: number; output: number }
  BigInteger: { input: string; output: string }
  Decimal: { input: string; output: string }
  EveId: { input: string; output: string }
  UTCDate: { input: string; output: string }
  UTCTime: { input: string; output: string }
  UUID: { input: string; output: string }
}

export type Asset = {
  readonly categoryId: Maybe<Scalars['EveId']['output']>
  readonly categoryName: Maybe<Scalars['String']['output']>
  readonly customName: Maybe<Scalars['String']['output']>
  readonly groupId: Maybe<Scalars['EveId']['output']>
  readonly groupName: Maybe<Scalars['String']['output']>
  readonly isBlueprintCopy: Maybe<Scalars['Boolean']['output']>
  readonly isSingleton: Scalars['Boolean']['output']
  readonly itemId: Scalars['EveId']['output']
  readonly locationFlag: Scalars['String']['output']
  readonly locationId: Scalars['EveId']['output']
  readonly locationName: Maybe<Scalars['String']['output']>
  readonly locationType: Scalars['String']['output']
  readonly parentItemId: Maybe<Scalars['EveId']['output']>
  readonly quantity: Scalars['BigInteger']['output']
  readonly solarSystemId: Maybe<Scalars['EveId']['output']>
  readonly solarSystemSecurityStatus: Maybe<Scalars['Float']['output']>
  readonly totalVolume: Maybe<Scalars['Float']['output']>
  readonly typeId: Scalars['EveId']['output']
  readonly typeName: Scalars['String']['output']
  readonly unitVolume: Maybe<Scalars['Float']['output']>
}

export type AssetConnection = {
  readonly anchor: Scalars['String']['output']
  readonly anchorSource: AssetSource
  readonly assets: ReadonlyArray<Asset>
  readonly characterId: Scalars['EveId']['output']
  readonly completeness: Scalars['String']['output']
  readonly enrichment: AssetEnrichment
  readonly pageInfo: PageInfo
  readonly source: AssetSource
  readonly sourcePage: Scalars['Int']['output']
  readonly totalSourcePages: Scalars['Int']['output']
}

export type AssetEnrichment = {
  readonly locations: Scalars['String']['output']
  readonly names: Scalars['String']['output']
  readonly types: Scalars['String']['output']
}

export type AssetSource = {
  readonly cachedUntil: Scalars['UTCTime']['output']
  readonly refreshFailureClass: Maybe<Scalars['String']['output']>
  readonly retryAt: Maybe<Scalars['UTCTime']['output']>
  readonly stale: Scalars['Boolean']['output']
  readonly validatedAt: Scalars['UTCTime']['output']
}

export type MarketBook = {
  readonly collectionStatus: Scalars['String']['output']
  readonly observation: Maybe<MarketObservation>
  readonly profileId: Scalars['UUID']['output']
  readonly profileRevision: Scalars['BigInteger']['output']
  readonly replacement: Maybe<MarketReplacement>
  readonly status: Scalars['String']['output']
  readonly typeId: Scalars['EveId']['output']
}

export type MarketCatalogueGroupPage = {
  readonly groupId: Scalars['EveId']['output']
  readonly items: ReadonlyArray<MarketCatalogueType>
  readonly nextCursor: Maybe<Scalars['String']['output']>
  readonly revision: Scalars['String']['output']
}

export type MarketCatalogueRevision = {
  readonly buildNumber: Scalars['BigInteger']['output']
  readonly ingestVersion: Scalars['Int']['output']
  readonly ingestedAt: Scalars['UTCTime']['output']
  readonly key: Scalars['String']['output']
}

export type MarketCatalogueType = {
  readonly groupId: Scalars['EveId']['output']
  readonly id: Scalars['EveId']['output']
  readonly name: Scalars['String']['output']
}

export type MarketCatalogueTypeResult = {
  readonly item: MarketCatalogueType
  readonly revision: Scalars['String']['output']
}

export type MarketHistory = {
  readonly days: ReadonlyArray<MarketHistoryDay>
  readonly freshUntil: Maybe<Scalars['UTCTime']['output']>
  readonly freshness: Scalars['String']['output']
  readonly profileId: Scalars['UUID']['output']
  readonly profileRevision: Scalars['BigInteger']['output']
  readonly regionId: Scalars['EveId']['output']
  readonly retainedEvidence: Scalars['Boolean']['output']
  readonly source: Maybe<MarketHistorySource>
  readonly status: Scalars['String']['output']
  readonly typeId: Scalars['EveId']['output']
  readonly validatedAt: Maybe<Scalars['UTCTime']['output']>
}

export type MarketHistoryDay = {
  readonly averageIsk: Scalars['Decimal']['output']
  readonly date: Scalars['UTCDate']['output']
  readonly highIsk: Scalars['Decimal']['output']
  readonly lowIsk: Scalars['Decimal']['output']
  readonly orderCount: Scalars['BigInteger']['output']
  readonly volume: Scalars['BigInteger']['output']
}

export type MarketHistorySource = {
  readonly contentRevision: Scalars['BigInteger']['output']
  readonly freshUntil: Maybe<Scalars['UTCTime']['output']>
  readonly lastAttemptAt: Scalars['UTCTime']['output']
  readonly lastFailureClass: Maybe<Scalars['String']['output']>
  readonly responseCount: Maybe<Scalars['Int']['output']>
  readonly responseFrom: Maybe<Scalars['UTCDate']['output']>
  readonly responseThrough: Maybe<Scalars['UTCDate']['output']>
  readonly state: Scalars['String']['output']
  readonly validatedAt: Scalars['UTCTime']['output']
}

export type MarketIntelligenceBookSource = {
  readonly freshUntil: Scalars['UTCTime']['output']
  readonly observationId: Scalars['UUID']['output']
  readonly observedAt: Scalars['UTCTime']['output']
  readonly validatedAt: Scalars['UTCTime']['output']
}

export type MarketIntelligenceCatalogueRevision = {
  readonly buildNumber: Scalars['BigInteger']['output']
  readonly ingestVersion: Scalars['Int']['output']
  readonly ingestedAt: Scalars['UTCTime']['output']
}

export type MarketIntelligenceCoverage = {
  readonly bookScope: Scalars['String']['output']
  readonly catalogueRevision: Maybe<MarketIntelligenceCatalogueRevision>
  readonly evaluatedAt: Scalars['UTCTime']['output']
  readonly excludedTypeCount: Maybe<Scalars['Int']['output']>
  readonly generation: Maybe<MarketIntelligenceFrozenCoverage>
  readonly historyScope: Scalars['String']['output']
  readonly ignoredGroupIds: ReadonlyArray<Scalars['EveId']['output']>
  readonly live: MarketIntelligenceCoverageCounts
  readonly policyEnabled: Scalars['Boolean']['output']
  readonly policyRevision: Scalars['BigInteger']['output']
  readonly profileId: Scalars['UUID']['output']
  readonly profileRevision: Scalars['BigInteger']['output']
  readonly regionId: Scalars['EveId']['output']
}

export type MarketIntelligenceCoverageCounts = {
  readonly eligibleCount: Scalars['Int']['output']
  readonly emptySource: Scalars['Int']['output']
  readonly failedLastAttempt: Scalars['Int']['output']
  readonly failedWithoutSuccess: Scalars['Int']['output']
  readonly freshSuccess: Scalars['Int']['output']
  readonly latestAttemptAt: Maybe<Scalars['UTCTime']['output']>
  readonly neverAttempted: Scalars['Int']['output']
  readonly oldestDueAt: Maybe<Scalars['UTCTime']['output']>
  readonly staleSuccess: Scalars['Int']['output']
}

export type MarketIntelligenceDirection = 'ASC' | 'DESC'

export type MarketIntelligenceFrozenCoverage = {
  readonly counts: MarketIntelligenceCoverageCounts
  readonly evaluatedAt: Scalars['UTCTime']['output']
  readonly generation: MarketIntelligenceGeneration
}

export type MarketIntelligenceGeneration = {
  readonly anchorDate: Scalars['UTCDate']['output']
  readonly bookScope: Scalars['String']['output']
  readonly catalogueRevision: MarketIntelligenceCatalogueRevision
  readonly createdAt: Scalars['UTCTime']['output']
  readonly excludedTypeCount: Scalars['Int']['output']
  readonly expiresAt: Maybe<Scalars['UTCTime']['output']>
  readonly formulaVersion: Scalars['Int']['output']
  readonly generationId: Scalars['UUID']['output']
  readonly historyScope: Scalars['String']['output']
  readonly policyRevision: Scalars['BigInteger']['output']
  readonly profileId: Scalars['UUID']['output']
  readonly profileRevision: Scalars['BigInteger']['output']
  readonly publishedAt: Scalars['UTCTime']['output']
  readonly regionId: Scalars['EveId']['output']
  readonly targetCount: Scalars['Int']['output']
}

export type MarketIntelligenceHistoryRange = {
  readonly days: ReadonlyArray<MarketHistoryDay>
  readonly from: Scalars['UTCDate']['output']
  readonly profileId: Scalars['UUID']['output']
  readonly profileRevision: Scalars['BigInteger']['output']
  readonly regionId: Scalars['EveId']['output']
  readonly retainedEvidence: Scalars['Boolean']['output']
  readonly source: Maybe<MarketIntelligenceHistorySource>
  readonly through: Scalars['UTCDate']['output']
  readonly typeId: Scalars['EveId']['output']
}

export type MarketIntelligenceHistorySource = {
  readonly contentRevision: Scalars['BigInteger']['output']
  readonly freshUntil: Maybe<Scalars['UTCTime']['output']>
  readonly lastAttemptAt: Maybe<Scalars['UTCTime']['output']>
  readonly lastFailureClass: Maybe<Scalars['String']['output']>
  readonly state: Scalars['String']['output']
  readonly validatedAt: Maybe<Scalars['UTCTime']['output']>
}

export type MarketIntelligenceInput = {
  readonly after: InputMaybe<Scalars['String']['input']>
  readonly direction: InputMaybe<MarketIntelligenceDirection>
  readonly first: InputMaybe<Scalars['Int']['input']>
  readonly generationId: InputMaybe<Scalars['UUID']['input']>
  readonly groupIds: InputMaybe<ReadonlyArray<Scalars['EveId']['input']>>
  readonly includeStale: InputMaybe<Scalars['Boolean']['input']>
  readonly minimumAverageDailyOrders: InputMaybe<Scalars['Decimal']['input']>
  readonly minimumAverageDailyValueIsk: InputMaybe<Scalars['Decimal']['input']>
  readonly minimumBaselineDays: InputMaybe<Scalars['Int']['input']>
  readonly profileId: Scalars['UUID']['input']
  readonly sort: InputMaybe<MarketIntelligenceSort>
  readonly typeIds: InputMaybe<ReadonlyArray<Scalars['EveId']['input']>>
}

export type MarketIntelligenceItem = {
  readonly generation: Maybe<MarketIntelligenceGeneration>
  readonly row: Maybe<MarketIntelligenceRow>
  readonly status: Scalars['String']['output']
  readonly typeId: Scalars['EveId']['output']
}

export type MarketIntelligenceMetric = {
  readonly complete: Maybe<Scalars['Boolean']['output']>
  readonly denominator: Maybe<Scalars['BigInteger']['output']>
  readonly nullReason: Maybe<Scalars['String']['output']>
  readonly numerator: Maybe<Scalars['BigInteger']['output']>
  readonly observedDays: Maybe<Scalars['Int']['output']>
  readonly value: Maybe<Scalars['Decimal']['output']>
  readonly windowDays: Maybe<Scalars['Int']['output']>
}

export type MarketIntelligenceMetricDefinition = {
  readonly decimalPlaces: Scalars['Int']['output']
  readonly formula: Scalars['String']['output']
  readonly formulaVersion: Scalars['Int']['output']
  readonly id: MarketIntelligenceSort
  readonly includesAnchor: Scalars['Boolean']['output']
  readonly rounding: Scalars['String']['output']
  readonly source: Scalars['String']['output']
  readonly unit: Scalars['String']['output']
  readonly windowDays: Maybe<Scalars['Int']['output']>
}

export type MarketIntelligenceMetrics = {
  readonly anchorTradedValueIsk: MarketIntelligenceMetric
  readonly anchorVolumeSpike: MarketIntelligenceMetric
  readonly averageDailyOrders: MarketIntelligenceMetric
  readonly averageDailyValueIsk: MarketIntelligenceMetric
  readonly baselineMonthIsk: MarketIntelligenceMetric
  readonly baselineWeekIsk: MarketIntelligenceMetric
  readonly baselineYearIsk: MarketIntelligenceMetric
  readonly bestAskIsk: MarketIntelligenceMetric
  readonly bestBidIsk: MarketIntelligenceMetric
  readonly daysSupply: MarketIntelligenceMetric
  readonly daysSupply10Percent: MarketIntelligenceMetric
  readonly sellDepth: MarketIntelligenceMetric
  readonly sellDepth5Percent: MarketIntelligenceMetric
  readonly sellDepth10Percent: MarketIntelligenceMetric
  readonly spreadIsk: MarketIntelligenceMetric
  readonly spreadPercent: MarketIntelligenceMetric
  readonly underpriceMonthPercent: MarketIntelligenceMetric
  readonly underpriceYearPercent: MarketIntelligenceMetric
  readonly weekPriceChangePercent: MarketIntelligenceMetric
  readonly weekTradedValueIsk: MarketIntelligenceMetric
  readonly weekVolumeSpike: MarketIntelligenceMetric
}

export type MarketIntelligencePage = {
  readonly generation: MarketIntelligenceGeneration
  readonly hasMore: Scalars['Boolean']['output']
  readonly nextCursor: Maybe<Scalars['String']['output']>
  readonly omittedNullSortCount: Scalars['Int']['output']
  readonly rows: ReadonlyArray<MarketIntelligenceRow>
  readonly total: Scalars['Int']['output']
}

export type MarketIntelligenceRow = {
  readonly bookSource: Maybe<MarketIntelligenceBookSource>
  readonly groupId: Scalars['EveId']['output']
  readonly historySource: MarketIntelligenceHistorySource
  readonly metrics: MarketIntelligenceMetrics
  readonly name: Scalars['String']['output']
  readonly typeId: Scalars['EveId']['output']
}

export type MarketIntelligenceSort =
  | 'anchorTradedValueIsk'
  | 'anchorVolumeSpike'
  | 'averageDailyOrders'
  | 'averageDailyValueIsk'
  | 'baselineMonthIsk'
  | 'baselineWeekIsk'
  | 'baselineYearIsk'
  | 'bestAskIsk'
  | 'bestBidIsk'
  | 'daysSupply'
  | 'daysSupply10Percent'
  | 'sellDepth'
  | 'sellDepth5Percent'
  | 'sellDepth10Percent'
  | 'spreadIsk'
  | 'spreadPercent'
  | 'underpriceMonthPercent'
  | 'underpriceYearPercent'
  | 'weekPriceChangePercent'
  | 'weekTradedValueIsk'
  | 'weekVolumeSpike'

export type MarketObservation = {
  readonly expectedPages: Scalars['Int']['output']
  readonly freshUntil: Scalars['UTCTime']['output']
  readonly observationId: Scalars['UUID']['output']
  readonly observedAt: Scalars['UTCTime']['output']
  readonly profileId: Scalars['UUID']['output']
  readonly regionId: Scalars['EveId']['output']
  readonly totalBookOrders: Scalars['BigInteger']['output']
  readonly typeId: Scalars['EveId']['output']
  readonly validatedAt: Scalars['UTCTime']['output']
}

export type MarketOrder = {
  readonly durationDays: Scalars['Int']['output']
  readonly expiryAt: Scalars['UTCTime']['output']
  readonly issuedAt: Scalars['UTCTime']['output']
  readonly locationId: Scalars['EveId']['output']
  readonly locationName: Maybe<Scalars['String']['output']>
  readonly minimumVolume: Scalars['BigInteger']['output']
  readonly orderId: Scalars['EveId']['output']
  readonly price: Scalars['Decimal']['output']
  readonly range: Scalars['String']['output']
  readonly side: MarketOrderSide
  readonly solarSystemId: Maybe<Scalars['EveId']['output']>
  readonly solarSystemSecurityStatus: Maybe<Scalars['Float']['output']>
  readonly volumeRemain: Scalars['BigInteger']['output']
}

export type MarketOrderPage = {
  readonly hasMore: Scalars['Boolean']['output']
  readonly labelsComplete: Scalars['Boolean']['output']
  readonly nextCursor: Maybe<Scalars['String']['output']>
  readonly observation: MarketObservation
  readonly observationId: Scalars['UUID']['output']
  readonly profileRevision: Scalars['BigInteger']['output']
  readonly rows: ReadonlyArray<MarketOrder>
}

export type MarketOrderSide = 'buy' | 'sell'

export type MarketProfile = {
  readonly marketScope: Scalars['String']['output']
  readonly mode: Scalars['String']['output']
  readonly profileId: Scalars['UUID']['output']
  readonly regionId: Scalars['EveId']['output']
  readonly revision: Scalars['BigInteger']['output']
  readonly stationIds: ReadonlyArray<Scalars['EveId']['output']>
  readonly watchedTypeIds: ReadonlyArray<Scalars['EveId']['output']>
}

export type MarketRead = {
  readonly book: Maybe<MarketBook>
  readonly catalogueGroupTypes: Maybe<MarketCatalogueGroupPage>
  readonly catalogueRevision: Maybe<MarketCatalogueRevision>
  readonly catalogueType: Maybe<MarketCatalogueTypeResult>
  readonly history: Maybe<MarketHistory>
  readonly historyRange: Maybe<MarketIntelligenceHistoryRange>
  readonly intelligence: Maybe<MarketIntelligencePage>
  readonly intelligenceCoverage: Maybe<MarketIntelligenceCoverage>
  readonly intelligenceItem: Maybe<MarketIntelligenceItem>
  readonly intelligenceMetricDefinitions: ReadonlyArray<MarketIntelligenceMetricDefinition>
  readonly orders: Maybe<MarketOrderPage>
  readonly profiles: Maybe<ReadonlyArray<MarketProfile>>
  readonly referencePrices: Maybe<MarketReferencePrices>
}

export type MarketReadBookArgs = {
  profileId: Scalars['UUID']['input']
  typeId: Scalars['EveId']['input']
}

export type MarketReadCatalogueGroupTypesArgs = {
  after: InputMaybe<Scalars['String']['input']>
  first?: InputMaybe<Scalars['Int']['input']>
  groupId: Scalars['EveId']['input']
  revision: Scalars['String']['input']
}

export type MarketReadCatalogueTypeArgs = {
  revision: Scalars['String']['input']
  typeId: Scalars['EveId']['input']
}

export type MarketReadHistoryArgs = {
  profileId: Scalars['UUID']['input']
  typeId: Scalars['EveId']['input']
}

export type MarketReadHistoryRangeArgs = {
  from: Scalars['UTCDate']['input']
  profileId: Scalars['UUID']['input']
  through: Scalars['UTCDate']['input']
  typeId: Scalars['EveId']['input']
}

export type MarketReadIntelligenceArgs = {
  input: MarketIntelligenceInput
}

export type MarketReadIntelligenceCoverageArgs = {
  profileId: Scalars['UUID']['input']
}

export type MarketReadIntelligenceItemArgs = {
  generationId: InputMaybe<Scalars['UUID']['input']>
  profileId: Scalars['UUID']['input']
  typeId: Scalars['EveId']['input']
}

export type MarketReadOrdersArgs = {
  after: InputMaybe<Scalars['String']['input']>
  first?: InputMaybe<Scalars['Int']['input']>
  observationId: Scalars['UUID']['input']
  profileId: Scalars['UUID']['input']
  side: MarketOrderSide
  typeId: Scalars['EveId']['input']
}

export type MarketReadReferencePricesArgs = {
  typeIds: ReadonlyArray<Scalars['EveId']['input']>
}

export type MarketReferencePrice = {
  readonly adjustedPriceIsk: Maybe<Scalars['Decimal']['output']>
  readonly averagePriceIsk: Maybe<Scalars['Decimal']['output']>
  readonly sourceHour: Scalars['UTCTime']['output']
  readonly typeId: Scalars['EveId']['output']
  readonly validatedAt: Scalars['UTCTime']['output']
}

export type MarketReferencePrices = {
  readonly kind: Scalars['String']['output']
  readonly rows: ReadonlyArray<MarketReferencePrice>
}

export type MarketReplacement = {
  readonly attemptedAt: Scalars['UTCTime']['output']
  readonly status: Scalars['String']['output']
}

export type OwnedCharacter = {
  readonly assets: Maybe<AssetConnection>
  readonly characterId: Scalars['EveId']['output']
  readonly isMain: Scalars['Boolean']['output']
  readonly name: Scalars['String']['output']
}

export type OwnedCharacterAssetsArgs = {
  after: InputMaybe<Scalars['String']['input']>
  first?: Scalars['Int']['input']
}

export type OwnedCharacterConnection = {
  readonly items: ReadonlyArray<OwnedCharacterIdentity>
  readonly pageInfo: PageInfo
}

export type OwnedCharacterIdentity = {
  readonly characterId: Scalars['EveId']['output']
  readonly isMain: Scalars['Boolean']['output']
  readonly name: Scalars['String']['output']
}

export type PageInfo = {
  readonly endCursor: Maybe<Scalars['String']['output']>
  readonly hasNextPage: Scalars['Boolean']['output']
  readonly restartRequired: Scalars['Boolean']['output']
}

export type Query = {
  readonly market: Maybe<MarketRead>
  readonly ownedCharacter: Maybe<OwnedCharacter>
  readonly ownedCharacters: Maybe<OwnedCharacterConnection>
  readonly trading: Maybe<TradingRead>
}

export type QueryOwnedCharacterArgs = {
  characterId: Scalars['EveId']['input']
}

export type QueryOwnedCharactersArgs = {
  after: InputMaybe<Scalars['String']['input']>
  first?: Scalars['Int']['input']
}

export type TradingInventoryCoverage = {
  readonly characterId: Scalars['EveId']['output']
  readonly characterName: Scalars['String']['output']
  readonly source: Maybe<TradingInventorySource>
  readonly state: Scalars['String']['output']
}

export type TradingInventoryCoverageCounts = {
  readonly authorizationRequired: Scalars['Int']['output']
  readonly beyondRetention: Scalars['Int']['output']
  readonly conflictingSource: Scalars['Int']['output']
  readonly includedCurrent: Scalars['Int']['output']
  readonly includedStale: Scalars['Int']['output']
  readonly incomplete: Scalars['Int']['output']
  readonly neverCollected: Scalars['Int']['output']
  readonly unavailable: Scalars['Int']['output']
}

export type TradingInventoryCoveragePage = {
  readonly endCursor: Maybe<Scalars['String']['output']>
  readonly hasNextPage: Scalars['Boolean']['output']
  readonly rows: ReadonlyArray<TradingInventoryCoverage>
}

export type TradingInventoryFilters = {
  readonly categoryId: InputMaybe<Scalars['EveId']['input']>
  readonly groupId: InputMaybe<Scalars['EveId']['input']>
  readonly locationKey: InputMaybe<Scalars['String']['input']>
  readonly typeId: InputMaybe<Scalars['EveId']['input']>
}

export type TradingInventoryGroup = {
  readonly blueprint: Scalars['String']['output']
  readonly categoryId: Maybe<Scalars['EveId']['output']>
  readonly currentQuantity: Scalars['BigInteger']['output']
  readonly groupId: Maybe<Scalars['EveId']['output']>
  readonly key: Scalars['String']['output']
  readonly location: TradingInventoryLocation
  readonly staleQuantity: Scalars['BigInteger']['output']
  readonly typeId: Scalars['EveId']['output']
  readonly typeName: Maybe<Scalars['String']['output']>
}

export type TradingInventoryGroupPage = {
  readonly endCursor: Maybe<Scalars['String']['output']>
  readonly hasNextPage: Scalars['Boolean']['output']
  readonly rows: ReadonlyArray<TradingInventoryGroup>
}

export type TradingInventoryHolder = {
  readonly characterId: Scalars['EveId']['output']
  readonly characterName: Scalars['String']['output']
  readonly currentQuantity: Scalars['BigInteger']['output']
  readonly groupKey: Scalars['String']['output']
  readonly source: TradingInventorySource
  readonly staleQuantity: Scalars['BigInteger']['output']
  readonly userId: Scalars['UUID']['output']
}

export type TradingInventoryHolderPage = {
  readonly endCursor: Maybe<Scalars['String']['output']>
  readonly hasNextPage: Scalars['Boolean']['output']
  readonly rows: ReadonlyArray<TradingInventoryHolder>
}

export type TradingInventoryKind = 'coverage' | 'groups' | 'holders'

export type TradingInventoryLocation = {
  readonly id: Maybe<Scalars['EveId']['output']>
  readonly key: Scalars['String']['output']
  readonly name: Maybe<Scalars['String']['output']>
  readonly state: Scalars['String']['output']
}

export type TradingInventorySource = {
  readonly freshUntil: Scalars['UTCTime']['output']
  readonly observationId: Scalars['String']['output']
  readonly observedAt: Scalars['UTCTime']['output']
  readonly retainedUntil: Scalars['UTCTime']['output']
  readonly validatedAt: Scalars['UTCTime']['output']
}

export type TradingInventoryView = {
  readonly corporationId: Maybe<Scalars['EveId']['output']>
  readonly coverage: TradingInventoryCoveragePage
  readonly coverageCounts: TradingInventoryCoverageCounts
  readonly expectedSubjects: Scalars['Int']['output']
  readonly fingerprint: Scalars['String']['output']
  readonly groups: TradingInventoryGroupPage
  readonly holders: TradingInventoryHolderPage
  readonly scope: Scalars['String']['output']
  readonly sourcesComplete: Scalars['Boolean']['output']
  readonly traversalComplete: Scalars['Boolean']['output']
  readonly version: Scalars['Int']['output']
}

export type TradingRead = {
  readonly corporationInventory: Maybe<TradingInventoryView>
  readonly personalInventory: Maybe<TradingInventoryView>
}

export type TradingReadCorporationInventoryArgs = {
  after: InputMaybe<Scalars['String']['input']>
  corporationId: Scalars['EveId']['input']
  filters: InputMaybe<TradingInventoryFilters>
  first?: InputMaybe<Scalars['Int']['input']>
  groupKey: InputMaybe<Scalars['String']['input']>
  kind?: InputMaybe<TradingInventoryKind>
}

export type TradingReadPersonalInventoryArgs = {
  after: InputMaybe<Scalars['String']['input']>
  characterIds: InputMaybe<ReadonlyArray<Scalars['EveId']['input']>>
  filters: InputMaybe<TradingInventoryFilters>
  first?: InputMaybe<Scalars['Int']['input']>
  groupKey: InputMaybe<Scalars['String']['input']>
  kind?: InputMaybe<TradingInventoryKind>
}

export type ExplorerMarketQueryVariables = Exact<{ [key: string]: never }>

export type ExplorerMarketQuery = {
  readonly market: {
    readonly catalogueRevision: {
      readonly key: string
      readonly buildNumber: string
      readonly ingestedAt: string
    } | null
    readonly profiles: ReadonlyArray<{
      readonly profileId: string
      readonly revision: string
      readonly regionId: string
      readonly marketScope: string
      readonly mode: string
    }> | null
    readonly referencePrices: {
      readonly kind: string
      readonly rows: ReadonlyArray<{
        readonly typeId: string
        readonly averagePriceIsk: string | null
        readonly adjustedPriceIsk: string | null
        readonly sourceHour: string
        readonly validatedAt: string
      }>
    } | null
  } | null
}

export type ExplorerMarketBookQueryVariables = Exact<{
  profileId: string
  typeId: string
}>

export type ExplorerMarketBookQuery = {
  readonly market: {
    readonly book: {
      readonly profileId: string
      readonly profileRevision: string
      readonly typeId: string
      readonly status: string
      readonly collectionStatus: string
      readonly observation: {
        readonly observationId: string
        readonly observedAt: string
        readonly validatedAt: string
        readonly freshUntil: string
        readonly expectedPages: number
        readonly totalBookOrders: string
      } | null
      readonly replacement: { readonly attemptedAt: string; readonly status: string } | null
    } | null
    readonly history: {
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

export type ExplorerOwnedCharactersQueryVariables = Exact<{
  first?: number
  after: string | null | undefined
}>

export type ExplorerOwnedCharactersQuery = {
  readonly ownedCharacters: {
    readonly items: ReadonlyArray<{
      readonly characterId: string
      readonly name: string
      readonly isMain: boolean
    }>
    readonly pageInfo: {
      readonly hasNextPage: boolean
      readonly endCursor: string | null
      readonly restartRequired: boolean
    }
  } | null
}

export type ExplorerOwnedAssetsQueryVariables = Exact<{
  characterId: string
  first?: number
  after: string | null | undefined
}>

export type ExplorerOwnedAssetsQuery = {
  readonly ownedCharacter: {
    readonly characterId: string
    readonly name: string
    readonly assets: {
      readonly characterId: string
      readonly sourcePage: number
      readonly totalSourcePages: number
      readonly anchor: string
      readonly completeness: string
      readonly anchorSource: {
        readonly validatedAt: string
        readonly cachedUntil: string
        readonly stale: boolean
      }
      readonly source: {
        readonly validatedAt: string
        readonly cachedUntil: string
        readonly stale: boolean
        readonly retryAt: string | null
        readonly refreshFailureClass: string | null
      }
      readonly pageInfo: {
        readonly hasNextPage: boolean
        readonly endCursor: string | null
        readonly restartRequired: boolean
      }
      readonly enrichment: {
        readonly types: string
        readonly names: string
        readonly locations: string
      }
      readonly assets: ReadonlyArray<{
        readonly itemId: string
        readonly typeId: string
        readonly quantity: string
        readonly typeName: string
        readonly customName: string | null
        readonly locationId: string
        readonly locationName: string | null
        readonly locationFlag: string
      }>
    } | null
  } | null
}

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>
  private value: string
  public __meta__?: Record<string, any> | undefined

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value)
    this.value = value
    this.__meta__ = __meta__
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value
  }
}

export const ExplorerMarketDocument = new TypedDocumentString(`
    query ExplorerMarket {
  market {
    catalogueRevision {
      key
      buildNumber
      ingestedAt
    }
    profiles {
      profileId
      revision
      regionId
      marketScope
      mode
    }
    referencePrices(typeIds: ["34"]) {
      kind
      rows {
        typeId
        averagePriceIsk
        adjustedPriceIsk
        sourceHour
        validatedAt
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ExplorerMarketQuery, ExplorerMarketQueryVariables>
export const ExplorerMarketBookDocument = new TypedDocumentString(`
    query ExplorerMarketBook($profileId: UUID!, $typeId: EveId!) {
  market {
    book(profileId: $profileId, typeId: $typeId) {
      profileId
      profileRevision
      typeId
      status
      collectionStatus
      observation {
        observationId
        observedAt
        validatedAt
        freshUntil
        expectedPages
        totalBookOrders
      }
      replacement {
        attemptedAt
        status
      }
    }
    history(profileId: $profileId, typeId: $typeId) {
      status
      freshness
      validatedAt
      freshUntil
      days {
        date
        averageIsk
        highIsk
        lowIsk
        volume
        orderCount
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ExplorerMarketBookQuery, ExplorerMarketBookQueryVariables>
export const ExplorerOwnedCharactersDocument = new TypedDocumentString(`
    query ExplorerOwnedCharacters($first: Int! = 50, $after: String) {
  ownedCharacters(first: $first, after: $after) {
    items {
      characterId
      name
      isMain
    }
    pageInfo {
      hasNextPage
      endCursor
      restartRequired
    }
  }
}
    `) as unknown as TypedDocumentString<
  ExplorerOwnedCharactersQuery,
  ExplorerOwnedCharactersQueryVariables
>
export const ExplorerOwnedAssetsDocument = new TypedDocumentString(`
    query ExplorerOwnedAssets($characterId: EveId!, $first: Int! = 25, $after: String) {
  ownedCharacter(characterId: $characterId) {
    characterId
    name
    assets(first: $first, after: $after) {
      characterId
      sourcePage
      totalSourcePages
      anchor
      completeness
      anchorSource {
        validatedAt
        cachedUntil
        stale
      }
      source {
        validatedAt
        cachedUntil
        stale
        retryAt
        refreshFailureClass
      }
      pageInfo {
        hasNextPage
        endCursor
        restartRequired
      }
      enrichment {
        types
        names
        locations
      }
      assets {
        itemId
        typeId
        quantity
        typeName
        customName
        locationId
        locationName
        locationFlag
      }
    }
  }
}
    `) as unknown as TypedDocumentString<
  ExplorerOwnedAssetsQuery,
  ExplorerOwnedAssetsQueryVariables
>
