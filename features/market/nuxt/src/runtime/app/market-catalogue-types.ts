export interface MarketGroup {
  id: number
  parentId: number | null
  name: string
  iconId: number | null
  directTypeCount: number
}

export interface MarketType {
  id: number
  groupId: number
  name: string
}

export interface MarketCatalogueRevision {
  buildNumber: number
  ingestVersion: number
  ingestedAt: string
}

export type MarketTreeEntry = MarketGroup | MarketType
