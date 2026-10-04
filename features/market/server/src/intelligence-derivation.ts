import type { PlatformModuleResourceCapabilities } from '@eve-space/platform-module-contract/resources'
import { deriveMarketIntelligenceMetrics } from './intelligence-metrics.js'
import { buildMarketIntelligenceUniverse, marketIntelligenceBounds } from './intelligence-policy.js'
import type {
  MarketIntelligenceGenerationReads,
  MarketIntelligenceGenerationWrites,
} from './intelligence-generation-persistence.js'
import type {
  MarketIntelligencePolicyReads,
  MarketIntelligenceUniverseReads,
} from './intelligence-persistence.js'
import type { MarketProfileReads } from './persistence.js'

type DerivationPersistence = Pick<
  MarketIntelligenceGenerationReads,
  'readMarketIntelligenceInputPage'
> &
  Pick<
    MarketIntelligenceGenerationWrites,
    | 'recordMarketIntelligenceCatalogue'
    | 'beginMarketIntelligenceGeneration'
    | 'stageMarketIntelligenceOutputs'
    | 'publishMarketIntelligenceGeneration'
  > &
  Pick<MarketIntelligencePolicyReads, 'readMarketIntelligencePolicy'> &
  Pick<MarketIntelligenceUniverseReads, 'readMarketIntelligenceUniverse'>
interface DerivationContext {
  readonly profileId: string
  readonly expectedRevision: number
  readonly signal: AbortSignal
  readonly assertCurrent: () => Promise<boolean>
  readonly capabilities: Pick<
    PlatformModuleResourceCapabilities<DerivationPersistence, readonly ['market-catalogue']>,
    'persistence' | 'coreData'
  >
}
type Profile = Awaited<ReturnType<MarketProfileReads['listMarketProfiles']>>[number]

const watchedCatalogueContext = async (context: DerivationContext, profile: Profile) => {
  if (profile.mode !== 'watched-types') return context
  const { persistence, coreData } = context.capabilities
  const initial = await coreData.marketCatalogue({ kind: 'revision', signal: context.signal })
  if (initial.kind !== 'revision' || !initial.revision || !(await context.assertCurrent())) return
  const fence = { profileId: profile.profileId, profileRevision: profile.revision }
  const accepted = await persistence.recordMarketIntelligenceCatalogue({
    ...fence,
    catalogueRevision: initial.revision,
  })
  if (accepted.outcome !== 'recorded') return
  const assertCurrent = async () => {
    context.signal.throwIfAborted()
    if (!(await context.assertCurrent())) return false
    const current = await coreData.marketCatalogue({ kind: 'revision', signal: context.signal })
    if (current.kind !== 'revision' || !current.revision) return false
    if (JSON.stringify(current.revision) === JSON.stringify(initial.revision)) return true
    await persistence.recordMarketIntelligenceCatalogue({
      ...fence,
      catalogueRevision: current.revision,
    })
    return false
  }
  return { ...context, assertCurrent }
}

const beginGeneration = async (context: DerivationContext, profile: Profile) => {
  const { persistence, coreData } = context.capabilities
  const policy = await persistence.readMarketIntelligencePolicy({ profileId: profile.profileId })
  if (!policy) return
  const fence = {
    profileId: profile.profileId,
    profileRevision: profile.revision,
    policyRevision: policy.revision,
  }
  if (profile.mode === 'region') {
    const state = await persistence.readMarketIntelligenceUniverse(fence)
    if (!policy.enabled || !state?.active || !(await context.assertCurrent())) return
    await persistence.beginMarketIntelligenceGeneration({
      ...fence,
      generationId: crypto.randomUUID(),
      cursorSecret: crypto.randomUUID(),
      ignoredTypeIds: [],
      universeId: state.active.universeId,
      catalogueRevision: null,
      watchedTargets: [],
      excludedTypeCount: 0,
      excludedGroupIds: [],
    })
    return
  }
  const tree = await coreData.marketCatalogue({ kind: 'tree', signal: context.signal })
  const index = await coreData.marketCatalogue({ kind: 'search-index', signal: context.signal })
  if (tree.kind !== 'tree' || index.kind !== 'search-index')
    throw new TypeError('Incorrect intelligence catalogue products')
  const universe = buildMarketIntelligenceUniverse(tree, index, policy, profile)
  context.signal.throwIfAborted()
  if (!(await context.assertCurrent())) return
  await persistence.beginMarketIntelligenceGeneration({
    ...fence,
    generationId: crypto.randomUUID(),
    cursorSecret: crypto.randomUUID(),
    ignoredTypeIds: [...universe.ignoredTypeIds],
    universeId: null,
    catalogueRevision: universe.revision,
    watchedTargets: universe.targets.map(({ typeId, groupId, name, groupIds }) => ({
      typeId,
      groupId,
      name,
      groupIds: [...groupIds],
    })),
    excludedTypeCount: universe.excludedTypeCount,
    excludedGroupIds: [...universe.excludedGroupIds],
  })
}

const publishExhausted = async (
  context: DerivationContext,
  page: NonNullable<
    Awaited<ReturnType<MarketIntelligenceGenerationReads['readMarketIntelligenceInputPage']>>
  >,
) => {
  context.signal.throwIfAborted()
  if (!(await context.assertCurrent())) return 'obsolete' as const
  const result = await context.capabilities.persistence.publishMarketIntelligenceGeneration({
    profileId: context.profileId,
    profileRevision: context.expectedRevision,
    generationId: page.generationId,
  })
  return result.outcome === 'published' ? ('completed' as const) : ('obsolete' as const)
}

export const deriveMarketIntelligence = async (context: DerivationContext, profile: Profile) => {
  const checked = await watchedCatalogueContext(context, profile)
  if (!checked) return 'obsolete' as const
  const { persistence } = context.capabilities
  const fence = { profileId: context.profileId, profileRevision: context.expectedRevision }
  if (!(await persistence.readMarketIntelligenceInputPage(fence)))
    await beginGeneration(checked, profile)
  for (let index = 0; index < marketIntelligenceBounds.maximumDerivationPages; index++) {
    context.signal.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Every bounded page resumes the committed frozen-input cursor.
    const page = await persistence.readMarketIntelligenceInputPage(fence)
    if (!page) return 'obsolete' as const
    if (page.rows.length === 0) return publishExhausted(checked, page)
    // oxlint-disable-next-line no-await-in-loop -- Recheck deployment admission before staging each page.
    if (!(await checked.assertCurrent())) return 'obsolete' as const
    context.signal.throwIfAborted()
    const rows = page.rows.map(({ typeId, metricsInput }) => ({
      typeId,
      metrics: deriveMarketIntelligenceMetrics(metricsInput),
    }))
    // oxlint-disable-next-line no-await-in-loop -- Persist at most one hundred outputs before advancing the durable cursor.
    const result = await persistence.stageMarketIntelligenceOutputs({
      ...fence,
      generationId: page.generationId,
      cursorTypeId: page.cursorTypeId,
      rows,
    })
    if (result.outcome !== 'staged') return 'obsolete' as const
  }
  context.signal.throwIfAborted()
  const next = await persistence.readMarketIntelligenceInputPage(fence)
  if (!next) return 'obsolete' as const
  return next.rows.length === 0 ? publishExhausted(checked, next) : ('completed' as const)
}
