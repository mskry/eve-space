import type {
  PlatformBoundedCollectionResourceImplementation,
  PlatformCharacterResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server'
import {
  collectStructureOrderBook,
  type CollectedStructureBook,
} from './collect-structure-orders.js'
import type { structureOrdersOperation } from './operations.js'
import type { MarketStructureWrites } from './persistence.js'

type StructureProtocol = PlatformExecutableEsiOperationProtocol<
  { readonly 'market-structure-orders': typeof structureOrdersOperation },
  'market-structure-orders'
>

export const marketStructureResource: PlatformBoundedCollectionResourceImplementation<
  'market-structure-orders',
  StructureProtocol,
  CollectedStructureBook,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  object,
  MarketStructureWrites,
  MarketStructureWrites
> = {
  mode: 'bounded-collection',
  operation: 'market-structure-orders',
  collect: async ({ selector, operations, subject, signal }) => {
    if (subject.kind !== 'character' || !selector?.structureId) {
      throw new Error('Structure collection requires an exact owned-character selector')
    }
    const book = await collectStructureOrderBook({
      structureId: selector.structureId,
      signal,
      loadPage: async ({ structureId, page }) => {
        const result = await operations['market-structure-orders']({
          path: { structure_id: structureId },
          query: { page },
        })
        if (!result.cachedUntil || result.stale) {
          throw new Error('Structure order page has no fresh gateway validation')
        }
        return {
          data: result.data,
          pages: result.pagination?.pages ?? 0,
          validatedAt: result.validatedAt,
          freshUntil: result.cachedUntil,
        }
      },
    })
    return { data: book, complete: true }
  },
  materialize: async ({
    data,
    subject,
    authorizationGeneration,
    organizationVersion,
    capabilities,
    signal,
  }) => {
    if (subject.kind !== 'character' || authorizationGeneration === null || !organizationVersion) {
      throw new Error('Structure observation requires a current character generation')
    }
    const observationId = crypto.randomUUID()
    signal?.throwIfAborted()
    const started = await capabilities.persistence.beginStructureObservation({
      observationId,
      characterId: subject.characterId,
      subjectLifecycleId: subject.lifecycleId,
      authorizationGeneration,
      organizationVersion,
      structureId: data.structureId,
      expectedPages: data.pages,
      startedAt: data.observedAt,
    })
    if (started.outcome !== 'started') throw new Error('Structure observation is obsolete')
    for (const page of data.pageResults) {
      signal?.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop -- One guarded transaction owns the complete private book.
      const staged = await capabilities.persistence.stageStructurePage({
        observationId,
        page: page.page,
        expectedPages: data.pages,
        validatedAt: page.validatedAt,
        freshUntil: page.freshUntil,
        orders: [...page.orders],
      })
      if (staged.outcome !== 'staged') throw new Error('Structure page is obsolete')
    }
    signal?.throwIfAborted()
    const published = await capabilities.persistence.publishStructureObservation({ observationId })
    if (published.outcome !== 'published') {
      throw new Error('Structure observation did not publish a complete book')
    }
    capabilities.logger.info('market.structure.observed', {
      pageCount: data.pages,
      orderCount: data.orders.length,
    })
  },
  maintain: async ({ now, purgeRetention, signal, capabilities }) => {
    if (!purgeRetention) return
    signal?.throwIfAborted()
    await capabilities.persistence.cleanupStructureObservations({ now })
    await capabilities.persistence.cleanupStructureDemands({ now })
  },
}
