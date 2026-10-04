import { testClient } from 'hono/testing'
import { Hono } from 'hono'
import type { PlatformPublicMutationRouteEnv } from '@eve-space/platform-module-contract/server'
import { beforeEach, expect, test, vi } from 'vitest'
import { marketHistoryDemandRoutes, marketHistoryRoutes } from '../src/history-routes.js'

const profileId = '00000000-0000-4000-8000-000000000001'
const revision = { buildNumber: 1, ingestVersion: 6, ingestedAt: '2026-09-28T12:00:00Z' }
const historyPersistence = { readMarketHistorySource: vi.fn() }
const demandPersistence = {
  listMarketProfiles: vi.fn(),
  requestMarketHistoryDemand: vi.fn(),
  readMarketHistorySource: vi.fn(),
}
const requester = { request: vi.fn() }
const coreData = { marketCatalogue: vi.fn() }
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const history = marketHistoryRoutes({ coreData: {}, persistence: historyPersistence, logger })
const demand = new Hono<PlatformPublicMutationRouteEnv>()
  .use('*', async (context, next) => {
    context.set('onDemandProfile', requester)
    return next()
  })
  .route('/', marketHistoryDemandRoutes({ coreData, persistence: demandPersistence, logger }))

beforeEach(() => {
  vi.clearAllMocks()
  historyPersistence.readMarketHistorySource.mockResolvedValue({
    status: 'uncollected',
    regionId: 10000058,
    typeId: 34,
    validatedAt: null,
    freshUntil: null,
    days: [],
  })
  demandPersistence.listMarketProfiles.mockResolvedValue([
    {
      profileId,
      regionId: 10000058,
      mode: 'region',
      stationIds: [],
      watchedTypeIds: [],
      enabled: true,
      revision: 1,
      nextDueAt: null,
      lastFailureClass: null,
    },
  ])
  demandPersistence.requestMarketHistoryDemand.mockResolvedValue({ outcome: 'accepted' })
  demandPersistence.readMarketHistorySource.mockResolvedValue({
    status: 'uncollected',
    regionId: 10000058,
    typeId: 34,
    validatedAt: null,
    freshUntil: null,
    days: [],
  })
  requester.request.mockResolvedValue('queued')
  coreData.marketCatalogue.mockResolvedValue({
    kind: 'type-by-id',
    item: { id: 34, groupId: 18, name: 'Tritanium' },
    revision,
    complete: true,
  })
})

const observedHistory = () => ({
  status: 'observed',
  regionId: 10000058,
  typeId: 34,
  validatedAt: new Date().toISOString(),
  freshUntil: new Date(Date.now() + 60_000).toISOString(),
  days: [],
})

const requestHistory = () =>
  demand.request(`/profiles/${profileId}/types/34/demand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })

test('returns fresh committed history immediately without waking the worker', async () => {
  const stored = observedHistory()
  demandPersistence.readMarketHistorySource.mockResolvedValue(stored)
  const response = await requestHistory()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    status: 'ready',
    history: { ...stored, freshness: 'current' },
  })
  expect(requester.request).not.toHaveBeenCalled()
})

test('returns the requested history after an immediately completed worker attempt', async () => {
  const stored = observedHistory()
  requester.request.mockImplementationOnce(async () => {
    demandPersistence.readMarketHistorySource.mockResolvedValue(stored)
    return 'completed'
  })
  const response = await requestHistory()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    status: 'ready',
    history: { validatedAt: stored.validatedAt },
  })
  expect(requester.request).toHaveBeenCalledWith(
    { profileId, revision: 1, typeId: 34 },
    expect.any(AbortSignal),
  )
})

test.each(['queued', 'collecting', 'waiting'])(
  'reports actual pending worker phase %s',
  async (phase) => {
    requester.request.mockResolvedValueOnce(phase)
    const response = await requestHistory()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'accepted', phase })
  },
)

test('does not equate job completion with committed history availability', async () => {
  requester.request.mockResolvedValueOnce('completed')
  const response = await requestHistory()
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ code: 'MARKET_HISTORY_COLLECTION_UNAVAILABLE' })
})

test('a public history deep link reports uncollected coverage without creating demand', async () => {
  const response = await testClient(history).profiles[':profileId'].types[':typeId'].$get({
    param: { profileId, typeId: '34' },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ freshness: 'uncollected', days: [] })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(demandPersistence.requestMarketHistoryDemand).not.toHaveBeenCalled()
})

test('retains the independent source time and available daily rows when history turns stale', async () => {
  historyPersistence.readMarketHistorySource.mockResolvedValueOnce({
    status: 'observed',
    regionId: 10000058,
    typeId: 34,
    validatedAt: '2026-09-27T11:05:00Z',
    freshUntil: '2026-09-28T11:05:00Z',
    days: [
      {
        date: '2026-09-27',
        averageIsk: '6.42',
        highIsk: '7.00',
        lowIsk: '6.00',
        volume: 100,
        orderCount: 9,
      },
    ],
  })
  const response = await history.request(`/profiles/${profileId}/types/34`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    freshness: 'stale',
    validatedAt: '2026-09-27T11:05:00Z',
    days: [{ averageIsk: '6.42' }],
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

test('the separate browser intent admits only a current published marketable type', async () => {
  const path = `/profiles/${profileId}/types/34/demand`
  const accepted = await demand.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(accepted.status).toBe(202)
  expect(demandPersistence.requestMarketHistoryDemand).toHaveBeenCalledWith(
    expect.objectContaining({ profileId, typeId: 34, expectedRevision: 1 }),
  )
  coreData.marketCatalogue.mockResolvedValueOnce({
    kind: 'type-by-id',
    item: null,
    revision,
    complete: true,
  })
  expect(
    (
      await demand.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(404)
  expect(demandPersistence.requestMarketHistoryDemand).toHaveBeenCalledTimes(1)
  demandPersistence.requestMarketHistoryDemand.mockResolvedValueOnce({ outcome: 'unavailable' })
  expect(
    (
      await demand.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(429)
})

test('checks actual delivery for saved demand whose earlier admission may have been deferred', async () => {
  demandPersistence.requestMarketHistoryDemand.mockResolvedValueOnce({ outcome: 'duplicate' })
  requester.request.mockResolvedValueOnce('waiting')
  const response = await demand.request(`/profiles/${profileId}/types/34/demand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(response.status).toBe(202)
  expect(await response.json()).toStrictEqual({ status: 'accepted', phase: 'waiting' })
  expect(requester.request).toHaveBeenCalledWith(
    { profileId, revision: 1, typeId: 34 },
    expect.any(AbortSignal),
  )
})

test('labels retained evidence after an empty success as stale while a genuinely empty source stays current', async () => {
  const stored = {
    ...observedHistory(),
    source: { state: 'empty' },
    retainedEvidence: true,
    days: [
      {
        date: '2026-10-01',
        averageIsk: '10.00',
        highIsk: '12.00',
        lowIsk: '8.00',
        volume: 10,
        orderCount: 2,
      },
    ],
  }
  historyPersistence.readMarketHistorySource.mockResolvedValue(stored)
  const retained = await history.request(`/profiles/${profileId}/types/34`)
  expect(await retained.json()).toMatchObject({
    freshness: 'stale',
    retainedEvidence: true,
    source: { state: 'empty' },
    days: [{ averageIsk: '10.00' }],
  })
  expect(retained.headers.get('Cache-Control')).toBe('no-store')
  historyPersistence.readMarketHistorySource.mockResolvedValue({
    ...stored,
    days: [],
    retainedEvidence: false,
  })
  const empty = await history.request(`/profiles/${profileId}/types/34`)
  expect(await empty.json()).toMatchObject({
    freshness: 'current',
    retainedEvidence: false,
    days: [],
  })
})
