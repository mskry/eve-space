import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server'

const audit = { reviewedDate: '2026-09-28' } as const
const retry = {
  attempts: 2,
  initialDelayMilliseconds: 250,
  kind: 'idempotent',
  maximumDelayMilliseconds: 1000,
} as const
const publicCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 86_400_000,
  stale: { kind: 'bounded', milliseconds: 3_600_000 },
} as const
const privateCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 86_400_000,
  stale: { kind: 'outage', milliseconds: 3_600_000 },
} as const

export const regionOrdersOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMarketsRegionIdOrders',
  policy: {
    audit: audit,
    cache: publicCache,
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'regionId' },
        { kind: 'scalar', field: 'orderType' },
        { kind: 'scalar', field: 'typeId', nullable: true },
        { kind: 'scalar', field: 'page', nullable: true },
      ],
    },
    representationVersion: 'v1',
    retry: retry,
  },
})

export const regionTypesOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMarketsRegionIdTypes',
  policy: {
    audit: audit,
    cache: publicCache,
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'regionId' },
        { kind: 'scalar', field: 'page', nullable: true },
      ],
    },
    representationVersion: 'v1',
    retry: retry,
  },
})

export const regionHistoryOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMarketsRegionIdHistory',
  policy: {
    audit: audit,
    cache: publicCache,
    freshness: { kind: 'runtime-only' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'regionId' },
        { kind: 'scalar', field: 'typeId' },
      ],
    },
    representationVersion: 'v1',
    retry: retry,
  },
})

export const referencePricesOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMarketsPrices',
  policy: {
    audit: audit,
    cache: publicCache,
    identity: { kind: 'ordered', fields: [] },
    representationVersion: 'v1',
    retry: retry,
  },
})

export const structureOrdersOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMarketsStructuresStructureId',
  policy: {
    audit: audit,
    cache: privateCache,
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'structureId' },
        { kind: 'scalar', field: 'page', nullable: true },
      ],
    },
    representationVersion: 'v1',
    retry: retry,
  },
})
