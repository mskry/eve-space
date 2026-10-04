import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  esi: vi.fn(),
}))
vi.mock('../../src/platform/resource-execution-guard.js', () => ({
  guardInstalledResourceExecution: mocks.guard,
}))
vi.mock('../../src/platform/module-route-capabilities.js', () => ({
  createPlatformResourceReadCapabilities: mocks.read,
}))
vi.mock('../../src/platform/module-persistence-capabilities.js', () => ({
  createPlatformResourceMaintenancePersistence: mocks.write,
}))
vi.mock('../../src/esi-gateway/platform-execution.js', () => ({
  executeUntypedPlatformEsiOperation: mocks.esi,
}))

import {
  executeInstalledProfileWork,
  planInstalledProfileWork,
} from '../../src/platform/profile-work.js'
import { platformResources } from '../../src/platform/resources.js'

const resource = platformResources.find(
  ({ moduleId, resourceId }) => moduleId === 'market' && resourceId === 'orders',
)!
const historyResource = platformResources.find(
  ({ moduleId, resourceId }) => moduleId === 'market' && resourceId === 'daily-history',
)!
const profileId = randomUUID()
const identity = {
  moduleId: 'market',
  resourceId: 'orders',
  subjectId: '1',
  subjectKind: 'deployment' as const,
  subjectLifecycleId: randomUUID(),
}
const work = {
  profileId,
  revision: 1,
  dueAt: '2026-09-28T12:00:00Z',
  resourceIdentity: identity,
}
const subject = {
  kind: 'deployment' as const,
  deploymentId: 1,
  lifecycleId: identity.subjectLifecycleId,
}
const reads = {
  listDueMarketProfiles: vi.fn(),
  listMarketProfiles: vi.fn(),
  listMarketDerivationTypes: vi.fn(),
}
const writes = {
  beginMarketObservation: vi.fn(),
  stageMarketPages: vi.fn(),
  publishCollectedMarketObservation: vi.fn(),
  recordMarketFailure: vi.fn(),
  recordMarketTypeFailure: vi.fn(),
  cleanupMarketObservations: vi.fn(),
  storeMarketMetrics: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({
    outcome: 'ready',
    resource,
    subject,
    authorization: null,
  })
  reads.listDueMarketProfiles.mockResolvedValue([{ profileId, revision: 1, nextDueAt: work.dueAt }])
  reads.listMarketProfiles.mockResolvedValue([
    {
      profileId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: true,
      revision: 1,
      nextDueAt: work.dueAt,
      lastFailureClass: null,
    },
  ])
  reads.listMarketDerivationTypes.mockResolvedValue([34])
  mocks.read.mockReturnValue({
    coreData: {
      marketStationRegions: vi.fn().mockResolvedValue({
        complete: true,
        rows: [],
        revision: {
          buildNumber: 1,
          ingestVersion: 6,
          ingestedAt: new Date().toISOString(),
        },
      }),
    },
    persistence: reads,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  mocks.write.mockReturnValue(writes)
  writes.beginMarketObservation.mockResolvedValue({ outcome: 'started' })
  writes.stageMarketPages.mockResolvedValue({ outcome: 'staged' })
  writes.publishCollectedMarketObservation.mockResolvedValue({
    outcome: 'published',
  })
  writes.recordMarketFailure.mockResolvedValue({ outcome: 'recorded' })
  writes.recordMarketTypeFailure.mockResolvedValue({ outcome: 'recorded' })
  writes.cleanupMarketObservations.mockResolvedValue({ outcome: 'checked' })
  writes.storeMarketMetrics.mockResolvedValue({ outcome: 'stored' })
  mocks.esi.mockImplementation(async () => ({
    data: [
      {
        order_id: 12,
        type_id: 34,
        location_id: 60003760,
        system_id: 30000142,
        is_buy_order: false,
        price: 6.42,
        volume_remain: 10,
        issued: new Date().toISOString(),
        duration: 90,
        min_volume: 1,
        range: 'station',
      },
    ],
    pagination: { pages: 1 },
    validatedAt: new Date().toISOString(),
    cachedUntil: new Date(Date.now() + 300_000).toISOString(),
    stale: false,
  }))
})

test('plans bounded current profile identities from durable due state', async () => {
  await expect(
    planInstalledProfileWork(identity, new Date().toISOString(), 16, {
      resources: [resource],
    }),
  ).resolves.toStrictEqual([work])
  expect(reads.listDueMarketProfiles).toHaveBeenCalledOnce()
  expect(mocks.esi).not.toHaveBeenCalled()
})

test('loads a current profile and publishes only a complete mapped observation', async () => {
  const outcome = await executeInstalledProfileWork(work, new AbortController().signal, {
    resources: [resource],
  })
  expect(outcome).toBe('completed')
  expect(mocks.esi).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'market-region-orders',
      authorization: { kind: 'public' },
      inputs: {
        path: { region_id: 10000058 },
        query: { order_type: 'all', page: 1, type_id: 34 },
      },
    }),
  )
  expect(writes.stageMarketPages).toHaveBeenCalledWith(
    expect.objectContaining({
      pages: [
        expect.objectContaining({
          orders: [expect.objectContaining({ orderId: 12, price: '6.42', side: 'sell' })],
        }),
      ],
    }),
  )
  expect(writes.publishCollectedMarketObservation).toHaveBeenCalledOnce()
  expect(writes.storeMarketMetrics).toHaveBeenCalledWith(
    expect.objectContaining({
      typeId: 34,
      metrics: expect.objectContaining({
        publication: 'complete',
        derivationVersion: 1,
        bestAskIsk: '6.42',
      }),
    }),
  )
})

test('continues a watched profile after an unchanged cached book without recording a failure', async () => {
  const [profile] = await reads.listMarketProfiles()
  reads.listMarketProfiles.mockResolvedValue([{ ...profile, watchedTypeIds: [34, 35] }])
  mocks.esi.mockResolvedValue({
    data: [],
    pagination: { pages: 1 },
    validatedAt: new Date().toISOString(),
    cachedUntil: new Date(Date.now() + 300_000).toISOString(),
    stale: false,
  })
  writes.publishCollectedMarketObservation
    .mockResolvedValueOnce({ outcome: 'unchanged' })
    .mockResolvedValueOnce({ outcome: 'published' })
  await expect(
    executeInstalledProfileWork(work, new AbortController().signal, {
      resources: [resource],
    }),
  ).resolves.toBe('completed')
  expect(writes.publishCollectedMarketObservation).toHaveBeenCalledTimes(2)
  expect(writes.recordMarketFailure).not.toHaveBeenCalled()
  expect(writes.recordMarketTypeFailure).not.toHaveBeenCalled()
  expect(writes.storeMarketMetrics).toHaveBeenCalledOnce()
  expect(writes.storeMarketMetrics).toHaveBeenCalledWith(expect.objectContaining({ typeId: 35 }))
})

test('closes admission before publication when the module is disabled in flight', async () => {
  mocks.guard
    .mockResolvedValueOnce({
      outcome: 'ready',
      resource,
      subject,
      authorization: null,
    })
    .mockResolvedValueOnce({ outcome: 'noop', reason: 'resource-unavailable' })
  await expect(
    executeInstalledProfileWork(work, new AbortController().signal, {
      resources: [resource],
    }),
  ).resolves.toBe('obsolete')
  expect(writes.publishCollectedMarketObservation).not.toHaveBeenCalled()
})

test('never begins staging when a page is unavailable or the gateway serves stale', async () => {
  mocks.esi.mockRejectedValueOnce(new Error('ESI page unavailable'))
  await expect(
    executeInstalledProfileWork(work, new AbortController().signal, {
      resources: [resource],
    }),
  ).rejects.toThrow('ESI page unavailable')
  expect(writes.beginMarketObservation).not.toHaveBeenCalled()
  expect(writes.recordMarketFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId,
      failureClass: 'unknown',
      retryAt: null,
    }),
  )
  expect(writes.recordMarketTypeFailure).toHaveBeenCalledWith(
    expect.objectContaining({ profileId, expectedRevision: 1, typeId: 34 }),
  )

  mocks.esi.mockResolvedValueOnce({
    data: [],
    pagination: { pages: 1 },
    validatedAt: new Date().toISOString(),
    cachedUntil: new Date(Date.now() + 300_000).toISOString(),
    stale: true,
    refreshFailureClass: 'esi-unavailable',
  })
  await expect(
    executeInstalledProfileWork(work, new AbortController().signal, {
      resources: [resource],
    }),
  ).rejects.toThrow('unavailable')
  expect(writes.beginMarketObservation).not.toHaveBeenCalled()
  expect(writes.recordMarketFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId,
      failureClass: 'esi-unavailable',
      retryAt: expect.any(String),
    }),
  )
})

test('uses the gateway retry deadline instead of refreshing through a market-order cooldown', async () => {
  const retryAt = new Date(Date.now() + 60_000).toISOString()
  mocks.esi.mockResolvedValueOnce({
    data: [],
    pagination: { pages: 1 },
    validatedAt: new Date().toISOString(),
    cachedUntil: retryAt,
    stale: true,
    refreshFailureClass: 'esi-cooldown',
    retryAt,
  })
  await expect(
    executeInstalledProfileWork(work, new AbortController().signal, {
      resources: [resource],
    }),
  ).rejects.toThrow('ESI quota is temporarily exhausted')
  expect(writes.beginMarketObservation).not.toHaveBeenCalled()
  expect(writes.recordMarketFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      failureClass: 'esi-cooldown',
      retryAt,
    }),
  )
})

test('does not record an obsolete or cancelled profile result as a source failure', async () => {
  reads.listMarketProfiles.mockResolvedValueOnce([
    {
      profileId,
      enabled: true,
      revision: 2,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      nextDueAt: work.dueAt,
      lastFailureClass: null,
    },
  ])
  await expect(
    executeInstalledProfileWork(work, new AbortController().signal, {
      resources: [resource],
    }),
  ).resolves.toBe('obsolete')
  expect(mocks.esi).not.toHaveBeenCalled()
  expect(writes.recordMarketFailure).not.toHaveBeenCalled()
  expect(writes.recordMarketTypeFailure).not.toHaveBeenCalled()

  const cancellation = new AbortController()
  mocks.esi.mockImplementationOnce(async () => {
    cancellation.abort()
    throw cancellation.signal.reason
  })
  await expect(
    executeInstalledProfileWork(work, cancellation.signal, {
      resources: [resource],
    }),
  ).rejects.toThrow('This operation was aborted')
  expect(writes.publishCollectedMarketObservation).not.toHaveBeenCalled()
  expect(writes.recordMarketFailure).not.toHaveBeenCalled()
})

test.each([undefined, 48582])(
  'collects independent history and prioritizes requested type %s',
  async (requestedTypeId) => {
    const historyReads = {
      ...reads,
      listDueMarketHistoryCollectionProfiles: vi.fn(),
      listDueMarketIntelligenceReconciliations: vi.fn().mockResolvedValue([]),
      selectMarketIntelligenceWork: vi.fn().mockResolvedValue({ kind: 'history' }),
      listDueMarketHistoryTargets: vi
        .fn()
        .mockImplementation(async ({ typeId }: { typeId?: number }) => [
          {
            regionId: 10000058,
            typeId: typeId ?? 34,
            nextDueAt: work.dueAt,
            policyRevision: null,
            universeId: null,
          },
        ]),
    }
    const convergeMarketHistory = vi.fn().mockResolvedValue({ outcome: 'applied' })
    const recordMarketHistoryFailure = vi.fn().mockResolvedValue({ outcome: 'recorded' })
    mocks.guard.mockResolvedValue({
      outcome: 'ready',
      resource: historyResource,
      subject,
      authorization: null,
    })
    mocks.read.mockReturnValue({
      coreData: {},
      persistence: historyReads,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    mocks.write.mockReturnValue({
      convergeMarketHistory,
      recordMarketHistoryFailure,
    })
    mocks.esi.mockResolvedValue({
      data: [
        {
          date: '2026-09-27',
          average: 6.42,
          highest: 7,
          lowest: 6,
          volume: 100,
          order_count: 9,
        },
      ],
      validatedAt: new Date().toISOString(),
      cachedUntil: new Date(Date.now() + 86_400_000).toISOString(),
      stale: false,
    })
    const historyWork = {
      ...work,
      resourceIdentity: { ...identity, resourceId: 'daily-history' },
      requestedTypeId,
    }
    expect(
      await executeInstalledProfileWork(historyWork, new AbortController().signal, {
        resources: [historyResource],
      }),
    ).toBe('completed')
    expect(historyReads.listDueMarketHistoryTargets.mock.calls[0]?.[0]?.typeId).toBe(
      requestedTypeId,
    )
    expect(mocks.esi).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'market-region-history',
        inputs: {
          path: { region_id: 10000058 },
          query: { type_id: requestedTypeId ?? 34 },
        },
      }),
    )
    expect(convergeMarketHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        typeId: requestedTypeId ?? 34,
        days: [
          {
            date: '2026-09-27',
            averageIsk: '6.42',
            volume: 100,
            highIsk: '7.00',
            lowIsk: '6.00',
            orderCount: 9,
          },
        ],
      }),
    )
    expect(writes.publishCollectedMarketObservation).not.toHaveBeenCalled()
  },
)

test.each([undefined, 48582])(
  'isolates a history item failure for requested type %s',
  async (requestedTypeId) => {
    const recordMarketHistoryFailure = vi.fn().mockResolvedValue({ outcome: 'recorded' })
    const recordMarketHistoryItemFailure = vi.fn().mockResolvedValue({ outcome: 'recorded' })
    mocks.guard.mockResolvedValue({
      outcome: 'ready',
      resource: historyResource,
      subject,
      authorization: null,
    })
    mocks.read.mockReturnValue({
      coreData: {},
      persistence: {
        ...reads,
        listDueMarketIntelligenceReconciliations: vi.fn().mockResolvedValue([]),
        selectMarketIntelligenceWork: vi.fn().mockResolvedValue({ kind: 'history' }),
        listDueMarketHistoryTargets: vi.fn().mockImplementation(async ({ typeId }) => [
          {
            regionId: 10000058,
            typeId: typeId ?? 34,
            nextDueAt: work.dueAt,
            policyRevision: null,
            universeId: null,
          },
        ]),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    mocks.write.mockReturnValue({
      convergeMarketHistory: vi.fn(),
      recordMarketHistoryFailure,
      recordMarketHistoryItemFailure,
    })
    mocks.esi.mockRejectedValue(new Error('ESI unavailable'))
    await expect(
      executeInstalledProfileWork(
        {
          ...work,
          resourceIdentity: { ...identity, resourceId: 'daily-history' },
          requestedTypeId,
        },
        new AbortController().signal,
        { resources: [historyResource] },
      ),
    ).resolves.toBe('completed')
    expect(recordMarketHistoryFailure).not.toHaveBeenCalled()
    expect(recordMarketHistoryItemFailure).toHaveBeenCalledOnce()
    expect(recordMarketHistoryItemFailure.mock.calls[0]?.[0]?.typeId).toBe(requestedTypeId ?? 34)
  },
)

type PublicProfileMode = 'region' | 'watched-types'

const preparePagedProfile = async (mode: PublicProfileMode) => {
  const [profile] = await reads.listMarketProfiles()
  reads.listMarketProfiles.mockResolvedValue([
    { ...profile, mode, watchedTypeIds: mode === 'region' ? [] : [34] },
  ])
  const response = await mocks.esi()
  mocks.esi.mockClear()
  mocks.esi.mockImplementation(async ({ inputs }: { inputs: { query: { page: number } } }) => ({
    ...response,
    data: [{ ...response.data[0], order_id: inputs.query.page }],
    pagination: { pages: 41 },
  }))
  return response
}

test.each(['region', 'watched-types'] as const)(
  'stages %s profiles in bounded batches before complete publication',
  async (mode) => {
    const response = await preparePagedProfile(mode)
    expect(
      await executeInstalledProfileWork(work, new AbortController().signal, {
        resources: [resource],
      }),
    ).toBe('completed')
    const batches = writes.stageMarketPages.mock.calls.map(([batch]) => batch)
    expect(batches.map((batch) => batch.pages.length)).toEqual([10, 10, 10, 10, 1])
    expect(
      batches.flatMap((batch) => batch.pages.map((page: { page: number }) => page.page)),
    ).toEqual(Array.from({ length: 41 }, (_, index) => index + 1))
    const sourcePages = batches.flatMap((batch) => batch.pages)
    expect(
      sourcePages.every(
        (page) =>
          page.validatedAt === response.validatedAt && page.freshUntil === response.cachedUntil,
      ),
    ).toBe(true)
    const published = writes.publishCollectedMarketObservation.mock.calls[0]![0].observationId
    expect(batches.every((batch) => batch.observationId === published)).toBe(true)
    expect(writes.storeMarketMetrics.mock.calls[0]![0].observationId).toBe(published)
    expect(writes.publishCollectedMarketObservation).toHaveBeenCalledOnce()
  },
)

test.each([
  { reason: 'cancelled', expected: { error: expect.stringContaining('aborted') } },
  { reason: 'disabled', expected: { outcome: 'obsolete' } },
  { reason: 'obsolete', expected: { outcome: 'obsolete' } },
  { reason: 'failed', expected: { error: 'batch failed' } },
])(
  'stops remaining batches and publication after work is $reason',
  async ({ reason, expected }) => {
    await preparePagedProfile('region')
    const cancellation = new AbortController()
    writes.stageMarketPages.mockImplementationOnce(async () => {
      if (reason === 'cancelled') cancellation.abort()
      if (reason === 'disabled')
        mocks.guard.mockResolvedValue({ outcome: 'noop', reason: 'resource-unavailable' })
      if (reason === 'obsolete') return { outcome: 'obsolete' }
      if (reason === 'failed') throw new Error('batch failed')
      return { outcome: 'staged' }
    })
    const result = executeInstalledProfileWork(work, cancellation.signal, { resources: [resource] })
    const outcome = await result.then(
      (value) => ({ outcome: value }),
      (error) => ({ error: error instanceof Error ? error.message : String(error) }),
    )
    expect(outcome).toEqual(expected)
    expect(writes.stageMarketPages).toHaveBeenCalledOnce()
    expect(writes.publishCollectedMarketObservation).not.toHaveBeenCalled()
    expect(writes.storeMarketMetrics).not.toHaveBeenCalled()
  },
)
