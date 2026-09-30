import { beforeEach, expect, test, vi } from 'vitest'
import { marketQuoteRoutes } from '../src/quote-routes.js'

const profileId = '00000000-0000-4000-8000-000000000001'
const observationId = '00000000-0000-4000-8000-000000000002'
const persistence = { readMarketObservation: vi.fn(), readMarketQuoteRows: vi.fn() }
const app = marketQuoteRoutes({
  coreData: {},
  persistence,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
})
const path = `/profiles/${profileId}/types/34/quote`
const body = { observationId, side: 'buy', quantity: 5, locationIds: [60003760] }

beforeEach(() => {
  vi.clearAllMocks()
  persistence.readMarketObservation.mockResolvedValue({
    observationId,
    profileId,
    regionId: 10000002,
    typeId: 34,
    observedAt: new Date().toISOString(),
    validatedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 300_000).toISOString(),
    expectedPages: 1,
    totalBookOrders: 1,
  })
  persistence.readMarketQuoteRows.mockResolvedValue({
    rows: [
      {
        orderId: 1,
        typeId: 34,
        side: 'sell',
        price: '6.42',
        volumeRemain: 5,
        locationId: 60003760,
        solarSystemId: 30000142,
        issuedAt: new Date().toISOString(),
        durationDays: 90,
        minimumVolume: 1,
        range: 'station',
      },
    ],
    hasMore: false,
  })
})

const quote = (input: typeof body = body) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

test('quotes the complete identified observation with exact volume-weighted ISK and no cache', async () => {
  const response = await quote()
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    freshness: 'current',
    quote: {
      filledQuantity: 5,
      unfilledQuantity: 0,
      totalIsk: '32.10',
      volumeWeightedPriceIsk: '6.42',
      complete: true,
    },
  })
  expect(persistence.readMarketQuoteRows).toHaveBeenCalledWith(
    expect.objectContaining({
      locationIds: [60003760],
      side: 'sell',
      typeId: 34,
    }),
  )
})

test('refuses an invalid quantity or unavailable observation before loading depth', async () => {
  expect((await quote({ ...body, quantity: 0 })).status).toBe(400)
  expect(persistence.readMarketObservation).not.toHaveBeenCalled()
  persistence.readMarketObservation.mockResolvedValueOnce(null)
  expect((await quote()).status).toBe(404)
  expect(persistence.readMarketQuoteRows).not.toHaveBeenCalled()
})
