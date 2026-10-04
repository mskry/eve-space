import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'
import { marketIntelligenceBounds } from './intelligence-policy.js'

const id = z.number().int().positive().safe()
const revision = z.number().int().nonnegative().safe()
const catalogueRevision = z.strictObject({
  buildNumber: id,
  ingestVersion: id,
  ingestedAt: z.iso.datetime({ offset: true }),
})
const fence = { profileId: z.uuid(), profileRevision: id, policyRevision: id }
const generationFence = z.strictObject(fence).extend({ universeId: z.uuid() })
export const listDueMarketIntelligenceReconciliationsOperation = definePlatformPersistenceOperation(
  {
    id: 'list-due-market-intelligence-reconciliations',
    method: 'listDueMarketIntelligenceReconciliations',
    revision: 1,
    mode: 'read',
    inputSchema: z.strictObject({ now: z.iso.datetime({ offset: true }) }),
    outputSchema: z
      .array(
        z.strictObject({
          profileId: z.uuid(),
          revision: id,
          nextDueAt: z.iso.datetime({ offset: true }),
        }),
      )
      .max(4),
    maximumInputBytes: 256,
    maximumOutputBytes: 4_096,
  },
)

export const recordMarketIntelligenceReconciliationOperation = definePlatformPersistenceOperation({
  id: 'record-market-intelligence-reconciliation',
  method: 'recordMarketIntelligenceReconciliation',
  revision: 1,
  mode: 'write',
  inputSchema: z
    .strictObject(generationFence.shape)
    .extend({ catalogueRevision: catalogueRevision }),
  outputSchema: z.strictObject({ outcome: z.enum(['recorded', 'obsolete']) }),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 256,
})
const universe = z.strictObject({
  universeId: z.uuid(),
  profileRevision: id,
  policyRevision: id,
  catalogueRevision: catalogueRevision,
  targetCount: z.number().int().min(0).max(marketIntelligenceBounds.maximumTypes),
  excludedTypeCount: z.number().int().min(0).max(marketIntelligenceBounds.maximumTypes),
  excludedGroupIds: z.array(id).max(marketIntelligenceBounds.maximumGroups),
  stagedCount: z.number().int().min(0).max(marketIntelligenceBounds.maximumTypes),
  status: z.enum(['staging', 'complete']),
})

export const readMarketIntelligencePolicyOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-policy',
  method: 'readMarketIntelligencePolicy',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ profileId: z.uuid() }),
  outputSchema: z
    .strictObject({
      enabled: z.boolean(),
      revision,
      ignoredGroupIds: z.array(id).max(marketIntelligenceBounds.maximumIgnoredGroups),
      catalogueRevision: z.nullable(catalogueRevision),
    })
    .nullable(),
  maximumInputBytes: 256,
  maximumOutputBytes: 8_192,
})

export const saveMarketIntelligencePolicyOperation = definePlatformPersistenceOperation({
  id: 'save-market-intelligence-policy',
  method: 'saveMarketIntelligencePolicy',
  revision: 1,
  mode: 'write',
  inputSchema: z
    .strictObject({
      profileId: z.uuid(),
      profileRevision: id,
      expectedPolicyRevision: revision,
      enabled: z.boolean(),
      ignoredGroupIds: z.array(id).max(marketIntelligenceBounds.maximumIgnoredGroups),
      catalogueRevision: catalogueRevision,
      requestId: z.uuid(),
    })
    .refine((input) => new Set(input.ignoredGroupIds).size === input.ignoredGroupIds.length),
  outputSchema: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('saved'), revision: id }),
    z.strictObject({ outcome: z.literal('obsolete') }),
  ]),
  maximumInputBytes: 8_192,
  maximumOutputBytes: 256,
})

export const readMarketIntelligenceUniverseOperation = definePlatformPersistenceOperation({
  id: 'read-market-intelligence-universe',
  method: 'readMarketIntelligenceUniverse',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject(fence),
  outputSchema: z
    .strictObject({ active: z.nullable(universe), staging: z.nullable(universe) })
    .nullable(),
  maximumInputBytes: 512,
  maximumOutputBytes: 100_000,
})

export const beginMarketIntelligenceUniverseOperation = definePlatformPersistenceOperation({
  id: 'begin-market-intelligence-universe',
  method: 'beginMarketIntelligenceUniverse',
  revision: 1,
  mode: 'write',
  inputSchema: z
    .strictObject(generationFence.shape)
    .extend({
      catalogueRevision: catalogueRevision,
      targetCount: universe.shape.targetCount,
      excludedTypeCount: universe.shape.excludedTypeCount,
      excludedGroupIds: universe.shape.excludedGroupIds,
    })
    .refine(
      ({ targetCount, excludedTypeCount }) =>
        targetCount + excludedTypeCount <= marketIntelligenceBounds.maximumTypes,
    ),
  outputSchema: z.strictObject({ outcome: z.enum(['started', 'obsolete', 'busy']) }),
  maximumInputBytes: 100_000,
  maximumOutputBytes: 256,
})

export const stageMarketIntelligenceTargetsOperation = definePlatformPersistenceOperation({
  id: 'stage-market-intelligence-targets',
  method: 'stageMarketIntelligenceTargets',
  revision: 1,
  mode: 'write',
  inputSchema: z
    .strictObject(generationFence.shape)
    .extend({
      targets: z
        .array(
          z.strictObject({
            typeId: id,
            groupId: id,
            name: z.string().min(1).max(500),
            groupIds: z.array(id).min(1).max(marketIntelligenceBounds.maximumGroups),
          }),
        )
        .min(1)
        .max(marketIntelligenceBounds.maximumStagingTypes),
    })
    .refine(
      (input) => new Set(input.targets.map(({ typeId }) => typeId)).size === input.targets.length,
    ),
  outputSchema: z.strictObject({ outcome: z.enum(['staged', 'obsolete', 'inconsistent']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const activateMarketIntelligenceUniverseOperation = definePlatformPersistenceOperation({
  id: 'activate-market-intelligence-universe',
  method: 'activateMarketIntelligenceUniverse',
  revision: 1,
  mode: 'write',
  inputSchema: generationFence,
  outputSchema: z.strictObject({ outcome: z.enum(['activated', 'obsolete', 'incomplete']) }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const stageMarketIntelligenceExclusionsOperation = definePlatformPersistenceOperation({
  id: 'stage-market-intelligence-exclusions',
  method: 'stageMarketIntelligenceExclusions',
  revision: 1,
  mode: 'write',
  inputSchema: stageMarketIntelligenceTargetsOperation.inputSchema,
  outputSchema: stageMarketIntelligenceTargetsOperation.outputSchema,
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

const marketIntelligencePersistenceOperations = {
  'list-due-market-intelligence-reconciliations': listDueMarketIntelligenceReconciliationsOperation,
  'record-market-intelligence-reconciliation': recordMarketIntelligenceReconciliationOperation,
  'read-market-intelligence-policy': readMarketIntelligencePolicyOperation,
  'save-market-intelligence-policy': saveMarketIntelligencePolicyOperation,
  'read-market-intelligence-universe': readMarketIntelligenceUniverseOperation,
  'begin-market-intelligence-universe': beginMarketIntelligenceUniverseOperation,
  'stage-market-intelligence-targets': stageMarketIntelligenceTargetsOperation,
  'activate-market-intelligence-universe': activateMarketIntelligenceUniverseOperation,
  'stage-market-intelligence-exclusions': stageMarketIntelligenceExclusionsOperation,
} as const

export type MarketIntelligencePolicyReads = PlatformPersistenceMethodsFor<
  typeof marketIntelligencePersistenceOperations,
  readonly ['read-market-intelligence-policy']
>
export type MarketIntelligencePolicyWrites = PlatformPersistenceMethodsFor<
  typeof marketIntelligencePersistenceOperations,
  readonly ['save-market-intelligence-policy']
>
export type MarketIntelligenceUniverseReads = PlatformPersistenceMethodsFor<
  typeof marketIntelligencePersistenceOperations,
  readonly ['read-market-intelligence-universe', 'list-due-market-intelligence-reconciliations']
>
export type MarketIntelligenceUniverseWrites = PlatformPersistenceMethodsFor<
  typeof marketIntelligencePersistenceOperations,
  readonly [
    'begin-market-intelligence-universe',
    'stage-market-intelligence-targets',
    'stage-market-intelligence-exclusions',
    'activate-market-intelligence-universe',
    'record-market-intelligence-reconciliation',
  ]
>
