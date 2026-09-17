export const CORE_DATA_CONTRIBUTION_CONTEXTS = [
  'route',
  'resource-projection',
  'activity-provider',
] as const

export const CORE_DATA_PRODUCT_IDS = [
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
  locationIds: readonly number[]
}

export interface StaticLocationLabel {
  locationId: number
  kind: 'solar_system' | 'station'
  name: string
  solarSystemId: number
}

export interface StaticLocationLabelsResult {
  rows: readonly StaticLocationLabel[]
  revision: SdeProjectionRevision
  complete: true
}

export interface CoreDataProductRequestMap {
  'published-type-groups': PublishedTypeGroupsRequest
  'published-skill-catalogue': Record<never, never>
  'published-type-details': PublishedTypeDetailsRequest
  'static-location-labels': StaticLocationLabelsRequest
}

export interface CoreDataProductResultMap {
  'published-type-groups': PublishedTypeGroupsResult
  'published-skill-catalogue': PublishedSkillCatalogueResult
  'published-type-details': PublishedTypeDetailsResult
  'static-location-labels': StaticLocationLabelsResult
}

export interface CoreDataProductMethodNameMap {
  'published-type-groups': 'publishedTypeGroups'
  'published-skill-catalogue': 'publishedSkillCatalogue'
  'published-type-details': 'publishedTypeDetails'
  'static-location-labels': 'staticLocationLabels'
}

export interface CoreDataMethods {
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
  'published-type-groups': {
    id: 'published-type-groups',
    method: 'publishedTypeGroups',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 500,
    permittedContexts: ['route', 'resource-projection'],
  },
  'published-skill-catalogue': {
    id: 'published-skill-catalogue',
    method: 'publishedSkillCatalogue',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 10_000,
    permittedContexts: ['route', 'resource-projection'],
  },
  'published-type-details': {
    id: 'published-type-details',
    method: 'publishedTypeDetails',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 500,
    permittedContexts: ['route', 'resource-projection'],
  },
  'static-location-labels': {
    id: 'static-location-labels',
    method: 'staticLocationLabels',
    audience: 'installed-module',
    sensitivity: 'public',
    dtoVersion: 1,
    requestBound: 500,
    permittedContexts: ['route', 'resource-projection'],
  },
} as const satisfies {
  [ProductId in CoreDataProductId]: CoreDataProductContract<ProductId>
}

export type CoreDataProductRequest<ProductId extends CoreDataProductId> =
  CoreDataProductRequestMap[ProductId]

export type CoreDataProductResult<ProductId extends CoreDataProductId> =
  CoreDataProductResultMap[ProductId]
