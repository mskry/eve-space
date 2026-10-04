import {
  definePlatformGraphQLRead,
  type PlatformGraphQLDefinition,
  type PlatformGraphQLReadCapabilities,
} from '@eve-space/platform-module-contract/graphql'
import { inventoryReadInput } from './read-input.js'
import { presentView, projectRows } from './presentation.js'

export const tradingGraphQL: PlatformGraphQLDefinition = {
  typeDefs: `
    extend type Query { trading: TradingRead }
    type TradingRead {
      personalInventory(characterIds: [EveId!], kind: TradingInventoryKind = groups, filters: TradingInventoryFilters, groupKey: String, first: Int = 50, after: String): TradingInventoryView
      corporationInventory(corporationId: EveId!, kind: TradingInventoryKind = groups, filters: TradingInventoryFilters, groupKey: String, first: Int = 50, after: String): TradingInventoryView
    }
    enum TradingInventoryKind { groups holders coverage }
    input TradingInventoryFilters { typeId: EveId, groupId: EveId, categoryId: EveId, locationKey: String }
    type TradingInventoryView {
      version: Int!, scope: String!, corporationId: EveId, fingerprint: String!, traversalComplete: Boolean!, sourcesComplete: Boolean!, expectedSubjects: Int!, coverageCounts: TradingInventoryCoverageCounts!, groups: TradingInventoryGroupPage!, holders: TradingInventoryHolderPage!, coverage: TradingInventoryCoveragePage!
    }
    type TradingInventoryCoverageCounts {
      includedCurrent: Int!, includedStale: Int!, authorizationRequired: Int!, neverCollected: Int!, unavailable: Int!, incomplete: Int!, beyondRetention: Int!, conflictingSource: Int!
    }
    type TradingInventoryGroupPage { rows: [TradingInventoryGroup!]!, endCursor: String, hasNextPage: Boolean! }
    type TradingInventoryHolderPage { rows: [TradingInventoryHolder!]!, endCursor: String, hasNextPage: Boolean! }
    type TradingInventoryCoveragePage { rows: [TradingInventoryCoverage!]!, endCursor: String, hasNextPage: Boolean! }
    type TradingInventoryGroup { key: String!, typeId: EveId!, typeName: String, groupId: EveId, categoryId: EveId, blueprint: String!, location: TradingInventoryLocation!, currentQuantity: BigInteger!, staleQuantity: BigInteger! }
    type TradingInventoryLocation { key: String!, id: EveId, name: String, state: String! }
    type TradingInventoryHolder { characterId: EveId!, userId: UUID!, characterName: String!, groupKey: String!, currentQuantity: BigInteger!, staleQuantity: BigInteger!, source: TradingInventorySource! }
    type TradingInventorySource { observationId: String!, observedAt: UTCTime!, validatedAt: UTCTime!, freshUntil: UTCTime!, retainedUntil: UTCTime! }
    type TradingInventoryCoverage { characterId: EveId!, characterName: String!, state: String!, source: TradingInventorySource }
  `,
  reads: {
    'Query.trading': () => ({}),
    'TradingRead.personalInventory': definePlatformGraphQLRead<
      PlatformGraphQLReadCapabilities<readonly [], object, 'personal'>
    >(async ({ args, capabilities }) => {
      capabilities.cache.noStore()
      return presentView(await capabilities.inventory.personalInventory(inventoryReadInput(args)))
    }),
    'TradingRead.corporationInventory': definePlatformGraphQLRead<
      PlatformGraphQLReadCapabilities<readonly [], object, 'corporation'>
    >(async ({ args, capabilities }) => {
      capabilities.cache.noStore()
      return presentView(
        await capabilities.inventory.corporationInventory(inventoryReadInput(args)),
      )
    }),
    'TradingInventoryGroupPage.rows': ({ parent }) => projectRows(parent),
    'TradingInventoryHolderPage.rows': ({ parent }) => projectRows(parent),
    'TradingInventoryCoveragePage.rows': ({ parent }) => projectRows(parent),
  },
}
