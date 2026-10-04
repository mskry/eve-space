import type { PlatformModuleResourceCapabilities } from '@eve-space/platform-module-contract/resources'
import { platformPersistencePayloadMaximumBytes } from '@eve-space/platform-module-server'
import {
  buildMarketIntelligenceUniverse,
  marketIntelligenceBounds,
  type MarketIntelligenceTarget,
} from './intelligence-policy.js'
import type {
  MarketIntelligencePolicyReads,
  MarketIntelligenceUniverseReads,
  MarketIntelligenceUniverseWrites,
} from './intelligence-persistence.js'

type ReconciliationPersistence = MarketIntelligencePolicyReads &
  MarketIntelligenceUniverseReads &
  MarketIntelligenceUniverseWrites
type ReconciliationContext = {
  readonly profileId: string
  readonly expectedRevision: number
  readonly capabilities: PlatformModuleResourceCapabilities<
    ReconciliationPersistence,
    readonly ['market-catalogue']
  >
  readonly signal: AbortSignal
  readonly assertCurrent: () => Promise<boolean>
}
type CatalogueRevision = ReturnType<typeof buildMarketIntelligenceUniverse>['revision']

const matchesRevision = (left: CatalogueRevision, right: CatalogueRevision) =>
  left.buildNumber === right.buildNumber &&
  left.ingestVersion === right.ingestVersion &&
  left.ingestedAt === right.ingestedAt

const targetBatches = (targets: readonly MarketIntelligenceTarget[], overhead: number) => {
  const encoder = new TextEncoder()
  const batches: MarketIntelligenceTarget[][] = []
  let batch: MarketIntelligenceTarget[] = []
  let bytes = overhead
  for (const target of targets) {
    const targetBytes = encoder.encode(JSON.stringify(target)).byteLength + 1
    if (targetBytes + overhead > platformPersistencePayloadMaximumBytes)
      throw new RangeError('Market target exceeds persistence byte bound')
    if (
      batch.length === marketIntelligenceBounds.maximumStagingTypes ||
      bytes + targetBytes > platformPersistencePayloadMaximumBytes
    ) {
      batches.push(batch)
      batch = []
      bytes = overhead
    }
    batch.push(target)
    bytes += targetBytes
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

const stageTargets = async (
  context: ReconciliationContext,
  input: { profileId: string; profileRevision: number; policyRevision: number; universeId: string },
  targets: readonly MarketIntelligenceTarget[],
  stage: ReconciliationPersistence['stageMarketIntelligenceTargets'],
) => {
  const overhead = new TextEncoder().encode(JSON.stringify({ ...input, targets: [] })).byteLength
  for (const batch of targetBatches(targets, overhead)) {
    context.signal.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Complete bounded catalogue batches under the current deployment fence.
    if (!(await context.assertCurrent())) return 'obsolete' as const
    // oxlint-disable-next-line no-await-in-loop -- Idempotent batches reconstruct an interrupted universe before atomic activation.
    const staged = await stage({
      ...input,
      targets: batch.map(({ typeId, groupId, name, groupIds }) => ({
        typeId,
        groupId,
        name,
        groupIds: [...groupIds],
      })),
    })
    if (staged.outcome !== 'staged') return 'obsolete' as const
  }
  return 'completed' as const
}

const stageUniverse = async (
  context: ReconciliationContext,
  input: { profileId: string; profileRevision: number; policyRevision: number; universeId: string },
  universe: ReturnType<typeof buildMarketIntelligenceUniverse>,
) => {
  const { persistence } = context.capabilities
  if (
    (await stageTargets(
      context,
      input,
      universe.targets,
      persistence.stageMarketIntelligenceTargets,
    )) === 'obsolete'
  )
    return 'obsolete' as const
  if (
    (await stageTargets(
      context,
      input,
      universe.excludedTargets,
      persistence.stageMarketIntelligenceExclusions,
    )) === 'obsolete'
  )
    return 'obsolete' as const
  context.signal.throwIfAborted()
  if (!(await context.assertCurrent())) return 'obsolete' as const
  const result = await context.capabilities.persistence.activateMarketIntelligenceUniverse(input)
  return result.outcome === 'activated' ? ('completed' as const) : ('obsolete' as const)
}

export const reconcileMarketIntelligence = async (
  context: ReconciliationContext,
  regionId: number,
): Promise<'completed' | 'obsolete'> => {
  const { persistence, coreData } = context.capabilities
  const policy = await persistence.readMarketIntelligencePolicy({ profileId: context.profileId })
  if (!policy?.enabled) return 'obsolete'
  const fence = {
    profileId: context.profileId,
    profileRevision: context.expectedRevision,
    policyRevision: policy.revision,
  }
  const tree = await coreData.marketCatalogue({ kind: 'tree', signal: context.signal })
  const index = await coreData.marketCatalogue({ kind: 'search-index', signal: context.signal })
  context.signal.throwIfAborted()
  if (tree.kind !== 'tree' || index.kind !== 'search-index')
    throw new TypeError('Market reconciliation received incorrect catalogue products')
  const universe = buildMarketIntelligenceUniverse(tree, index, policy, {
    mode: 'region',
    regionId,
    watchedTypeIds: [],
  })
  const state = await persistence.readMarketIntelligenceUniverse(fence)
  if (!state || !(await context.assertCurrent())) return 'obsolete'
  if (state.active && matchesRevision(state.active.catalogueRevision, universe.revision)) {
    const result = await persistence.recordMarketIntelligenceReconciliation({
      ...fence,
      universeId: state.active.universeId,
      catalogueRevision: universe.revision,
    })
    return result.outcome === 'recorded' ? 'completed' : 'obsolete'
  }
  const universeId =
    state.staging && matchesRevision(state.staging.catalogueRevision, universe.revision)
      ? state.staging.universeId
      : crypto.randomUUID()
  const begun = await persistence.beginMarketIntelligenceUniverse({
    ...fence,
    universeId,
    catalogueRevision: universe.revision,
    targetCount: universe.targets.length,
    excludedTypeCount: universe.excludedTypeCount,
    excludedGroupIds: [...universe.excludedGroupIds],
  })
  if (begun.outcome !== 'started') return 'obsolete'
  return stageUniverse(context, { ...fence, universeId }, universe)
}
