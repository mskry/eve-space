import type {
  PlatformDeploymentResourceSubject,
  PlatformProfileCollectionResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server'
import { collectRegionalOrderBook } from './collect-orders.js'
import { marketCollectionBounds } from './market-bounds.js'
import { deriveMarketMetrics } from './market-derived.js'
import type {
  MarketCollectionWrites,
  MarketProfileDueReads,
  MarketProfileReads,
  MarketDerivationTypesReads,
} from './persistence.js'
import { validateMarketPublicProfile } from './profiles.js'
import type { regionOrdersOperation } from './operations.js'

type MarketProtocol = PlatformExecutableEsiOperationProtocol<
  { readonly 'market-region-orders': typeof regionOrdersOperation },
  'market-region-orders'
>
type MarketProfileResource = PlatformProfileCollectionResourceImplementation<
  'market-region-orders',
  MarketProtocol,
  PlatformDeploymentResourceSubject,
  readonly ['market-station-regions'],
  MarketProfileDueReads & MarketProfileReads & MarketDerivationTypesReads,
  MarketCollectionWrites
>
type MarketProfile = Awaited<ReturnType<MarketProfileReads['listMarketProfiles']>>[number]

const completeType = async (
  context: Parameters<MarketProfileResource['execute']>[0],
  profile: MarketProfile,
  typeId: number | undefined,
  budget: { remaining: number },
): Promise<'completed' | 'obsolete'> => {
  const book = await collectRegionalOrderBook({
    regionId: profile.regionId,
    typeId,
    stationIds: profile.stationIds,
    signal: context.signal,
    loadPage: async (request, signal) => {
      if (budget.remaining-- <= 0) throw new RangeError('Market profile request budget exceeded')
      const response = await context.operations['market-region-orders']({
        path: { region_id: request.regionId },
        query: {
          order_type: request.orderType,
          page: request.page,
          ...(request.typeId && { type_id: request.typeId }),
        },
      })
      signal?.throwIfAborted()
      if (response.stale) throw new Error('Market source page is outage-stale')
      return {
        data: response.data,
        pages: response.pagination?.pages ?? 0,
        validatedAt: response.validatedAt,
        freshUntil: response.cachedUntil,
      }
    },
  })
  context.signal.throwIfAborted()
  const observationId = crypto.randomUUID()
  const marketKey = `${profile.profileId}:${typeId ?? 'all'}`
  const started = await context.capabilities.persistence.beginMarketObservation({
    observationId,
    profileId: profile.profileId,
    profileRevision: context.expectedRevision,
    marketKey,
    typeId: typeId ?? null,
    expectedPages: book.pages,
    startedAt: book.observedAt,
  })
  if (started.outcome === 'obsolete') return 'obsolete'
  for (const page of book.pageResults) {
    context.signal.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Keep staged page writes ordered and bounded.
    const staged = await context.capabilities.persistence.stageMarketPage({
      observationId,
      page: page.page,
      expectedPages: book.pages,
      validatedAt: page.validatedAt,
      freshUntil: page.freshUntil,
      orders: [...page.orders],
    })
    if (staged.outcome === 'obsolete') return 'obsolete'
  }
  context.signal.throwIfAborted()
  if (!(await context.assertCurrent())) return 'obsolete'
  const published = await context.capabilities.persistence.publishCurrentMarketObservation({
    observationId,
  })
  if (published.outcome === 'unchanged') return 'completed'
  if (published.outcome !== 'published') {
    throw new Error('Market observation was incomplete at publication')
  }
  const types =
    typeId === undefined
      ? await context.capabilities.persistence.listMarketDerivationTypes({
          profileId: profile.profileId,
          expectedRevision: profile.revision,
        })
      : [typeId]
  for (const selectedTypeId of types) {
    context.signal.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Each derived type stays pinned to this complete observation.
    if (!(await context.assertCurrent())) return 'obsolete'
    const metrics = deriveMarketMetrics(
      {
        publication: 'complete',
        observationId,
        marketId: marketKey,
        observedAt: book.observedAt,
        validatedAt: book.validatedAt,
        freshUntil: book.freshUntil,
      },
      book.orders,
      selectedTypeId,
    )
    // oxlint-disable-next-line no-await-in-loop -- Persist each bounded derived identity before advancing.
    await context.capabilities.persistence.storeMarketMetrics({
      observationId,
      typeId: selectedTypeId,
      derivationVersion: metrics.derivationVersion,
      metrics: { ...metrics, depthBands: [...metrics.depthBands] },
    })
  }
  context.capabilities.logger.info('market.observation.published', {
    profileId: profile.profileId,
    pageCount: book.pages,
    orderCount: book.orders.length,
    observedAt: book.observedAt,
  })
  return 'completed'
}

const completeOrRecordFailure = async (
  context: Parameters<MarketProfileResource['execute']>[0],
  profile: MarketProfile,
  typeId: number | undefined,
  budget: { remaining: number },
) => {
  const attemptedAt = new Date().toISOString()
  const attemptId = crypto.randomUUID()
  try {
    return await completeType(context, profile, typeId, budget)
  } catch (error) {
    if (!context.signal.aborted && (await context.assertCurrent())) {
      await context.capabilities.persistence.recordMarketTypeFailure({
        profileId: profile.profileId,
        expectedRevision: profile.revision,
        typeId: typeId ?? null,
        attemptId,
        attemptedAt,
      })
    }
    throw error
  }
}

export const marketOrdersResource: MarketProfileResource = {
  mode: 'profile-collection',
  operation: 'market-region-orders',
  plan: async ({ now, limit, capabilities, signal }) => {
    signal?.throwIfAborted()
    const due = await capabilities.persistence.listDueMarketProfiles({ now })
    signal?.throwIfAborted()
    return due
      .slice(0, Math.min(limit, marketCollectionBounds.maximumQueuedProfiles))
      .map(({ profileId, revision, nextDueAt }) => ({ profileId, revision, dueAt: nextDueAt }))
  },
  execute: async (context) => {
    context.signal.throwIfAborted()
    const profiles = await context.capabilities.persistence.listMarketProfiles({
      enabledOnly: false,
    })
    const profile = profiles.find(({ profileId }) => profileId === context.profileId)
    if (
      !profile?.enabled ||
      profile.revision !== context.expectedRevision ||
      (profile.nextDueAt !== null && Date.parse(profile.nextDueAt) > Date.now())
    )
      return 'obsolete'
    const validated = await validateMarketPublicProfile(
      profile,
      profiles.filter(({ profileId }) => profileId !== profile.profileId),
      context.capabilities.coreData,
    )
    if (
      validated.stationRevision.ingestVersion < 6 ||
      validated.stationIds.length !== profile.stationIds.length
    )
      return 'obsolete'
    const budget = { remaining: Math.min(context.requestBudget, 512) }
    const types = profile.mode === 'region' ? [undefined] : profile.watchedTypeIds
    for (const typeId of types) {
      // oxlint-disable-next-line no-await-in-loop -- One profile work identity owns a bounded request budget.
      const outcome = await completeOrRecordFailure(context, profile, typeId, budget)
      if (outcome === 'obsolete') return outcome
    }
    return 'completed'
  },
  onFailure: async ({ profileId, expectedRevision, failureClass, retryAt, capabilities }) => {
    await capabilities.persistence.recordMarketFailure({
      profileId,
      expectedRevision,
      failureId: crypto.randomUUID(),
      failureClass,
      retryAt,
    })
    capabilities.logger.warn('market.observation.failed', {
      profileId,
      failureClass,
      retryAt,
    })
  },
  maintain: async ({ now, purgeRetention, capabilities, signal }) => {
    if (!purgeRetention) return
    signal?.throwIfAborted()
    await capabilities.persistence.cleanupMarketObservations({ now })
    signal?.throwIfAborted()
    await capabilities.persistence.cleanupMarketObservationBacklog({ now })
  },
}
