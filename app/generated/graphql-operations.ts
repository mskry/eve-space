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
}

export type QueryOwnedCharacterArgs = {
  characterId: Scalars['EveId']['input']
}

export type QueryOwnedCharactersArgs = {
  after: InputMaybe<Scalars['String']['input']>
  first?: Scalars['Int']['input']
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
