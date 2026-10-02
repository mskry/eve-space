import {
  definePlatformGraphQLRead,
  type PlatformGraphQLReadCapabilities,
} from '@eve-space/platform-module-contract/graphql'
import { z } from 'zod'
import { readEnabledMarketHistory } from './history-reads.js'
import { readMarketReferencePrices, validMarketReferenceTypes } from './reference-price-reads.js'
import { MarketReadError, marketReadId, marketReadInput } from './read-input.js'

type HistoryCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  Parameters<typeof readEnabledMarketHistory>[0]
>
type ReferenceCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  Parameters<typeof readMarketReferencePrices>[0]
>
const historyInput = z.strictObject({ profileId: z.uuid(), typeId: marketReadId })
const referenceInput = z.strictObject({
  typeIds: z.array(marketReadId).min(1).max(100).refine(validMarketReferenceTypes),
})

export const historyRead = definePlatformGraphQLRead<HistoryCapabilities>(
  async ({ args, capabilities }) => {
    const { profileId, typeId } = marketReadInput(historyInput, args)
    const history = await readEnabledMarketHistory(capabilities.persistence, profileId, typeId)
    if (!history) throw new MarketReadError('MARKET_HISTORY_PROFILE_UNAVAILABLE', 404)
    if (history.freshness === 'current' && history.freshUntil)
      capabilities.cache.publicUntil(history.freshUntil, 60)
    else capabilities.cache.noStore()
    return history
  },
)

export const referencePricesRead = definePlatformGraphQLRead<ReferenceCapabilities>(
  async ({ args, capabilities }) => {
    const { typeIds } = marketReadInput(referenceInput, args)
    const reference = await readMarketReferencePrices(capabilities.persistence, typeIds)
    capabilities.cache.noStore()
    return reference
  },
)
