import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'
import {
  intelligenceId as id,
  intelligenceTime as dateTime,
  intelligenceHistorySource as historySource,
  intelligenceBookSource as bookSource,
  intelligenceCatalogueRevision as catalogueRevision,
} from './intelligence-report.js'
import {
  intelligenceMetricInput,
  intelligenceMetrics as metrics,
} from './intelligence-representation.js'

const fence = { profileId: z.uuid(), profileRevision: id }
const target = z.strictObject({
  typeId: id,
  groupId: id,
  name: z.string().min(1).max(500),
  groupIds: z.array(id).min(1).max(4000),
})
const frozenInput = z.strictObject(target.shape).extend({
  historySource: historySource,
  bookSource: z.nullable(bookSource),
  metricsInput: intelligenceMetricInput,
})

export const listDueMarketIntelligenceDerivationsOperation = definePlatformPersistenceOperation({
  id: 'list-due-market-intelligence-derivations',
  method: 'listDueMarketIntelligenceDerivations',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ now: dateTime }),
  outputSchema: z
    .array(z.strictObject({ profileId: z.uuid(), revision: id, nextDueAt: dateTime }))
    .max(4),
  maximumInputBytes: 256,
  maximumOutputBytes: 4096,
})
export const selectMarketIntelligenceWorkOperation = definePlatformPersistenceOperation({
  id: 'select-market-intelligence-work',
  method: 'selectMarketIntelligenceWork',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(fence).extend({
    reconciliationDue: z.boolean(),
    historyDue: z.boolean(),
  }),
  outputSchema: z.strictObject({
    kind: z.enum(['reconciliation', 'history', 'derivation']).nullable(),
  }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})
export const beginMarketIntelligenceGenerationOperation = definePlatformPersistenceOperation({
  id: 'begin-market-intelligence-generation',
  method: 'beginMarketIntelligenceGeneration',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(fence).extend({
    generationId: z.uuid(),
    cursorSecret: z.uuid(),
    ignoredTypeIds: z.array(id).max(16),
    policyRevision: z.number().int().nonnegative().safe(),
    universeId: z.uuid().nullable(),
    catalogueRevision: z.nullable(catalogueRevision),
    watchedTargets: z.array(target).max(16),
    excludedTypeCount: z.number().int().min(0).max(32000),
    excludedGroupIds: z.array(id).max(4000),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['started', 'deferred']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})
export const readMarketIntelligenceInputPageOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-input-page',
  method: 'readMarketIntelligenceInputPage',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(fence),
  outputSchema: z
    .strictObject({
      generationId: z.uuid(),
      cursorTypeId: z.number().int().nonnegative().safe(),
      rows: z.array(frozenInput).max(100),
    })
    .nullable(),
  maximumInputBytes: 256,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})
export const stageMarketIntelligenceOutputsOperation = definePlatformPersistenceOperation({
  id: 'stage-market-intelligence-outputs',
  method: 'stageMarketIntelligenceOutputs',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(fence).extend({
    generationId: z.uuid(),
    cursorTypeId: z.number().int().nonnegative().safe(),
    rows: z.array(z.strictObject({ typeId: id, metrics })).max(100),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['staged', 'obsolete']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})
export const publishMarketIntelligenceGenerationOperation = definePlatformPersistenceOperation({
  id: 'publish-market-intelligence-generation',
  method: 'publishMarketIntelligenceGeneration',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(fence).extend({ generationId: z.uuid() }),
  outputSchema: z.strictObject({ outcome: z.enum(['published', 'obsolete']) }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})
export const cleanupMarketIntelligenceGenerationsOperation = definePlatformPersistenceOperation({
  id: 'cleanup-market-intelligence-generations',
  method: 'cleanupMarketIntelligenceGenerations',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ now: dateTime }),
  outputSchema: z.strictObject({ removed: z.number().int().min(0).max(1) }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})
export const recordMarketIntelligenceCatalogueOperation = definePlatformPersistenceOperation({
  id: 'record-market-intelligence-catalogue',
  method: 'recordMarketIntelligenceCatalogue',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(fence).extend({ catalogueRevision: catalogueRevision }),
  outputSchema: z.strictObject({ outcome: z.enum(['recorded', 'obsolete']) }),
  maximumInputBytes: 1024,
  maximumOutputBytes: 256,
})
const marketIntelligenceGenerationPersistenceOperations = {
  'record-market-intelligence-catalogue': recordMarketIntelligenceCatalogueOperation,
  'list-due-market-intelligence-derivations': listDueMarketIntelligenceDerivationsOperation,
  'select-market-intelligence-work': selectMarketIntelligenceWorkOperation,
  'begin-market-intelligence-generation': beginMarketIntelligenceGenerationOperation,
  'read-market-intelligence-input-page': readMarketIntelligenceInputPageOperation,
  'stage-market-intelligence-outputs': stageMarketIntelligenceOutputsOperation,
  'publish-market-intelligence-generation': publishMarketIntelligenceGenerationOperation,
  'cleanup-market-intelligence-generations': cleanupMarketIntelligenceGenerationsOperation,
} as const
export type MarketIntelligenceGenerationReads = PlatformPersistenceMethodsFor<
  typeof marketIntelligenceGenerationPersistenceOperations,
  readonly ['list-due-market-intelligence-derivations', 'read-market-intelligence-input-page']
>
export type MarketIntelligenceGenerationWrites = PlatformPersistenceMethodsFor<
  typeof marketIntelligenceGenerationPersistenceOperations,
  readonly [
    'record-market-intelligence-catalogue',
    'select-market-intelligence-work',
    'begin-market-intelligence-generation',
    'stage-market-intelligence-outputs',
    'publish-market-intelligence-generation',
    'cleanup-market-intelligence-generations',
  ]
>
