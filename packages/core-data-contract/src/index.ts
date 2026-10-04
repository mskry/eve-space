import type { EveFormattedText } from '@eve-space/core-eve-projections/eve-formatted-text'

export const CORE_DATA_CONTRIBUTION_CONTEXTS = [
  'route',
  'resource-projection',
  'activity-provider',
  'graphql-read',
] as const

export const CORE_DATA_PRODUCT_IDS = [
  'public-character-profile',
  'market-catalogue',
  'market-station-regions',
  'published-type-groups',
  'published-skill-catalogue',
  'published-type-details',
  'static-location-labels',
] as const

export type CoreDataContributionContext = (typeof CORE_DATA_CONTRIBUTION_CONTEXTS)[number]
export type CoreDataProductId = (typeof CORE_DATA_PRODUCT_IDS)[number]

export interface SdeProjectionRevision {
  buildNumber: number
  ingestVersion: number
  ingestedAt: string
}

export const MARKET_CATALOGUE_MAX_GROUPS = 4_000
export const MARKET_CATALOGUE_MAX_TYPES = 32_000
export const MARKET_CATALOGUE_GROUP_PAGE_SIZE = 100
export const MARKET_STATION_REGION_MAX_IDS = 100

export interface MarketCatalogueGroup {
  id: number
  parentId: number | null
  name: string
  iconId: number | null
  directTypeCount: number
}

export interface MarketCatalogueType {
  id: number
  groupId: number
  name: string
}

export type MarketCatalogueRequest = MarketCatalogueSelector & { readonly signal?: AbortSignal }

type MarketCatalogueSelector =
  | { kind: 'revision' }
  | { kind: 'tree' }
  | { kind: 'group-types'; groupId: number; cursor?: string; pageSize?: number }
  | { kind: 'search-index' }
  | { kind: 'type-by-id'; typeId: number }

export interface MarketCatalogueTreeResult {
  kind: 'tree'
  groups: readonly MarketCatalogueGroup[]
  revision: SdeProjectionRevision
  complete: true
}

export interface MarketCatalogueGroupTypesResult {
  kind: 'group-types'
  groupId: number
  items: readonly MarketCatalogueType[]
  nextCursor: string | null
  revision: SdeProjectionRevision
}

export interface MarketCatalogueSearchIndexResult {
  kind: 'search-index'
  types: readonly MarketCatalogueType[]
  revision: SdeProjectionRevision
  complete: true
}

export interface MarketCatalogueTypeByIdResult {
  kind: 'type-by-id'
  item: MarketCatalogueType | null
  revision: SdeProjectionRevision
  complete: true
}

export type MarketCatalogueResult =
  | { kind: 'revision'; revision: SdeProjectionRevision }
  | MarketCatalogueTreeResult
  | MarketCatalogueGroupTypesResult
  | MarketCatalogueSearchIndexResult
  | MarketCatalogueTypeByIdResult

export interface PublishedTypeGroup {
  typeId: number
  typeName: string
  groupId: number
  groupName: string
}

export interface PublishedTypeGroupsRequest {
  typeIds: readonly number[]
}

export interface PublishedTypeGroupsResult {
  rows: readonly PublishedTypeGroup[]
  revision: SdeProjectionRevision
  complete: true
}

export type SkillTrainingAttribute =
  | 'charisma'
  | 'intelligence'
  | 'memory'
  | 'perception'
  | 'willpower'

export interface PublishedSkillCatalogueRecord {
  typeId: number
  typeName: string
  groupId: number
  groupName: string
  rank: number | null
  primaryAttribute: SkillTrainingAttribute | null
  secondaryAttribute: SkillTrainingAttribute | null
}

export interface PublishedSkillCatalogueResult {
  rows: readonly PublishedSkillCatalogueRecord[]
  revision: SdeProjectionRevision
  complete: true
}

export interface PublishedTypeDetail {
  typeId: number
  typeName: string
  groupId: number
  groupName: string
  categoryId: number
  categoryName: string
  packagedVolume: number | null
}

export interface PublishedTypeDetailsRequest {
  typeIds: readonly number[]
}

export interface PublishedTypeDetailsResult {
  rows: readonly PublishedTypeDetail[]
  revision: SdeProjectionRevision
  complete: true
}

export interface StaticLocationLabelsRequest {
  readonly signal?: AbortSignal
  locationIds: readonly number[]
}

export interface StaticLocationLabel {
  locationId: number
  kind: 'solar_system' | 'station'
  name: string
  solarSystemId: number
  solarSystemName: string
  solarSystemSecurityStatus: number
}

export interface StaticLocationLabelsResult {
  rows: readonly StaticLocationLabel[]
  revision: SdeProjectionRevision
  complete: true
}

export interface PublicCharacterProfileRequest {
  readonly characterId: number
  readonly signal?: AbortSignal
}

export interface PublicCharacterProfileResult {
  readonly id: number
  readonly name: string
  readonly birthday: string
  readonly gender: string
  readonly race: string
  readonly raceFactionId: number | null
  readonly bloodline: string
  readonly securityStatus: number
  readonly achievementScore: number
  readonly corporationTitle?: string
  readonly bio?: EveFormattedText
  readonly factionId: number | null
  readonly corporation: {
    readonly id: number
    readonly name: string
    readonly ticker: string
    readonly memberCount: number
  }
  readonly alliance: {
    readonly id: number
    readonly name: string
    readonly ticker: string
  } | null
  readonly validatedAt: string
  readonly cachedUntil: string
  readonly stale: boolean
  readonly retryAt?: string
  readonly refreshFailureClass?: 'esi-cooldown' | 'esi-unavailable' | 'response-invalid' | 'unknown'
}

export interface MarketStationRegionsRequest {
  stationIds: readonly number[]
}

export interface MarketStationRegion {
  stationId: number
  solarSystemId: number
  regionId: number
}

export interface MarketStationRegionsResult {
  rows: readonly MarketStationRegion[]
  revision: SdeProjectionRevision
  complete: true
}

export interface CoreDataProductRequestMap {
  'public-character-profile': PublicCharacterProfileRequest
  'market-catalogue': MarketCatalogueRequest
  'market-station-regions': MarketStationRegionsRequest
  'published-type-groups': PublishedTypeGroupsRequest
  'published-skill-catalogue': Record<never, never>
  'published-type-details': PublishedTypeDetailsRequest
  'static-location-labels': StaticLocationLabelsRequest
}

export interface CoreDataProductResultMap {
  'public-character-profile': PublicCharacterProfileResult
  'market-catalogue': MarketCatalogueResult
  'market-station-regions': MarketStationRegionsResult
  'published-type-groups': PublishedTypeGroupsResult
  'published-skill-catalogue': PublishedSkillCatalogueResult
  'published-type-details': PublishedTypeDetailsResult
  'static-location-labels': StaticLocationLabelsResult
}

export interface CoreDataProductMethodNameMap {
  'public-character-profile': 'publicCharacterProfile'
  'market-catalogue': 'marketCatalogue'
  'market-station-regions': 'marketStationRegions'
  'published-type-groups': 'publishedTypeGroups'
  'published-skill-catalogue': 'publishedSkillCatalogue'
  'published-type-details': 'publishedTypeDetails'
  'static-location-labels': 'staticLocationLabels'
}

export interface CoreDataMethods {
  publicCharacterProfile(
    request: PublicCharacterProfileRequest,
  ): Promise<PublicCharacterProfileResult>
  marketCatalogue(request: MarketCatalogueRequest): Promise<MarketCatalogueResult>
  marketStationRegions(request: MarketStationRegionsRequest): Promise<MarketStationRegionsResult>
  publishedTypeGroups(request: PublishedTypeGroupsRequest): Promise<PublishedTypeGroupsResult>
  publishedSkillCatalogue(request?: Record<never, never>): Promise<PublishedSkillCatalogueResult>
  publishedTypeDetails(request: PublishedTypeDetailsRequest): Promise<PublishedTypeDetailsResult>
  staticLocationLabels(request: StaticLocationLabelsRequest): Promise<StaticLocationLabelsResult>
}

export type CoreDataMethodsFor<ProductIds extends readonly CoreDataProductId[]> = Pick<
  CoreDataMethods,
  CoreDataProductMethodNameMap[ProductIds[number]]
>

export interface CoreDataProductContract<ProductId extends CoreDataProductId = CoreDataProductId> {
  id: ProductId
  method: CoreDataProductMethodNameMap[ProductId]
  audience: 'installed-module'
  sensitivity: 'public'
  dtoVersion: number
  requestBound: number
  permittedContexts: readonly CoreDataContributionContext[]
}

export const CORE_DATA_PRODUCT_CONTRACTS = {
  'public-character-profile': {
    audience: 'installed-module',
    dtoVersion: 1,
    id: 'public-character-profile',
    method: 'publicCharacterProfile',
    permittedContexts: ['route'],
    requestBound: 1,
    sensitivity: 'public',
  },
  'market-catalogue': {
    audience: 'installed-module',
    dtoVersion: 1,
    id: 'market-catalogue',
    method: 'marketCatalogue',
    permittedContexts: ['route', 'resource-projection', 'graphql-read'],
    requestBound: MARKET_CATALOGUE_MAX_TYPES,
    sensitivity: 'public',
  },
  'market-station-regions': {
    audience: 'installed-module',
    dtoVersion: 1,
    id: 'market-station-regions',
    method: 'marketStationRegions',
    permittedContexts: ['route', 'resource-projection'],
    requestBound: MARKET_STATION_REGION_MAX_IDS,
    sensitivity: 'public',
  },
  'published-skill-catalogue': {
    audience: 'installed-module',
    dtoVersion: 1,
    id: 'published-skill-catalogue',
    method: 'publishedSkillCatalogue',
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 10_000,
    sensitivity: 'public',
  },
  'published-type-details': {
    audience: 'installed-module',
    dtoVersion: 1,
    id: 'published-type-details',
    method: 'publishedTypeDetails',
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 500,
    sensitivity: 'public',
  },
  'published-type-groups': {
    audience: 'installed-module',
    dtoVersion: 1,
    id: 'published-type-groups',
    method: 'publishedTypeGroups',
    permittedContexts: ['route', 'resource-projection'],
    requestBound: 500,
    sensitivity: 'public',
  },
  'static-location-labels': {
    audience: 'installed-module',
    dtoVersion: 2,
    id: 'static-location-labels',
    method: 'staticLocationLabels',
    permittedContexts: ['route', 'resource-projection', 'graphql-read'],
    requestBound: 500,
    sensitivity: 'public',
  },
} as const satisfies {
  [ProductId in CoreDataProductId]: CoreDataProductContract<ProductId>
}

export type CoreDataProductRequest<ProductId extends CoreDataProductId> =
  CoreDataProductRequestMap[ProductId]

export type CoreDataProductResult<ProductId extends CoreDataProductId> =
  CoreDataProductResultMap[ProductId]
