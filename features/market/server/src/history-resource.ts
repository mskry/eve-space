import type {
  PlatformDeploymentResourceSubject,
  PlatformProfileCollectionResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server'
import { mapMarketDailyRecord } from './market-representation.js'
import type { regionHistoryOperation } from './operations.js'
import type {
  MarketHistoryConvergenceWrites,
  MarketHistorySourceReads,
  MarketHistoryTargetReads,
  MarketHistoryItemFailureWrites,
  MarketHistoryProfileReads,
  MarketHistoryWrites,
} from './persistence.js'
import type {
  MarketIntelligencePolicyReads,
  MarketIntelligenceUniverseReads,
  MarketIntelligenceUniverseWrites,
} from './intelligence-persistence.js'
import { reconcileMarketIntelligence } from './intelligence-reconciliation.js'
import { deriveMarketIntelligence } from './intelligence-derivation.js'
import type {
  MarketIntelligenceGenerationReads,
  MarketIntelligenceGenerationWrites,
} from './intelligence-generation-persistence.js'

type HistoryProtocol = PlatformExecutableEsiOperationProtocol<
  { readonly 'market-region-history': typeof regionHistoryOperation },
  'market-region-history'
>
type HistoryResource = PlatformProfileCollectionResourceImplementation<
  'market-region-history',
  HistoryProtocol,
  PlatformDeploymentResourceSubject,
  readonly ['market-catalogue'],
  MarketHistoryProfileReads &
    MarketHistoryTargetReads &
    MarketHistorySourceReads &
    MarketIntelligencePolicyReads &
    MarketIntelligenceUniverseReads &
    MarketIntelligenceGenerationReads,
  MarketHistoryWrites &
    MarketHistoryItemFailureWrites &
    MarketHistoryConvergenceWrites &
    MarketIntelligenceUniverseWrites &
    MarketIntelligenceGenerationWrites
>

type HistorySourceResult = {
  readonly stale: boolean
  readonly cachedUntil: string
  readonly data: readonly Parameters<typeof mapMarketDailyRecord>[0][]
}

const validatedHistoryDays = (result: HistorySourceResult) => {
  if (result.stale || new Date(result.cachedUntil).getTime() <= Date.now()) {
    throw new Error('Market daily-history source is not fresh')
  }
  if (result.data.length > 1_000) {
    throw new RangeError('Market daily history exceeds the record bound')
  }
  const days = result.data.map(mapMarketDailyRecord)
  if (new Set(days.map(({ date }) => date)).size !== days.length) {
    throw new Error('Market daily history repeats a source date')
  }
  return days
}

const historyTypesForWork = (
  context: Parameters<HistoryResource['execute']>[0],
  profile: Awaited<ReturnType<MarketHistoryProfileReads['listMarketProfiles']>>[number],
) =>
  context.capabilities.persistence.listDueMarketHistoryTargets({
    profileId: profile.profileId,
    expectedRevision: profile.revision,
    now: new Date().toISOString(),
    typeId: context.requestedTypeId,
  })

const collectHistoryTarget = async (
  context: Parameters<HistoryResource['execute']>[0],
  profile: Awaited<ReturnType<MarketHistoryProfileReads['listMarketProfiles']>>[number],
  target: Awaited<ReturnType<MarketHistoryTargetReads['listDueMarketHistoryTargets']>>[number],
) => {
  const attemptedAt = new Date().toISOString()
  const identity = {
    profileId: profile.profileId,
    expectedRevision: profile.revision,
    regionId: target.regionId,
    typeId: target.typeId,
    policyRevision: target.policyRevision,
    universeId: target.universeId,
    attemptId: crypto.randomUUID(),
    attemptedAt,
  }
  let response
  let days
  try {
    response = await context.operations['market-region-history']({
      path: { region_id: target.regionId },
      query: { type_id: target.typeId },
    })
    days = validatedHistoryDays(response)
  } catch (error) {
    context.signal.throwIfAborted()
    if (!(await context.assertCurrent())) return 'obsolete'
    const failure = context.classifyFailure(error)
    const persisted = await context.capabilities.persistence.recordMarketHistoryItemFailure({
      ...identity,
      failureClass: failure.failureClass,
      retryAt: failure.retryAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    })
    if (persisted.outcome === 'obsolete') return 'obsolete'
    if (failure.failureClass === 'esi-cooldown') throw error
    context.capabilities.logger.warn('market.history.target-failed', {
      profileId: profile.profileId,
      typeId: target.typeId,
      failureClass: failure.failureClass,
    })
    return 'completed'
  }
  context.signal.throwIfAborted()
  if (!(await context.assertCurrent())) return 'obsolete'
  const persisted = await context.capabilities.persistence.convergeMarketHistory({
    ...identity,
    validatedAt: response.validatedAt,
    freshUntil: response.cachedUntil,
    days,
  })
  return persisted.outcome === 'obsolete' ? 'obsolete' : 'completed'
}

const collectHistoryTargets = async (
  context: Parameters<HistoryResource['execute']>[0],
  profile: Awaited<ReturnType<MarketHistoryProfileReads['listMarketProfiles']>>[number],
  due: Awaited<ReturnType<MarketHistoryTargetReads['listDueMarketHistoryTargets']>>,
): Promise<'completed' | 'obsolete'> => {
  if (due.length === 0) return 'obsolete'
  if (due.length > Math.min(context.requestBudget, 16)) {
    throw new RangeError('Market daily-history request budget exceeded')
  }
  for (const target of due) {
    context.signal.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Dispatch requires live profile, policy, universe, and source admission.
    if (!(await context.assertCurrent())) return 'obsolete'
    // oxlint-disable-next-line no-await-in-loop -- Shared fresh sources and changed policies can remove pending work.
    const [current] = await context.capabilities.persistence.listDueMarketHistoryTargets({
      profileId: profile.profileId,
      expectedRevision: profile.revision,
      now: new Date().toISOString(),
      typeId: target.typeId,
    })
    if (
      !current ||
      current.policyRevision !== target.policyRevision ||
      current.universeId !== target.universeId
    )
      continue
    // oxlint-disable-next-line no-await-in-loop -- At most sixteen independently admitted sources per work unit.
    const collected = await collectHistoryTarget(context, profile, target)
    if (collected === 'obsolete') return 'obsolete'
  }
  return 'completed'
}

export const marketHistoryResource: HistoryResource = {
  mode: 'profile-collection',
  operation: 'market-region-history',
  plan: async ({ now, limit, capabilities, signal }) => {
    signal?.throwIfAborted()
    const history = await capabilities.persistence.listDueMarketHistoryCollectionProfiles({ now })
    const reconciliation = await capabilities.persistence.listDueMarketIntelligenceReconciliations({
      now,
    })
    const derivation = await capabilities.persistence.listDueMarketIntelligenceDerivations({ now })
    const local = new Set([...reconciliation, ...derivation].map(({ profileId }) => profileId))
    const due = [
      ...new Map(
        [...history, ...reconciliation, ...derivation].map((entry) => [entry.profileId, entry]),
      ).values(),
    ].toSorted(
      (left, right) =>
        left.nextDueAt.localeCompare(right.nextDueAt) ||
        left.profileId.localeCompare(right.profileId),
    )
    signal?.throwIfAborted()
    return due.slice(0, Math.min(limit, 16)).map(({ profileId, revision, nextDueAt }) => ({
      profileId,
      revision,
      dueAt: nextDueAt,
      localWorkPending: local.has(profileId),
    }))
  },
  execute: async (context) => {
    context.signal.throwIfAborted()
    const profiles = await context.capabilities.persistence.listMarketProfiles({
      enabledOnly: false,
    })
    const profile = profiles.find(({ profileId }) => profileId === context.profileId)
    if (!profile?.enabled || profile.revision !== context.expectedRevision) return 'obsolete'
    const due = await historyTypesForWork(context, profile)
    if (context.requestedTypeId === undefined) {
      const reconciliation =
        await context.capabilities.persistence.listDueMarketIntelligenceReconciliations({
          now: new Date().toISOString(),
        })
      const selected = await context.capabilities.persistence.selectMarketIntelligenceWork({
        profileId: profile.profileId,
        profileRevision: profile.revision,
        historyDue: due.length > 0,
        reconciliationDue: reconciliation.some(({ profileId }) => profileId === profile.profileId),
      })
      if (selected.kind === 'reconciliation')
        return reconcileMarketIntelligence(context, profile.regionId)
      if (selected.kind === 'derivation') return deriveMarketIntelligence(context, profile)
      if (!selected.kind) return 'obsolete'
    }
    return collectHistoryTargets(context, profile, due)
  },
  maintain: async ({ now, purgeRetention, capabilities, signal }) => {
    if (!purgeRetention) return
    signal?.throwIfAborted()
    await capabilities.persistence.cleanupMarketHistoryRetention({ now, limit: 10_000 })
    signal?.throwIfAborted()
    await capabilities.persistence.cleanupMarketIntelligenceGenerations({ now })
    signal?.throwIfAborted()
    await capabilities.persistence.cleanupMarketHistoryDemands({ now })
  },
  onFailure: async ({
    profileId,
    expectedRevision,
    requestedTypeId,
    failureClass,
    retryAt,
    capabilities,
  }) => {
    await capabilities.persistence.recordMarketHistoryFailure({
      profileId,
      expectedRevision,
      typeId: requestedTypeId,
      failureId: crypto.randomUUID(),
      failureClass,
      retryAt,
    })
    capabilities.logger.warn('market.history.failed', {
      profileId,
      typeId: requestedTypeId ?? null,
      failureClass,
      retryAt,
    })
  },
}
