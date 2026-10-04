import { z } from 'zod'
import {
  intelligenceQuantity,
  intelligenceMetrics,
  intelligenceSourceState,
} from './intelligence-representation.js'

export const intelligenceId = z.number().int().positive().safe()
export const intelligenceTime = z.iso.datetime({ offset: true })
export const intelligenceCatalogueRevision = z.strictObject({
  buildNumber: intelligenceId,
  ingestVersion: intelligenceId,
  ingestedAt: intelligenceTime,
})
export const intelligenceHistorySource = z.strictObject({
  state: intelligenceSourceState,
  validatedAt: z.nullable(intelligenceTime),
  freshUntil: z.nullable(intelligenceTime),
  contentRevision: intelligenceQuantity,
  lastAttemptAt: z.nullable(intelligenceTime),
  lastFailureClass: z.string().max(100).nullable(),
})
export const intelligenceBookSource = z.strictObject({
  observationId: z.uuid(),
  observedAt: intelligenceTime,
  validatedAt: intelligenceTime,
  freshUntil: intelligenceTime,
})
export const intelligenceGeneration = z.strictObject({
  generationId: z.uuid(),
  profileId: z.uuid(),
  profileRevision: intelligenceQuantity,
  policyRevision: intelligenceQuantity,
  catalogueRevision: intelligenceCatalogueRevision,
  formulaVersion: z.literal(1),
  anchorDate: z.iso.date(),
  regionId: intelligenceId,
  bookScope: z.enum(['region', 'stations', 'global-plex']),
  historyScope: z.enum(['region', 'global-plex']),
  targetCount: z.number().int().min(0).max(32000),
  excludedTypeCount: z.number().int().min(0).max(32000),
  createdAt: intelligenceTime,
  publishedAt: intelligenceTime,
  expiresAt: z.nullable(intelligenceTime),
})
export const intelligenceRow = z.strictObject({
  typeId: intelligenceId,
  groupId: intelligenceId,
  name: z.string().min(1).max(500),
  historySource: intelligenceHistorySource,
  bookSource: z.nullable(intelligenceBookSource),
  metrics: intelligenceMetrics,
})
export const intelligenceCoverageCounts = z.strictObject({
  eligibleCount: z.number().int().min(0).max(32000),
  neverAttempted: z.number().int().min(0).max(32000),
  freshSuccess: z.number().int().min(0).max(32000),
  staleSuccess: z.number().int().min(0).max(32000),
  failedWithoutSuccess: z.number().int().min(0).max(32000),
  emptySource: z.number().int().min(0).max(32000),
  failedLastAttempt: z.number().int().min(0).max(32000),
  latestAttemptAt: z.nullable(intelligenceTime),
  oldestDueAt: z.nullable(intelligenceTime),
})

export type IntelligenceGeneration = z.infer<typeof intelligenceGeneration>
