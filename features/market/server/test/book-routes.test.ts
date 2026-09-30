import { testClient } from 'hono/testing'
import { beforeEach, expect, test, vi } from 'vitest'
import { marketBookRoutes } from '../src/book-routes.js'

const profileId = '00000000-0000-4000-8000-000000000001'
const observationId = '00000000-0000-4000-8000-000000000002'
const now = new Date()
const observation = {
  observationId,
  profileId,
  regionId: 10000058,
  typeId: 34,
  observedAt: now.toISOString(),
  validatedAt: now.toISOString(),
  freshUntil: new Date(now.getTime() + 300_000).toISOString(),
  expectedPages: 1,
  totalBookOrders: 2,
}
const persistence = {
  listMarketProfiles: vi.fn(),
  readMarketObservation: vi.fn(),
  readMarketReplacementStatus: vi.fn(),
  readMarketOrderRows: vi.fn(),
  readMarketQuoteRows: vi.fn(),
  readMarketMetrics: vi.fn(),
}
const coreData = { staticLocationLabels: vi.fn() }
const app = marketBookRoutes({
  coreData,
  persistence,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
})
const client = testClient(app)

beforeEach(() => {
  vi.clearAllMocks()
  persistence.listMarketProfiles.mockResolvedValue([
    {
      profileId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: true,
      revision: 1,
      nextDueAt: now.toISOString(),
      lastFailureClass: null,
    },
  ])
  persistence.readMarketObservation.mockResolvedValue(observation)
  persistence.readMarketReplacementStatus.mockResolvedValue(null)
  persistence.readMarketMetrics.mockResolvedValue({
    availableFrom: null,
    availableThrough: null,
    items: [],
  })
  persistence.readMarketOrderRows.mockImplementation(async ({ side }: { side: string }) => ({
    rows:
      side === 'sell'
        ? [
            {
              orderId: 1,
              side: 'sell',
              price: '6.42',
              volumeRemain: 10,
              locationId: 60003760,
              solarSystemId: 30000142,
              issuedAt: now.toISOString(),
              durationDays: 90,
              minimumVolume: 1,
              range: 'station',
            },
          ]
        : [],
    hasMore: false,
  }))
  coreData.staticLocationLabels.mockResolvedValue({
    rows: [
      {
        locationId: 60003760,
        name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        kind: 'station',
        solarSystemId: 30000142,
        solarSystemName: 'Jita',
        solarSystemSecurityStatus: 0.945913,
      },
    ],
    complete: true,
    revision: { buildNumber: 1, ingestVersion: 6, ingestedAt: now.toISOString() },
  })
})

test('lists only bounded configured public markets without failure internals', async () => {
  const response = await client.profiles.$get()
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toMatchObject({ profiles: [{ profileId, revision: 1, regionId: 10000058 }] })
  expect(body.profiles[0].marketScope).toBe('region')
  expect(JSON.stringify(body)).not.toContain('lastFailureClass')
})

test('labels the PLEX-only public profile as global instead of a regional book', async () => {
  persistence.listMarketProfiles.mockResolvedValueOnce([
    {
      profileId,
      revision: 1,
      regionId: 19000001,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [44992],
      enabled: true,
      lastFailureClass: null,
    },
  ])
  const response = await app.request('/profiles')
  expect(await response.json()).toMatchObject({
    profiles: [{ regionId: 19000001, marketScope: 'global-plex', watchedTypeIds: [44992] }],
  })
})

test('pins both sides to one complete observation with source times and safe labels', async () => {
  persistence.readMarketOrderRows.mockImplementation(async ({ side }: { side: string }) => ({
    rows: [
      {
        orderId: side === 'sell' ? 1 : 2,
        side,
        price: side === 'sell' ? '6.42' : '5.99',
        volumeRemain: 10,
        locationId: 60003760,
        solarSystemId: 30000142,
        issuedAt: now.toISOString(),
        durationDays: 90,
        minimumVolume: side === 'sell' ? 1 : 5,
        range: side === 'sell' ? 'station' : 'region',
      },
    ],
    hasMore: false,
  }))
  const response = await app.request(`/profiles/${profileId}/types/34/observation`)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toMatchObject({
    status: 'current',
    collectionStatus: 'ready',
    observation: {
      observationId,
      observedAt: now.toISOString(),
      validatedAt: now.toISOString(),
      freshUntil: observation.freshUntil,
      expectedPages: 1,
      totalBookOrders: 2,
    },
    sellers: {
      rows: [
        {
          orderId: 1,
          side: 'sell',
          price: '6.42',
          locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
          solarSystemSecurityStatus: 0.945913,
        },
      ],
    },
    buyers: {
      rows: [{ orderId: 2, side: 'buy', price: '5.99', minimumVolume: 5, range: 'region' }],
      hasMore: false,
    },
  })
  expect(body.sellers.rows[0].expiryAt).toBe(
    new Date(Date.parse(now.toISOString()) + 90 * 86_400_000).toISOString(),
  )
  expect(persistence.readMarketOrderRows).toHaveBeenCalledTimes(2)
  expect(persistence.readMarketOrderRows).toHaveBeenCalledWith(
    expect.objectContaining({ observationId }),
  )
  expect(JSON.stringify(body)).not.toContain('is_buy_order')
  expect(JSON.stringify(body)).not.toContain('volume_remain')
})

test('distinguishes uncollected, observed-empty, and unavailable identities', async () => {
  persistence.readMarketObservation.mockResolvedValueOnce(null)
  const missing = await app.request(`/profiles/${profileId}/types/34/observation`)
  expect(missing.status).toBe(200)
  expect(await missing.json()).toEqual({
    status: 'uncollected',
    collectionStatus: 'ready',
    replacement: null,
  })
  expect(missing.headers.get('Cache-Control')).toBe('no-store')

  persistence.readMarketOrderRows
    .mockResolvedValueOnce({ rows: [], hasMore: false })
    .mockResolvedValueOnce({ rows: [], hasMore: false })
  const empty = await app.request(`/profiles/${profileId}/types/34/observation`)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toMatchObject({
    status: 'current',
    sellers: { rows: [] },
    buyers: { rows: [] },
  })

  persistence.listMarketProfiles.mockResolvedValueOnce([])
  const unavailable = await app.request(`/profiles/${profileId}/types/34/observation`)
  expect(unavailable.status).toBe(404)
  expect(persistence.readMarketObservation).toHaveBeenCalledTimes(2)
})

test('reports a profile-level failed replacement without changing a complete book identity', async () => {
  persistence.listMarketProfiles.mockResolvedValueOnce([
    {
      profileId,
      regionId: 10000058,
      mode: 'watched-types',
      stationIds: [],
      watchedTypeIds: [34],
      enabled: true,
      revision: 1,
      nextDueAt: now.toISOString(),
      lastFailureClass: 'response-invalid',
    },
  ])
  const response = await app.request(`/profiles/${profileId}/types/34/observation`)
  expect(await response.json()).toMatchObject({
    collectionStatus: 'profile-failed',
    observation: { observationId, observedAt: observation.observedAt },
  })
})

test('exposes a newer incomplete replacement for this market/type without replacing its book', async () => {
  persistence.readMarketReplacementStatus.mockResolvedValueOnce({
    attemptedAt: '2026-09-29T00:00:00.000Z',
  })
  const response = await app.request(`/profiles/${profileId}/types/34/observation`)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    status: 'current',
    replacement: { status: 'incomplete', attemptedAt: '2026-09-29T00:00:00.000Z' },
    observation: { observationId },
  })
  expect(persistence.readMarketReplacementStatus).toHaveBeenCalledWith({ profileId, typeId: 34 })
})

test('validates path and complete keyset cursor before persistence reads', async () => {
  expect((await app.request(`/profiles/bad/types/34/observation`)).status).toBe(400)
  expect((await app.request(`/profiles/${profileId}/types/0/observation`)).status).toBe(400)
  expect(
    (
      await app.request(
        `/profiles/${profileId}/types/34/observations/${observationId}/orders?side=sell&cursorPrice=6.42`,
      )
    ).status,
  ).toBe(400)
  expect(persistence.readMarketObservation).not.toHaveBeenCalled()
})

test('exposes bounded observed liquidity metrics with a truthful available range', async () => {
  const empty = await app.request(`/profiles/${profileId}/types/34/metrics`)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toMatchObject({ status: 'uncollected', items: [] })
  expect(empty.headers.get('Cache-Control')).toBe('no-store')
  persistence.readMarketMetrics.mockResolvedValueOnce({
    availableFrom: now.toISOString(),
    availableThrough: now.toISOString(),
    items: [
      {
        observationId,
        observedAt: now.toISOString(),
        derivationVersion: 1,
        metrics: { bestAskIsk: '6.42', bidVolume: '0', askVolume: '10' },
      },
    ],
  })
  const observed = await app.request(`/profiles/${profileId}/types/34/metrics`)
  expect(observed.status).toBe(200)
  expect(await observed.json()).toMatchObject({
    status: 'observed',
    availableFrom: now.toISOString(),
    items: [{ observationId, metrics: { bestAskIsk: '6.42' } }],
  })
  const invalid = await app.request(
    `/profiles/${profileId}/types/34/metrics?beforeObservedAt=${encodeURIComponent(now.toISOString())}`,
  )
  expect(invalid.status).toBe(400)
  expect(persistence.readMarketMetrics).toHaveBeenCalledTimes(2)
})
