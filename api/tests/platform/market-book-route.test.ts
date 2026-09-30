import { marketBookRoutes, marketReferenceRoutes } from '@eve-space/market-server'
import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isInstalledModuleContributionEnabled: vi.fn() }))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.isInstalledModuleContributionEnabled,
}))

import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const profileId = '00000000-0000-4000-8000-000000000001'
const persistence = {
  listMarketProfiles: vi.fn(),
  readMarketObservation: vi.fn(),
  readMarketReplacementStatus: vi.fn(),
  readMarketOrderRows: vi.fn(),
  readMarketQuoteRows: vi.fn(),
  readMarketMetrics: vi.fn(),
}
const coreData = { staticLocationLabels: vi.fn() }
const referencePersistence = { readMarketReferencePrices: vi.fn() }
const app = new Hono()
  .route(
    '/api/modules/market/books',
    platformModuleRouteComposers.public(
      'market',
      marketBookRoutes({
        coreData,
        persistence,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ),
  )
  .route(
    '/api/modules/market/reference-prices',
    platformModuleRouteComposers.public(
      'market',
      marketReferenceRoutes({
        coreData: {},
        persistence: referencePersistence,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ),
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(true)
  persistence.listMarketProfiles.mockResolvedValue([
    {
      profileId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: true,
      revision: 1,
      nextDueAt: new Date().toISOString(),
      lastFailureClass: null,
    },
  ])
  persistence.readMarketObservation.mockResolvedValue(null)
  persistence.readMarketReplacementStatus.mockResolvedValue(null)
  referencePersistence.readMarketReferencePrices.mockResolvedValue([])
})

test('keeps a public uncollected book distinct from empty observed orders', async () => {
  const response = await app.request(
    `/api/modules/market/books/profiles/${profileId}/types/34/observation`,
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toStrictEqual({
    status: 'uncollected',
    collectionStatus: 'ready',
    replacement: null,
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(persistence.readMarketOrderRows).not.toHaveBeenCalled()
})

test('blocks disabled Market before any profile, book, or static-label read', async () => {
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
  expect((await app.request('/api/modules/market/books/profiles')).status).toBe(404)
  const response = await app.request(
    `/api/modules/market/books/profiles/${profileId}/types/34/observation`,
  )
  expect(response.status).toBe(404)
  expect(persistence.listMarketProfiles).not.toHaveBeenCalled()
  expect(persistence.readMarketObservation).not.toHaveBeenCalled()
  expect(persistence.readMarketReplacementStatus).not.toHaveBeenCalled()
  expect(coreData.staticLocationLabels).not.toHaveBeenCalled()
})

test('preserves the complete book when the profile has a later collection failure', async () => {
  const observationId = '00000000-0000-4000-8000-000000000002'
  persistence.listMarketProfiles.mockResolvedValueOnce([
    {
      profileId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: true,
      revision: 1,
      lastFailureClass: 'response-invalid',
    },
  ])
  persistence.readMarketObservation.mockResolvedValueOnce({
    observationId,
    profileId,
    regionId: 10000058,
    typeId: 34,
    observedAt: '2026-09-01T00:00:00.000Z',
    validatedAt: '2026-09-01T00:00:00.000Z',
    freshUntil: '2026-09-01T00:05:00.000Z',
    expectedPages: 1,
    totalBookOrders: 0,
  })
  persistence.readMarketOrderRows.mockResolvedValue({ rows: [], hasMore: false })
  coreData.staticLocationLabels.mockResolvedValue({ rows: [] })
  const response = await app.request(
    `/api/modules/market/books/profiles/${profileId}/types/34/observation`,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    status: 'stale',
    collectionStatus: 'profile-failed',
    observation: { observationId, observedAt: '2026-09-01T00:00:00.000Z' },
  })
})

test('rejects invalid type identifiers before profile persistence', async () => {
  const response = await app.request(
    `/api/modules/market/books/profiles/${profileId}/types/0/observation`,
  )
  expect(response.status).toBe(400)
  expect(persistence.listMarketProfiles).not.toHaveBeenCalled()
})

test('disabled Market blocks derived-metric reads before module persistence', async () => {
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
  expect(
    (await app.request(`/api/modules/market/books/profiles/${profileId}/types/34/metrics`)).status,
  ).toBe(404)
  expect(persistence.readMarketMetrics).not.toHaveBeenCalled()
})

test('keeps reference prices public but distinct from executable order depth', async () => {
  const response = await app.request('/api/modules/market/reference-prices?typeIds=34,35')
  expect(response.status).toBe(200)
  expect(await response.json()).toStrictEqual({ kind: 'non-executable-reference', rows: [] })
  expect(referencePersistence.readMarketReferencePrices).toHaveBeenCalledWith({ typeIds: [34, 35] })
  expect((await app.request('/api/modules/market/reference-prices?typeIds=34,34')).status).toBe(400)
  mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
  expect((await app.request('/api/modules/market/reference-prices?typeIds=34')).status).toBe(404)
  expect(referencePersistence.readMarketReferencePrices).toHaveBeenCalledTimes(1)
})
