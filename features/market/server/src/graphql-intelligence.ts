import {
  definePlatformGraphQLRead,
  type PlatformGraphQLReadCapabilities,
} from '@eve-space/platform-module-contract/graphql'
import { marketIntelligenceMetricDefinitions } from './intelligence-definitions.js'
import {
  readMarketIntelligence,
  readMarketIntelligenceItem,
  readMarketIntelligenceCoverage,
  readMarketIntelligenceHistoryRange,
} from './intelligence-reads.js'
import { marketReadInput } from './read-input.js'
import { z } from 'zod'

type PageCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  Parameters<typeof readMarketIntelligence>[0]
>
type ItemCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  Parameters<typeof readMarketIntelligenceItem>[0]
>
type CoverageCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  Parameters<typeof readMarketIntelligenceCoverage>[0]
>
type RangeCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  Parameters<typeof readMarketIntelligenceHistoryRange>[0]
>

export const intelligenceRead = definePlatformGraphQLRead<PageCapabilities>(
  async ({ args, capabilities }) => {
    capabilities.cache.noStore()
    const { input } = marketReadInput(z.strictObject({ input: z.unknown() }), args)
    return readMarketIntelligence(capabilities.persistence, input, capabilities.signal)
  },
)
export const intelligenceItemRead = definePlatformGraphQLRead<ItemCapabilities>(
  async ({ args, capabilities }) => {
    capabilities.cache.noStore()
    return readMarketIntelligenceItem(capabilities.persistence, args, capabilities.signal)
  },
)
export const intelligenceCoverageRead = definePlatformGraphQLRead<CoverageCapabilities>(
  async ({ args, capabilities }) => {
    capabilities.cache.noStore()
    capabilities.signal.throwIfAborted()
    return readMarketIntelligenceCoverage(capabilities.persistence, args)
  },
)
export const intelligenceHistoryRangeRead = definePlatformGraphQLRead<RangeCapabilities>(
  async ({ args, capabilities }) => {
    capabilities.cache.noStore()
    capabilities.signal.throwIfAborted()
    return readMarketIntelligenceHistoryRange(capabilities.persistence, args)
  },
)
export const intelligenceDefinitionsRead = () => marketIntelligenceMetricDefinitions()
