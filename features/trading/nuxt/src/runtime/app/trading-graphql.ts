import type { GraphQLDocument } from '@eve-space/platform-module-nuxt/runtime'
export const tradingGraphQLIdentity = [
  '4adf6b274e370cb4df593458ccadea3169cca63f019ac0755b070b8af87cab9a',
  '1da916e297899d14a549c42b0da6465d7af92d319b657fbdbb7ca74ddef1bb39',
] as const
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
export type TradingInventoryFilters = {
  readonly categoryId: string | null | undefined
  readonly groupId: string | null | undefined
  readonly locationKey: string | null | undefined
  readonly typeId: string | null | undefined
}

export type TradingInventoryStatusFragment = {
  readonly version: number
  readonly scope: string
  readonly corporationId: string | null
  readonly fingerprint: string
  readonly traversalComplete: boolean
  readonly sourcesComplete: boolean
  readonly expectedSubjects: number
  readonly coverageCounts: {
    readonly includedCurrent: number
    readonly includedStale: number
    readonly authorizationRequired: number
    readonly neverCollected: number
    readonly unavailable: number
    readonly incomplete: number
    readonly beyondRetention: number
    readonly conflictingSource: number
  }
}

export type TradingInventoryClockFragment = {
  readonly observationId: string
  readonly observedAt: string
  readonly validatedAt: string
  readonly freshUntil: string
  readonly retainedUntil: string
}

export type TradingInventoryGroupsFragment = {
  readonly endCursor: string | null
  readonly hasNextPage: boolean
  readonly rows: ReadonlyArray<{
    readonly key: string
    readonly typeId: string
    readonly typeName: string | null
    readonly groupId: string | null
    readonly categoryId: string | null
    readonly blueprint: string
    readonly currentQuantity: string
    readonly staleQuantity: string
    readonly location: {
      readonly key: string
      readonly id: string | null
      readonly name: string | null
      readonly state: string
    }
  }>
}

export type TradingPersonalInventoryQueryVariables = Exact<{
  characterIds: ReadonlyArray<string> | string | null | undefined
  filters: TradingInventoryFilters | null | undefined
  first?: number | null | undefined
  after: string | null | undefined
}>

export type TradingPersonalInventoryQuery = {
  readonly trading: {
    readonly personalInventory: {
      readonly version: number
      readonly scope: string
      readonly corporationId: string | null
      readonly fingerprint: string
      readonly traversalComplete: boolean
      readonly sourcesComplete: boolean
      readonly expectedSubjects: number
      readonly groups: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
        readonly rows: ReadonlyArray<{
          readonly key: string
          readonly typeId: string
          readonly typeName: string | null
          readonly groupId: string | null
          readonly categoryId: string | null
          readonly blueprint: string
          readonly currentQuantity: string
          readonly staleQuantity: string
          readonly location: {
            readonly key: string
            readonly id: string | null
            readonly name: string | null
            readonly state: string
          }
        }>
      }
      readonly coverageCounts: {
        readonly includedCurrent: number
        readonly includedStale: number
        readonly authorizationRequired: number
        readonly neverCollected: number
        readonly unavailable: number
        readonly incomplete: number
        readonly beyondRetention: number
        readonly conflictingSource: number
      }
    } | null
  } | null
}

export type TradingCorporationInventoryQueryVariables = Exact<{
  corporationId: string
  filters: TradingInventoryFilters | null | undefined
  first?: number | null | undefined
  after: string | null | undefined
}>

export type TradingCorporationInventoryQuery = {
  readonly trading: {
    readonly corporationInventory: {
      readonly version: number
      readonly scope: string
      readonly corporationId: string | null
      readonly fingerprint: string
      readonly traversalComplete: boolean
      readonly sourcesComplete: boolean
      readonly expectedSubjects: number
      readonly groups: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
        readonly rows: ReadonlyArray<{
          readonly key: string
          readonly typeId: string
          readonly typeName: string | null
          readonly groupId: string | null
          readonly categoryId: string | null
          readonly blueprint: string
          readonly currentQuantity: string
          readonly staleQuantity: string
          readonly location: {
            readonly key: string
            readonly id: string | null
            readonly name: string | null
            readonly state: string
          }
        }>
      }
      readonly coverageCounts: {
        readonly includedCurrent: number
        readonly includedStale: number
        readonly authorizationRequired: number
        readonly neverCollected: number
        readonly unavailable: number
        readonly incomplete: number
        readonly beyondRetention: number
        readonly conflictingSource: number
      }
    } | null
  } | null
}

export type TradingPersonalHoldersQueryVariables = Exact<{
  characterIds: ReadonlyArray<string> | string | null | undefined
  groupKey: string
  first?: number | null | undefined
  after: string | null | undefined
}>

export type TradingPersonalHoldersQuery = {
  readonly trading: {
    readonly personalInventory: {
      readonly version: number
      readonly scope: string
      readonly corporationId: string | null
      readonly fingerprint: string
      readonly traversalComplete: boolean
      readonly sourcesComplete: boolean
      readonly expectedSubjects: number
      readonly holders: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
        readonly rows: ReadonlyArray<{
          readonly characterId: string
          readonly userId: string
          readonly characterName: string
          readonly groupKey: string
          readonly currentQuantity: string
          readonly staleQuantity: string
          readonly source: {
            readonly observationId: string
            readonly observedAt: string
            readonly validatedAt: string
            readonly freshUntil: string
            readonly retainedUntil: string
          }
        }>
      }
      readonly coverageCounts: {
        readonly includedCurrent: number
        readonly includedStale: number
        readonly authorizationRequired: number
        readonly neverCollected: number
        readonly unavailable: number
        readonly incomplete: number
        readonly beyondRetention: number
        readonly conflictingSource: number
      }
    } | null
  } | null
}

export type TradingCorporationHoldersQueryVariables = Exact<{
  corporationId: string
  groupKey: string
  first?: number | null | undefined
  after: string | null | undefined
}>

export type TradingCorporationHoldersQuery = {
  readonly trading: {
    readonly corporationInventory: {
      readonly version: number
      readonly scope: string
      readonly corporationId: string | null
      readonly fingerprint: string
      readonly traversalComplete: boolean
      readonly sourcesComplete: boolean
      readonly expectedSubjects: number
      readonly holders: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
        readonly rows: ReadonlyArray<{
          readonly characterId: string
          readonly userId: string
          readonly characterName: string
          readonly groupKey: string
          readonly currentQuantity: string
          readonly staleQuantity: string
          readonly source: {
            readonly observationId: string
            readonly observedAt: string
            readonly validatedAt: string
            readonly freshUntil: string
            readonly retainedUntil: string
          }
        }>
      }
      readonly coverageCounts: {
        readonly includedCurrent: number
        readonly includedStale: number
        readonly authorizationRequired: number
        readonly neverCollected: number
        readonly unavailable: number
        readonly incomplete: number
        readonly beyondRetention: number
        readonly conflictingSource: number
      }
    } | null
  } | null
}

export type TradingPersonalCoverageQueryVariables = Exact<{
  characterIds: ReadonlyArray<string> | string | null | undefined
  first?: number | null | undefined
  after: string | null | undefined
}>

export type TradingPersonalCoverageQuery = {
  readonly trading: {
    readonly personalInventory: {
      readonly version: number
      readonly scope: string
      readonly corporationId: string | null
      readonly fingerprint: string
      readonly traversalComplete: boolean
      readonly sourcesComplete: boolean
      readonly expectedSubjects: number
      readonly coverage: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
        readonly rows: ReadonlyArray<{
          readonly characterId: string
          readonly characterName: string
          readonly state: string
          readonly source: {
            readonly observationId: string
            readonly observedAt: string
            readonly validatedAt: string
            readonly freshUntil: string
            readonly retainedUntil: string
          } | null
        }>
      }
      readonly coverageCounts: {
        readonly includedCurrent: number
        readonly includedStale: number
        readonly authorizationRequired: number
        readonly neverCollected: number
        readonly unavailable: number
        readonly incomplete: number
        readonly beyondRetention: number
        readonly conflictingSource: number
      }
    } | null
  } | null
}

export type TradingCorporationCoverageQueryVariables = Exact<{
  corporationId: string
  first?: number | null | undefined
  after: string | null | undefined
}>

export type TradingCorporationCoverageQuery = {
  readonly trading: {
    readonly corporationInventory: {
      readonly version: number
      readonly scope: string
      readonly corporationId: string | null
      readonly fingerprint: string
      readonly traversalComplete: boolean
      readonly sourcesComplete: boolean
      readonly expectedSubjects: number
      readonly coverage: {
        readonly endCursor: string | null
        readonly hasNextPage: boolean
        readonly rows: ReadonlyArray<{
          readonly characterId: string
          readonly characterName: string
          readonly state: string
          readonly source: {
            readonly observationId: string
            readonly observedAt: string
            readonly validatedAt: string
            readonly freshUntil: string
            readonly retainedUntil: string
          } | null
        }>
      }
      readonly coverageCounts: {
        readonly includedCurrent: number
        readonly includedStale: number
        readonly authorizationRequired: number
        readonly neverCollected: number
        readonly unavailable: number
        readonly incomplete: number
        readonly beyondRetention: number
        readonly conflictingSource: number
      }
    } | null
  } | null
}

// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const TradingCorporationCoverageDocument =
  'fragment TradingInventoryStatus on TradingInventoryView {\n  version\n  scope\n  corporationId\n  fingerprint\n  traversalComplete\n  sourcesComplete\n  expectedSubjects\n  coverageCounts {\n    includedCurrent\n    includedStale\n    authorizationRequired\n    neverCollected\n    unavailable\n    incomplete\n    beyondRetention\n    conflictingSource\n  }\n}\n\nfragment TradingInventoryClock on TradingInventorySource {\n  observationId\n  observedAt\n  validatedAt\n  freshUntil\n  retainedUntil\n}\n\nquery TradingCorporationCoverage($corporationId: EveId!, $first: Int = 50, $after: String) {\n  trading {\n    corporationInventory(\n      corporationId: $corporationId\n      kind: coverage\n      first: $first\n      after: $after\n    ) {\n      ...TradingInventoryStatus\n      coverage {\n        endCursor\n        hasNextPage\n        rows {\n          characterId\n          characterName\n          state\n          source {\n            ...TradingInventoryClock\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<TradingCorporationCoverageQuery, TradingCorporationCoverageQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const TradingCorporationHoldersDocument =
  'fragment TradingInventoryStatus on TradingInventoryView {\n  version\n  scope\n  corporationId\n  fingerprint\n  traversalComplete\n  sourcesComplete\n  expectedSubjects\n  coverageCounts {\n    includedCurrent\n    includedStale\n    authorizationRequired\n    neverCollected\n    unavailable\n    incomplete\n    beyondRetention\n    conflictingSource\n  }\n}\n\nfragment TradingInventoryClock on TradingInventorySource {\n  observationId\n  observedAt\n  validatedAt\n  freshUntil\n  retainedUntil\n}\n\nquery TradingCorporationHolders($corporationId: EveId!, $groupKey: String!, $first: Int = 50, $after: String) {\n  trading {\n    corporationInventory(\n      corporationId: $corporationId\n      kind: holders\n      groupKey: $groupKey\n      first: $first\n      after: $after\n    ) {\n      ...TradingInventoryStatus\n      holders {\n        endCursor\n        hasNextPage\n        rows {\n          characterId\n          userId\n          characterName\n          groupKey\n          currentQuantity\n          staleQuantity\n          source {\n            ...TradingInventoryClock\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<TradingCorporationHoldersQuery, TradingCorporationHoldersQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const TradingCorporationInventoryDocument =
  'fragment TradingInventoryStatus on TradingInventoryView {\n  version\n  scope\n  corporationId\n  fingerprint\n  traversalComplete\n  sourcesComplete\n  expectedSubjects\n  coverageCounts {\n    includedCurrent\n    includedStale\n    authorizationRequired\n    neverCollected\n    unavailable\n    incomplete\n    beyondRetention\n    conflictingSource\n  }\n}\n\nfragment TradingInventoryGroups on TradingInventoryGroupPage {\n  endCursor\n  hasNextPage\n  rows {\n    key\n    typeId\n    typeName\n    groupId\n    categoryId\n    blueprint\n    location {\n      key\n      id\n      name\n      state\n    }\n    currentQuantity\n    staleQuantity\n  }\n}\n\nquery TradingCorporationInventory($corporationId: EveId!, $filters: TradingInventoryFilters, $first: Int = 50, $after: String) {\n  trading {\n    corporationInventory(\n      corporationId: $corporationId\n      filters: $filters\n      first: $first\n      after: $after\n    ) {\n      ...TradingInventoryStatus\n      groups {\n        ...TradingInventoryGroups\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<TradingCorporationInventoryQuery, TradingCorporationInventoryQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const TradingPersonalCoverageDocument =
  'fragment TradingInventoryStatus on TradingInventoryView {\n  version\n  scope\n  corporationId\n  fingerprint\n  traversalComplete\n  sourcesComplete\n  expectedSubjects\n  coverageCounts {\n    includedCurrent\n    includedStale\n    authorizationRequired\n    neverCollected\n    unavailable\n    incomplete\n    beyondRetention\n    conflictingSource\n  }\n}\n\nfragment TradingInventoryClock on TradingInventorySource {\n  observationId\n  observedAt\n  validatedAt\n  freshUntil\n  retainedUntil\n}\n\nquery TradingPersonalCoverage($characterIds: [EveId!], $first: Int = 50, $after: String) {\n  trading {\n    personalInventory(\n      characterIds: $characterIds\n      kind: coverage\n      first: $first\n      after: $after\n    ) {\n      ...TradingInventoryStatus\n      coverage {\n        endCursor\n        hasNextPage\n        rows {\n          characterId\n          characterName\n          state\n          source {\n            ...TradingInventoryClock\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<TradingPersonalCoverageQuery, TradingPersonalCoverageQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const TradingPersonalHoldersDocument =
  'fragment TradingInventoryStatus on TradingInventoryView {\n  version\n  scope\n  corporationId\n  fingerprint\n  traversalComplete\n  sourcesComplete\n  expectedSubjects\n  coverageCounts {\n    includedCurrent\n    includedStale\n    authorizationRequired\n    neverCollected\n    unavailable\n    incomplete\n    beyondRetention\n    conflictingSource\n  }\n}\n\nfragment TradingInventoryClock on TradingInventorySource {\n  observationId\n  observedAt\n  validatedAt\n  freshUntil\n  retainedUntil\n}\n\nquery TradingPersonalHolders($characterIds: [EveId!], $groupKey: String!, $first: Int = 50, $after: String) {\n  trading {\n    personalInventory(\n      characterIds: $characterIds\n      kind: holders\n      groupKey: $groupKey\n      first: $first\n      after: $after\n    ) {\n      ...TradingInventoryStatus\n      holders {\n        endCursor\n        hasNextPage\n        rows {\n          characterId\n          userId\n          characterName\n          groupKey\n          currentQuantity\n          staleQuantity\n          source {\n            ...TradingInventoryClock\n          }\n        }\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<TradingPersonalHoldersQuery, TradingPersonalHoldersQueryVariables>
// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.
export const TradingPersonalInventoryDocument =
  'fragment TradingInventoryStatus on TradingInventoryView {\n  version\n  scope\n  corporationId\n  fingerprint\n  traversalComplete\n  sourcesComplete\n  expectedSubjects\n  coverageCounts {\n    includedCurrent\n    includedStale\n    authorizationRequired\n    neverCollected\n    unavailable\n    incomplete\n    beyondRetention\n    conflictingSource\n  }\n}\n\nfragment TradingInventoryGroups on TradingInventoryGroupPage {\n  endCursor\n  hasNextPage\n  rows {\n    key\n    typeId\n    typeName\n    groupId\n    categoryId\n    blueprint\n    location {\n      key\n      id\n      name\n      state\n    }\n    currentQuantity\n    staleQuantity\n  }\n}\n\nquery TradingPersonalInventory($characterIds: [EveId!], $filters: TradingInventoryFilters, $first: Int = 50, $after: String) {\n  trading {\n    personalInventory(\n      characterIds: $characterIds\n      filters: $filters\n      first: $first\n      after: $after\n    ) {\n      ...TradingInventoryStatus\n      groups {\n        ...TradingInventoryGroups\n      }\n    }\n  }\n}' as string &
    GraphQLDocument<TradingPersonalInventoryQuery, TradingPersonalInventoryQueryVariables>
