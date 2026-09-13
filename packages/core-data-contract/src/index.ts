export const CORE_DATA_CONTRIBUTION_CONTEXTS = [
  'route',
  'resource-projection',
  'activity-provider',
] as const

export const CORE_DATA_PRODUCT_IDS = ['published-type-groups'] as const

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

export interface CoreDataProductRequestMap {
  'published-type-groups': PublishedTypeGroupsRequest
}

export interface CoreDataProductResultMap {
  'published-type-groups': PublishedTypeGroupsResult
}

export interface CoreDataProductMethodNameMap {
  'published-type-groups': 'publishedTypeGroups'
}

export interface CoreDataMethods {
  publishedTypeGroups(request: PublishedTypeGroupsRequest): Promise<PublishedTypeGroupsResult>
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
} as const satisfies {
  [ProductId in CoreDataProductId]: CoreDataProductContract<ProductId>
}

export type CoreDataProductRequest<ProductId extends CoreDataProductId> =
  CoreDataProductRequestMap[ProductId]

export type CoreDataProductResult<ProductId extends CoreDataProductId> =
  CoreDataProductResultMap[ProductId]
