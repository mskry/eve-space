import {
  marketHistoryDemandRoutes,
  marketHistoryRoutes,
  marketQuoteRoutes,
} from '@eve-space/market-server'
import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'
import { env } from '../../src/env.js'

const mocks = vi.hoisted(() => ({ isInstalledModuleContributionEnabled: vi.fn() }))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.isInstalledModuleContributionEnabled,
}))

import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const profileId = '00000000-0000-4000-8000-000000000001'
const readMarketHistorySource = vi.fn()
const listMarketProfiles = vi.fn()
const requestMarketHistoryDemand = vi.fn()
const marketCatalogue = vi.fn()
const requester = { request: vi.fn() }
const quotePersistence = { readMarketObservation: vi.fn(), readMarketQuoteRows: vi.fn() }
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const app = new Hono()
  .route(
    '/api/modules/market/history',
    platformModuleRouteComposers.public(
      'market',
      marketHistoryRoutes({ coreData: {}, persistence: { readMarketHistorySource }, logger }),
    ),
  )
  .route(
    '/api/modules/market/history-intent',
    platformModuleRouteComposers['public-mutation'](
      'market',
      marketHistoryDemandRoutes({
        coreData: { marketCatalogue },
        persistence: { listMarketProfiles, requestMarketHistoryDemand, readMarketHistorySource },
        logger,
      }),
      requester,
    ),
  )
  .route(
    '/api/modules/market/quotes',
    platformModuleRouteComposers['public-mutation'](
      'market',
      marketQuoteRoutes({
        coreData: {},
        persistence: quotePersistence,
        logger,
      }),
    ),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(true)
  readMarketHistorySource.mockResolvedValue({
    status: 'uncollected',
    regionId: 10000058,
    typeId: 34,
    validatedAt: null,
    freshUntil: null,
    days: [],
    source: null,
    retainedEvidence: false,
  })
  listMarketProfiles.mockResolvedValue([
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
  requestMarketHistoryDemand.mockResolvedValue({ outcome: 'accepted' })
  requester.request.mockResolvedValue('queued')
  marketCatalogue.mockResolvedValue({
    kind: 'type-by-id',
    complete: true,
    item: { id: 34, groupId: 18, name: 'Tritanium' },
    revision: { buildNumber: 1, ingestVersion: 6, ingestedAt: new Date().toISOString() },
  })
  quotePersistence.readMarketObservation.mockResolvedValue(null)
})

test('SSR-capable public history GET stays read-only and the trusted mutation alone records demand', async () => {
  const path = `/api/modules/market/history/profiles/${profileId}/types/34`
  expect((await app.request(path)).status).toBe(200)
  expect(requestMarketHistoryDemand).not.toHaveBeenCalled()
  const intent = `/api/modules/market/history-intent/profiles/${profileId}/types/34/demand`
  expect(
    (
      await app.request(intent, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(403)
  expect(requestMarketHistoryDemand).not.toHaveBeenCalled()
  expect(
    (
      await app.request(intent, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: env.WEB_ORIGIN },
        body: '{}',
      })
    ).status,
  ).toBe(202)
  expect(requestMarketHistoryDemand).toHaveBeenCalledOnce()
})

test('disabled Market blocks both history read and intent before feature work', async () => {
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
  expect(
    (await app.request(`/api/modules/market/history/profiles/${profileId}/types/34`)).status,
  ).toBe(404)
  expect(
    (
      await app.request(
        `/api/modules/market/history-intent/profiles/${profileId}/types/34/demand`,
        {
          method: 'POST',
          headers: { Origin: env.WEB_ORIGIN, 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
    ).status,
  ).toBe(404)
  expect(readMarketHistorySource).not.toHaveBeenCalled()
  expect(listMarketProfiles).not.toHaveBeenCalled()
  expect(marketCatalogue).not.toHaveBeenCalled()
})

test('quantity quotes require trusted browser intent and a complete pinned observation', async () => {
  const path = `/api/modules/market/quotes/profiles/${profileId}/types/34/quote`
  const body = JSON.stringify({
    observationId: '00000000-0000-4000-8000-000000000002',
    side: 'buy',
    quantity: 5,
    locationIds: [],
  })
  expect(
    (
      await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    ).status,
  ).toBe(403)
  expect(quotePersistence.readMarketObservation).not.toHaveBeenCalled()
  expect(
    (
      await app.request(path, {
        method: 'POST',
        headers: { Origin: env.WEB_ORIGIN, 'Content-Type': 'application/json' },
        body,
      })
    ).status,
  ).toBe(404)
  expect(quotePersistence.readMarketQuoteRows).not.toHaveBeenCalled()
})
