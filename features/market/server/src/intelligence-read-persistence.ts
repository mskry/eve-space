import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'
import {
  intelligenceGeneration,
  intelligenceRow,
  intelligenceCoverageCounts,
  intelligenceCatalogueRevision,
  intelligenceTime,
  intelligenceId,
  intelligenceHistorySource,
} from './intelligence-report.js'
import { intelligenceQuantity } from './intelligence-representation.js'
import { intelligenceMetricId } from './intelligence-query.js'

const profile = { profileId: z.uuid() }
const generation = z.strictObject(profile).extend({ generationId: z.uuid() })
const counts = z.number().int().min(0).max(32000)
const threshold = z.string().regex(/^(?:0|[1-9]\d{0,79})(?:\.\d{1,6})?$/)
const day = z.strictObject({
  date: z.iso.date(),
  averageIsk: z.string(),
  highIsk: z.string(),
  lowIsk: z.string(),
  volume: intelligenceQuantity,
  orderCount: intelligenceQuantity,
})

export const readMarketIntelligenceGenerationOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-generation',
  method: 'readMarketIntelligenceGeneration',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(profile).extend({ generationId: z.uuid().nullable() }),
  outputSchema: z
    .strictObject({ generation: intelligenceGeneration, cursorSecret: z.uuid() })
    .nullable(),
  maximumInputBytes: 256,
  maximumOutputBytes: 4096,
})
export const readMarketIntelligencePageOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-page',
  method: 'readMarketIntelligencePage',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(generation.shape).extend({
    typeIds: z.array(intelligenceId).max(100),
    groupIds: z.array(intelligenceId).max(100),
    first: z.number().int().min(1).max(100),
    minimumAverageDailyValueIsk: threshold,
    minimumAverageDailyOrders: threshold,
    minimumBaselineDays: z.number().int().min(0).max(365),
    includeStale: z.boolean(),
    sort: intelligenceMetricId,
    direction: z.enum(['ASC', 'DESC']),
    needsHistory: z.boolean(),
    needsBook: z.boolean(),
    lastKey: z
      .string()
      .max(322)
      .regex(/^-?\d{1,160}(?:\.\d{1,160})?$/)
      .nullable(),
    lastTypeId: z.nullable(intelligenceId),
  }),
  outputSchema: z
    .strictObject({
      total: counts,
      omittedNullSortCount: counts,
      rows: z
        .array(z.strictObject({ sortKey: z.string().max(322), row: intelligenceRow }))
        .max(101),
    })
    .nullable(),
  maximumInputBytes: 8192,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})
export const readMarketIntelligenceItemOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-item',
  method: 'readMarketIntelligenceItem',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(generation.shape).extend({ typeId: intelligenceId }),
  outputSchema: z
    .strictObject({
      status: z.enum(['ignored', 'unavailable', 'uncollected', 'observed']),
      row: z.nullable(intelligenceRow),
    })
    .nullable(),
  maximumInputBytes: 256,
  maximumOutputBytes: 32768,
})
export const readMarketIntelligenceCoverageOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-coverage',
  method: 'readMarketIntelligenceCoverage',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(profile),
  outputSchema: z
    .strictObject(profile)
    .extend({
      profileRevision: intelligenceQuantity,
      regionId: intelligenceId,
      bookScope: z.enum(['region', 'stations', 'global-plex']),
      historyScope: z.enum(['region', 'global-plex']),
      policyRevision: intelligenceQuantity,
      policyEnabled: z.boolean(),
      ignoredGroupIds: z.array(intelligenceId).max(256),
      catalogueRevision: z.nullable(intelligenceCatalogueRevision),
      excludedTypeCount: z.nullable(counts),
      evaluatedAt: intelligenceTime,
      live: intelligenceCoverageCounts,
      generation: z
        .strictObject({
          generation: intelligenceGeneration,
          evaluatedAt: intelligenceTime,
          counts: intelligenceCoverageCounts,
        })
        .nullable(),
    })
    .nullable(),
  maximumInputBytes: 256,
  maximumOutputBytes: 32768,
})
export const readMarketIntelligenceHistoryRangeOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-history-range',
  method: 'readMarketIntelligenceHistoryRange',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(profile).extend({
    typeId: intelligenceId,
    from: z.iso.date(),
    through: z.iso.date(),
  }),
  outputSchema: z
    .strictObject(profile)
    .extend({
      profileRevision: intelligenceQuantity,
      regionId: intelligenceId,
      typeId: intelligenceId,
      from: z.iso.date(),
      through: z.iso.date(),
      retainedEvidence: z.boolean(),
      source: z.nullable(intelligenceHistorySource),
      days: z.array(day).max(365),
    })
    .nullable(),
  maximumInputBytes: 512,
  maximumOutputBytes: 524288,
})

const marketIntelligenceReadPersistenceOperations = {
  'read-market-intelligence-generation': readMarketIntelligenceGenerationOperation,
  'read-market-intelligence-page': readMarketIntelligencePageOperation,
  'read-market-intelligence-item': readMarketIntelligenceItemOperation,
  'read-market-intelligence-coverage': readMarketIntelligenceCoverageOperation,
  'read-market-intelligence-history-range': readMarketIntelligenceHistoryRangeOperation,
} as const
export type MarketIntelligenceReads = PlatformPersistenceMethodsFor<
  typeof marketIntelligenceReadPersistenceOperations,
  readonly [
    'read-market-intelligence-generation',
    'read-market-intelligence-page',
    'read-market-intelligence-item',
    'read-market-intelligence-coverage',
    'read-market-intelligence-history-range',
  ]
>
