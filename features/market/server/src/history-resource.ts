import type {
  PlatformDeploymentResourceSubject,
  PlatformProfileCollectionResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server'
import { mapMarketDailyRecord } from './market-representation.js'
import type { regionHistoryOperation } from './operations.js'
import type { MarketHistoryProfileReads, MarketHistoryWrites } from './persistence.js'

type HistoryProtocol = PlatformExecutableEsiOperationProtocol<
  { readonly 'market-region-history': typeof regionHistoryOperation },
  'market-region-history'
>
type HistoryResource = PlatformProfileCollectionResourceImplementation<
  'market-region-history',
  HistoryProtocol,
  PlatformDeploymentResourceSubject,
  readonly [],
  MarketHistoryProfileReads,
  MarketHistoryWrites
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
  context.capabilities.persistence.listDueMarketHistoryTypes({
    profileId: profile.profileId,
    expectedRevision: profile.revision,
    now: new Date().toISOString(),
    typeId: context.requestedTypeId,
  })

export const marketHistoryResource: HistoryResource = {
  mode: 'profile-collection',
  operation: 'market-region-history',
  plan: async ({ now, limit, capabilities, signal }) => {
    signal?.throwIfAborted()
    const due = await capabilities.persistence.listDueMarketHistoryProfiles({
      now,
    })
    signal?.throwIfAborted()
    return due.slice(0, Math.min(limit, 16)).map(({ profileId, revision, nextDueAt }) => ({
      profileId,
      revision,
      dueAt: nextDueAt,
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
    if (due.length === 0) return 'obsolete'
    if (due.length > Math.min(context.requestBudget, 16)) {
      throw new RangeError('Market daily-history request budget exceeded')
    }
    for (const { regionId, typeId } of due) {
      context.signal.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop -- One profile work identity owns a bounded sequence of daily types.
      const result = await context.operations['market-region-history']({
        path: { region_id: regionId },
        query: { type_id: typeId },
      })
      const days = validatedHistoryDays(result)
      // oxlint-disable-next-line no-await-in-loop -- Recheck the current deployment gate before each publication.
      if (!(await context.assertCurrent())) return 'obsolete'
      // oxlint-disable-next-line no-await-in-loop -- Each type has an independent freshness boundary.
      const persisted = await context.capabilities.persistence.upsertMarketHistory({
        profileId: profile.profileId,
        expectedRevision: profile.revision,
        regionId,
        typeId,
        attemptId: crypto.randomUUID(),
        validatedAt: result.validatedAt,
        freshUntil: result.cachedUntil,
        days,
      })
      if (persisted.outcome === 'obsolete') return 'obsolete'
      context.capabilities.logger.info('market.history.observed', {
        profileId: profile.profileId,
        regionId,
        typeId,
        dayCount: days.length,
        validatedAt: result.validatedAt,
      })
    }
    return 'completed'
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
