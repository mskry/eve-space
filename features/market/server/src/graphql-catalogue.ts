import {
  definePlatformGraphQLRead,
  type PlatformGraphQLReadCapabilities,
} from '@eve-space/platform-module-contract/graphql'
import { z } from 'zod'
import { readMarketCatalogue } from './catalogue-reads.js'
import {
  MarketReadError,
  marketReadId,
  marketReadInput,
  marketReadPageSize,
  marketReadRevision,
  marketOptionalCatalogueCursor,
} from './read-input.js'

type Capabilities = PlatformGraphQLReadCapabilities<readonly ['market-catalogue']>
const typeInput = z.strictObject({ revision: marketReadRevision, typeId: marketReadId })
const groupInput = z.strictObject({
  revision: marketReadRevision,
  groupId: marketReadId,
  first: marketReadPageSize,
  after: marketOptionalCatalogueCursor,
})

export const catalogueRevisionRead = definePlatformGraphQLRead<Capabilities>(
  async ({ capabilities }) => {
    const outcome = await readMarketCatalogue(capabilities.coreData, { kind: 'revision' })
    if (!outcome.ok) throw new MarketReadError(outcome.code, outcome.status)
    capabilities.cache.publicUntil(new Date(Date.now() + 30_000).toISOString(), 30)
    return { key: outcome.key, ...outcome.value.revision }
  },
)

export const catalogueTypeRead = definePlatformGraphQLRead<Capabilities>(
  async ({ args, capabilities }) => {
    const input = marketReadInput(typeInput, args)
    const outcome = await readMarketCatalogue(
      capabilities.coreData,
      {
        kind: 'type-by-id',
        typeId: input.typeId,
      },
      input.revision,
    )
    if (!outcome.ok) throw new MarketReadError(outcome.code, outcome.status)
    capabilities.cache.publicUntil(new Date(Date.now() + 30_000).toISOString(), 30)
    return { revision: input.revision, item: outcome.value.item }
  },
)

export const catalogueGroupTypesRead = definePlatformGraphQLRead<Capabilities>(
  async ({ args, capabilities }) => {
    const { revision, groupId, first, after } = marketReadInput(groupInput, args)
    const outcome = await readMarketCatalogue(
      capabilities.coreData,
      {
        kind: 'group-types',
        groupId,
        cursor: after,
        pageSize: first,
      },
      revision,
    )
    if (!outcome.ok) throw new MarketReadError(outcome.code, outcome.status)
    const { items, nextCursor } = outcome.value
    capabilities.cache.publicUntil(new Date(Date.now() + 30_000).toISOString(), 30)
    return { revision, groupId, items, nextCursor }
  },
)
