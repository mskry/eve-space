import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'
import { marketCollectionBounds } from './market-bounds.js'

const instant = z.iso.datetime({ offset: true })
const positiveId = z.number().int().positive().safe()
const optionalTypeId = z.number().int().positive().safe().optional()
const revision = z.number().int().nonnegative().safe()
const profileId = z.uuid()
const profileFields = {
  profileId: profileId,
  regionId: positiveId,
  mode: z.enum(['region', 'watched-types']),
  stationIds: z.array(positiveId).max(100),
  watchedTypeIds: z.array(positiveId).max(16),
  enabled: z.boolean(),
} as const
const storedProfile = z.strictObject(profileFields).safeExtend({
  revision: revision,
  nextDueAt: z.iso.datetime({ offset: true }).nullable(),
  lastFailureClass: z.string().max(80).nullable(),
})

export const listMarketProfilesOperation = definePlatformPersistenceOperation({
  id: 'list-market-profiles',
  method: 'listMarketProfiles',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ enabledOnly: z.boolean() }),
  outputSchema: z.array(storedProfile).max(marketCollectionBounds.maximumProfiles),
  maximumInputBytes: 128,
  maximumOutputBytes: 16_384,
})

export const saveMarketProfileOperation = definePlatformPersistenceOperation({
  id: 'save-market-profile',
  method: 'saveMarketProfile',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(profileFields).safeExtend({
    expectedRevision: revision,
    requestId: z.uuid(),
  }),
  outputSchema: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('saved'), revision: positiveId }),
    z.strictObject({ outcome: z.literal('obsolete') }),
  ]),
  maximumInputBytes: 4_096,
  maximumOutputBytes: 256,
})

export const listDueMarketProfilesOperation = definePlatformPersistenceOperation({
  id: 'list-due-market-profiles',
  method: 'listDueMarketProfiles',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z
    .array(
      z.strictObject({
        profileId: profileId,
        revision: positiveId,
        nextDueAt: instant,
      }),
    )
    .max(marketCollectionBounds.maximumQueuedProfiles),
  maximumInputBytes: 256,
  maximumOutputBytes: 4_096,
})

const marketOrderFields = {
  orderId: positiveId,
  typeId: positiveId,
  locationId: positiveId,
  solarSystemId: z.number().int().positive().safe().nullable(),
  side: z.enum(['buy', 'sell']),
  price: z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/),
  volumeRemain: z.number().int().nonnegative().safe(),
  issuedAt: z.iso.datetime({ offset: true }),
  durationDays: z.number().int().min(0).max(marketCollectionBounds.maximumOrderDurationDays),
  minimumVolume: positiveId,
  range: z.string().min(1).max(20),
} as const

export const beginMarketObservationOperation = definePlatformPersistenceOperation({
  id: 'begin-market-observation',
  method: 'beginMarketObservation',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    observationId: z.uuid(),
    profileId: z.uuid(),
    profileRevision: positiveId,
    marketKey: z.string().min(1).max(100),
    typeId: z.number().int().positive().safe().nullable(),
    expectedPages: z.number().int().min(1).max(marketCollectionBounds.maximumPagesPerObservation),
    startedAt: instant,
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['started', 'obsolete']) }),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 256,
})

export const stageMarketPageOperation = definePlatformPersistenceOperation({
  id: 'stage-market-page',
  method: 'stageMarketPage',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    observationId: z.uuid(),
    page: z.number().int().min(1).max(marketCollectionBounds.maximumPagesPerObservation),
    expectedPages: z.number().int().min(1).max(marketCollectionBounds.maximumPagesPerObservation),
    validatedAt: instant,
    freshUntil: instant,
    orders: z.array(z.strictObject(marketOrderFields)).max(1_000),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['staged', 'obsolete']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const publishCurrentMarketObservationOperation = definePlatformPersistenceOperation({
  id: 'publish-current-market-observation',
  method: 'publishCurrentMarketObservation',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ observationId: z.uuid() }),
  outputSchema: z.strictObject({
    outcome: z.enum(['published', 'unchanged', 'incomplete']),
  }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const publishCollectedMarketObservationOperation = definePlatformPersistenceOperation({
  id: 'publish-collected-market-observation',
  method: 'publishCollectedMarketObservation',
  revision: 1,
  mode: 'write',
  inputSchema: publishCurrentMarketObservationOperation.inputSchema,
  outputSchema: publishCurrentMarketObservationOperation.outputSchema,
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const recordMarketFailureOperation = definePlatformPersistenceOperation({
  id: 'record-market-failure',
  method: 'recordMarketFailure',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
    failureId: z.uuid(),
    failureClass: z.enum([
      'esi-cooldown',
      'esi-unavailable',
      'response-invalid',
      'mapping-failed',
      'persistence-failed',
      'unknown',
    ]),
    retryAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['recorded', 'obsolete']) }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const recordMarketTypeFailureOperation = definePlatformPersistenceOperation({
  id: 'record-market-type-failure',
  method: 'recordMarketTypeFailure',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
    typeId: z.number().int().positive().safe().nullable(),
    attemptId: z.uuid(),
    attemptedAt: instant,
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['recorded', 'obsolete']) }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const readMarketReplacementStatusOperation = definePlatformPersistenceOperation({
  id: 'read-market-replacement-status',
  method: 'readMarketReplacementStatus',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ profileId: z.uuid(), typeId: positiveId }),
  outputSchema: z.strictObject({ attemptedAt: instant }).nullable(),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const cleanupMarketObservationsOperation = definePlatformPersistenceOperation({
  id: 'cleanup-market-observations',
  method: 'cleanupMarketObservations',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z.strictObject({ outcome: z.literal('checked') }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const cleanupMarketObservationBacklogOperation = definePlatformPersistenceOperation({
  id: 'cleanup-market-observation-backlog',
  method: 'cleanupMarketObservationBacklog',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z.strictObject({ outcome: z.literal('checked') }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const readMarketObservationOperation = definePlatformPersistenceOperation({
  id: 'read-market-observation',
  method: 'readMarketObservation',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    typeId: positiveId,
    observationId: z.uuid().nullable(),
  }),
  outputSchema: z
    .strictObject({
      observationId: z.uuid(),
      profileId: z.uuid(),
      regionId: positiveId,
      typeId: positiveId,
      observedAt: instant,
      validatedAt: instant,
      freshUntil: instant,
      expectedPages: z.number().int().min(1).max(512),
      totalBookOrders: z.number().int().nonnegative().safe(),
    })
    .nullable(),
  maximumInputBytes: 512,
  maximumOutputBytes: 1_024,
})

export const readMarketOrderRowsOperation = definePlatformPersistenceOperation({
  id: 'read-market-order-rows',
  method: 'readMarketOrderRows',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    observationId: z.uuid(),
    typeId: positiveId,
    side: z.enum(['buy', 'sell']),
    limit: z.number().int().min(1).max(100),
    cursorPrice: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/)
      .nullable(),
    cursorIssuedAt: z.iso.datetime({ offset: true }).nullable(),
    cursorOrderId: z.number().int().positive().safe().nullable(),
  }),
  outputSchema: z.strictObject({
    rows: z
      .array(
        z.strictObject({
          orderId: positiveId,
          side: z.enum(['buy', 'sell']),
          price: z.string(),
          volumeRemain: z.number().int().nonnegative().safe(),
          locationId: positiveId,
          solarSystemId: z.number().int().positive().safe().nullable(),
          issuedAt: instant,
          durationDays: z.number().int().nonnegative(),
          minimumVolume: positiveId,
          range: z.string().min(1).max(20),
        }),
      )
      .max(100),
    hasMore: z.boolean(),
  }),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 100_000,
})

const referencePriceIsk = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/)
  .nullable()

export const upsertMarketReferencePricesOperation = definePlatformPersistenceOperation({
  id: 'upsert-market-reference-prices',
  method: 'upsertMarketReferencePrices',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    observedHour: instant,
    validatedAt: instant,
    prices: z
      .array(
        z.strictObject({
          typeId: positiveId,
          adjustedPriceIsk: referencePriceIsk,
          averagePriceIsk: referencePriceIsk,
        }),
      )
      .max(20_000),
  }),
  outputSchema: z.strictObject({ outcome: z.literal('applied') }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const readMarketReferencePricesOperation = definePlatformPersistenceOperation({
  id: 'read-market-reference-prices',
  method: 'readMarketReferencePrices',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ typeIds: z.array(positiveId).max(100) }),
  outputSchema: z
    .array(
      z.strictObject({
        typeId: positiveId,
        adjustedPriceIsk: referencePriceIsk,
        averagePriceIsk: referencePriceIsk,
        sourceHour: instant,
        validatedAt: instant,
      }),
    )
    .max(100),
  maximumInputBytes: 2_048,
  maximumOutputBytes: 16_384,
})

export const requestMarketHistoryDemandOperation = definePlatformPersistenceOperation({
  id: 'request-market-history-demand',
  method: 'requestMarketHistoryDemand',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
    typeId: positiveId,
    requestId: z.uuid(),
  }),
  outputSchema: z.strictObject({
    outcome: z.enum(['accepted', 'duplicate', 'unavailable']),
  }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const listDueMarketHistoryProfilesOperation = definePlatformPersistenceOperation({
  id: 'list-due-market-history-profiles',
  method: 'listDueMarketHistoryProfiles',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z
    .array(
      z.strictObject({
        profileId: z.uuid(),
        revision: positiveId,
        nextDueAt: instant,
      }),
    )
    .max(16),
  maximumInputBytes: 256,
  maximumOutputBytes: 4_096,
})

export const listDueMarketHistoryTypesOperation = definePlatformPersistenceOperation({
  id: 'list-due-market-history-types',
  method: 'listDueMarketHistoryTypes',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
    now: instant,
    typeId: optionalTypeId,
  }),
  outputSchema: z
    .array(
      z.strictObject({
        regionId: positiveId,
        typeId: positiveId,
        nextDueAt: instant,
      }),
    )
    .max(16),
  maximumInputBytes: 512,
  maximumOutputBytes: 4_096,
})

export const upsertMarketHistoryOperation = definePlatformPersistenceOperation({
  id: 'upsert-market-history',
  method: 'upsertMarketHistory',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
    regionId: positiveId,
    typeId: positiveId,
    attemptId: z.uuid(),
    validatedAt: instant,
    freshUntil: instant,
    days: z
      .array(
        z.strictObject({
          date: z.iso.date(),
          averageIsk: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/),
          highIsk: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/),
          lowIsk: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/),
          volume: z.number().int().nonnegative().safe(),
          orderCount: z.number().int().nonnegative().safe(),
        }),
      )
      .max(1_000),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['applied', 'obsolete']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const recordMarketHistoryFailureOperation = definePlatformPersistenceOperation({
  id: 'record-market-history-failure',
  method: 'recordMarketHistoryFailure',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
    typeId: optionalTypeId,
    failureId: z.uuid(),
    failureClass: z.enum([
      'esi-cooldown',
      'esi-unavailable',
      'response-invalid',
      'mapping-failed',
      'persistence-failed',
      'unknown',
    ]),
    retryAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['recorded', 'obsolete']) }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const readMarketHistoryOperation = definePlatformPersistenceOperation({
  id: 'read-market-history',
  method: 'readMarketHistory',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ profileId: z.uuid(), typeId: positiveId }),
  outputSchema: z
    .strictObject({
      status: z.enum(['uncollected', 'observed']),
      regionId: positiveId,
      typeId: positiveId,
      validatedAt: z.iso.datetime({ offset: true }).nullable(),
      freshUntil: z.iso.datetime({ offset: true }).nullable(),
      days: z
        .array(
          z.strictObject({
            date: z.iso.date(),
            averageIsk: z.string(),
            highIsk: z.string(),
            lowIsk: z.string(),
            volume: z.number().int().nonnegative().safe(),
            orderCount: z.number().int().nonnegative().safe(),
          }),
        )
        .max(365),
    })
    .nullable(),
  maximumInputBytes: 512,
  maximumOutputBytes: 100_000,
})

const derivedPrice = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/)
  .nullable()
const derivedVolume = z.string().regex(/^\d{1,32}$/)
const derivedMetrics = z.strictObject({
  publication: z.literal('complete'),
  observationId: z.uuid(),
  marketId: z.string().min(1).max(100),
  observedAt: instant,
  validatedAt: instant,
  freshUntil: instant,
  derivationVersion: z.number().int().positive(),
  availableFrom: instant,
  availableThrough: instant,
  bestBidIsk: derivedPrice,
  bestAskIsk: derivedPrice,
  spreadIsk: z
    .string()
    .regex(/^-?(?:0|[1-9]\d{0,14})\.\d{2}$/)
    .nullable(),
  bidVolume: derivedVolume,
  askVolume: derivedVolume,
  depthBands: z
    .array(
      z.strictObject({
        percent: z.number().int().positive(),
        bidVolume: derivedVolume,
        askVolume: derivedVolume,
      }),
    )
    .length(3),
})

export const storeMarketMetricsOperation = definePlatformPersistenceOperation({
  id: 'store-market-metrics',
  method: 'storeMarketMetrics',
  revision: 1,
  mode: 'write',
  inputSchema: z
    .strictObject({
      observationId: z.uuid(),
      typeId: positiveId,
      derivationVersion: z.number().int().positive(),
      metrics: derivedMetrics,
    })
    .refine(
      (input) =>
        input.observationId === input.metrics.observationId &&
        input.derivationVersion === input.metrics.derivationVersion,
    ),
  outputSchema: z.strictObject({ outcome: z.enum(['stored', 'obsolete']) }),
  maximumInputBytes: 16_384,
  maximumOutputBytes: 256,
})

export const listMarketDerivationTypesOperation = definePlatformPersistenceOperation({
  id: 'list-market-derivation-types',
  method: 'listMarketDerivationTypes',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    expectedRevision: positiveId,
  }),
  outputSchema: z.array(positiveId).max(16),
  maximumInputBytes: 512,
  maximumOutputBytes: 1_024,
})

export const readMarketMetricsOperation = definePlatformPersistenceOperation({
  id: 'read-market-metrics',
  method: 'readMarketMetrics',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    profileId: z.uuid(),
    typeId: positiveId,
    beforeObservedAt: z.iso.datetime({ offset: true }).nullable(),
    beforeObservationId: z.uuid().nullable(),
  }),
  outputSchema: z
    .strictObject({
      availableFrom: z.iso.datetime({ offset: true }).nullable(),
      availableThrough: z.iso.datetime({ offset: true }).nullable(),
      items: z
        .array(
          z.strictObject({
            observationId: z.uuid(),
            observedAt: instant,
            derivationVersion: z.number().int().positive(),
            metrics: derivedMetrics,
          }),
        )
        .max(100),
    })
    .nullable(),
  maximumInputBytes: 768,
  maximumOutputBytes: 100_000,
})

export const cleanupMarketHistoryDemandsOperation = definePlatformPersistenceOperation({
  id: 'cleanup-market-history-demands',
  method: 'cleanupMarketHistoryDemands',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z.strictObject({ outcome: z.literal('checked') }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const beginStructureObservationOperation = definePlatformPersistenceOperation({
  id: 'begin-structure-observation',
  method: 'beginStructureObservation',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    observationId: z.uuid(),
    characterId: positiveId,
    subjectLifecycleId: z.uuid(),
    authorizationGeneration: z.number().int().nonnegative().safe(),
    organizationVersion: positiveId,
    structureId: positiveId,
    expectedPages: z.number().int().min(1).max(32),
    startedAt: instant,
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['started', 'obsolete']) }),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 256,
})

export const stageStructurePageOperation = definePlatformPersistenceOperation({
  id: 'stage-structure-page',
  method: 'stageStructurePage',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    observationId: z.uuid(),
    page: z.number().int().min(1).max(32),
    expectedPages: z.number().int().min(1).max(32),
    validatedAt: instant,
    freshUntil: instant,
    orders: z
      .array(z.strictObject(marketOrderFields).refine((row) => row.solarSystemId === null))
      .max(1_000),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['staged', 'obsolete']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const publishStructureObservationOperation = definePlatformPersistenceOperation({
  id: 'publish-structure-observation',
  method: 'publishStructureObservation',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ observationId: z.uuid() }),
  outputSchema: z.strictObject({
    outcome: z.enum(['published', 'incomplete']),
  }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const readStructureBookOperation = definePlatformPersistenceOperation({
  id: 'read-structure-book',
  method: 'readStructureBook',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    characterId: positiveId,
    subjectLifecycleId: z.uuid(),
    authorizationGeneration: z.number().int().nonnegative().safe(),
    organizationVersion: positiveId,
    structureId: positiveId,
    typeId: positiveId,
    side: z.enum(['buy', 'sell']),
    limit: z.number().int().min(1).max(100),
    cursorPrice: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/)
      .nullable(),
    cursorIssuedAt: z.iso.datetime({ offset: true }).nullable(),
    cursorOrderId: z.number().int().positive().safe().nullable(),
  }),
  outputSchema: z
    .strictObject({
      observationId: z.uuid(),
      structureId: positiveId,
      typeId: positiveId,
      observedAt: instant,
      validatedAt: instant,
      freshUntil: instant,
      expectedPages: z.number().int().min(1).max(32),
      totalBookOrders: z.number().int().nonnegative().safe(),
      rows: z
        .array(
          z.strictObject({
            orderId: positiveId,
            side: z.enum(['buy', 'sell']),
            price: z.string(),
            volumeRemain: z.number().int().nonnegative().safe(),
            locationId: positiveId,
            issuedAt: instant,
            durationDays: z.number().int().nonnegative(),
            minimumVolume: positiveId,
            range: z.string().min(1).max(20),
          }),
        )
        .max(100),
    })
    .nullable(),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 100_000,
})

export const cleanupStructureObservationsOperation = definePlatformPersistenceOperation({
  id: 'cleanup-structure-observations',
  method: 'cleanupStructureObservations',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z.strictObject({ outcome: z.literal('checked') }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

const structureDemandFields = {
  characterId: positiveId,
  subjectLifecycleId: z.uuid(),
  authorizationGeneration: z.number().int().nonnegative().safe(),
  organizationVersion: positiveId,
  structureId: positiveId,
  requestId: z.uuid(),
} as const

export const reserveStructureDemandOperation = definePlatformPersistenceOperation({
  id: 'reserve-structure-demand',
  method: 'reserveStructureDemand',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(structureDemandFields),
  outputSchema: z.strictObject({
    outcome: z.enum(['reserved', 'recent', 'full']),
  }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const releaseStructureDemandOperation = definePlatformPersistenceOperation({
  id: 'release-structure-demand',
  method: 'releaseStructureDemand',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject(structureDemandFields),
  outputSchema: z.strictObject({ outcome: z.literal('released') }),
  maximumInputBytes: 512,
  maximumOutputBytes: 256,
})

export const cleanupStructureDemandsOperation = definePlatformPersistenceOperation({
  id: 'cleanup-structure-demands',
  method: 'cleanupStructureDemands',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ now: instant }),
  outputSchema: z.strictObject({ outcome: z.literal('checked') }),
  maximumInputBytes: 256,
  maximumOutputBytes: 256,
})

export const readMarketQuoteRowsOperation = definePlatformPersistenceOperation({
  id: 'read-market-quote-rows',
  method: 'readMarketQuoteRows',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    observationId: z.uuid(),
    typeId: positiveId,
    side: z.enum(['buy', 'sell']),
    locationIds: z.array(positiveId).max(100),
    limit: z.number().int().min(1).max(1_000),
    cursorPrice: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,14})\.\d{2}$/)
      .nullable(),
    cursorIssuedAt: z.iso.datetime({ offset: true }).nullable(),
    cursorOrderId: z.number().int().positive().safe().nullable(),
  }),
  outputSchema: z.strictObject({
    rows: z
      .array(
        z.strictObject({
          orderId: positiveId,
          typeId: positiveId,
          side: z.enum(['buy', 'sell']),
          price: z.string(),
          volumeRemain: z.number().int().nonnegative().safe(),
          locationId: positiveId,
          solarSystemId: z.number().int().positive().safe().nullable(),
          issuedAt: instant,
          durationDays: z.number().int().nonnegative(),
          minimumVolume: positiveId,
          range: z.string().min(1).max(20),
        }),
      )
      .max(1_000),
    hasMore: z.boolean(),
  }),
  maximumInputBytes: 4_096,
  maximumOutputBytes: 1_000_000,
})

const operations = {
  'list-market-profiles': listMarketProfilesOperation,
  'save-market-profile': saveMarketProfileOperation,
  'list-due-market-profiles': listDueMarketProfilesOperation,
  'begin-market-observation': beginMarketObservationOperation,
  'stage-market-page': stageMarketPageOperation,
  'publish-current-market-observation': publishCurrentMarketObservationOperation,
  'publish-collected-market-observation': publishCollectedMarketObservationOperation,
  'record-market-failure': recordMarketFailureOperation,
  'record-market-type-failure': recordMarketTypeFailureOperation,
  'read-market-replacement-status': readMarketReplacementStatusOperation,
  'cleanup-market-observations': cleanupMarketObservationsOperation,
  'cleanup-market-observation-backlog': cleanupMarketObservationBacklogOperation,
  'read-market-observation': readMarketObservationOperation,
  'read-market-order-rows': readMarketOrderRowsOperation,
  'upsert-market-reference-prices': upsertMarketReferencePricesOperation,
  'read-market-reference-prices': readMarketReferencePricesOperation,
  'request-market-history-demand': requestMarketHistoryDemandOperation,
  'list-due-market-history-profiles': listDueMarketHistoryProfilesOperation,
  'list-due-market-history-types': listDueMarketHistoryTypesOperation,
  'upsert-market-history': upsertMarketHistoryOperation,
  'record-market-history-failure': recordMarketHistoryFailureOperation,
  'read-market-history': readMarketHistoryOperation,
  'store-market-metrics': storeMarketMetricsOperation,
  'list-market-derivation-types': listMarketDerivationTypesOperation,
  'read-market-metrics': readMarketMetricsOperation,
  'cleanup-market-history-demands': cleanupMarketHistoryDemandsOperation,
  'begin-structure-observation': beginStructureObservationOperation,
  'stage-structure-page': stageStructurePageOperation,
  'publish-structure-observation': publishStructureObservationOperation,
  'read-structure-book': readStructureBookOperation,
  'cleanup-structure-observations': cleanupStructureObservationsOperation,
  'reserve-structure-demand': reserveStructureDemandOperation,
  'release-structure-demand': releaseStructureDemandOperation,
  'cleanup-structure-demands': cleanupStructureDemandsOperation,
  'read-market-quote-rows': readMarketQuoteRowsOperation,
} as const

export type MarketProfileReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['list-market-profiles']
>

export type MarketProfileWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['save-market-profile']
>

export type MarketProfileDueReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['list-due-market-profiles']
>

export type MarketCollectionWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly [
    'begin-market-observation',
    'stage-market-page',
    'publish-collected-market-observation',
    'record-market-failure',
    'record-market-type-failure',
    'cleanup-market-observations',
    'cleanup-market-observation-backlog',
    'store-market-metrics',
  ]
>

export type MarketBookReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly [
    'read-market-observation',
    'read-market-replacement-status',
    'read-market-order-rows',
    'read-market-quote-rows',
    'read-market-metrics',
    'list-market-profiles',
  ]
>

export type MarketReferenceWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['upsert-market-reference-prices']
>

export type MarketReferenceReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['read-market-reference-prices']
>

export type MarketHistoryDemandWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['request-market-history-demand']
>

export type MarketHistoryProfileReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly [
    'list-due-market-history-profiles',
    'list-due-market-history-types',
    'read-market-history',
    'list-market-profiles',
  ]
>

export type MarketHistoryWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly [
    'upsert-market-history',
    'record-market-history-failure',
    'cleanup-market-history-demands',
  ]
>

export type MarketHistoryReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['read-market-history']
>

export type MarketDerivationTypesReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['list-market-derivation-types']
>

export type MarketStructureWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly [
    'begin-structure-observation',
    'stage-structure-page',
    'publish-structure-observation',
    'cleanup-structure-observations',
    'cleanup-structure-demands',
  ]
>

export type MarketStructureReads = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['read-structure-book']
>

export type MarketStructureDemandWrites = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['reserve-structure-demand', 'release-structure-demand']
>
