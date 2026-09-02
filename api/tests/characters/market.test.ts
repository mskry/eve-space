import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI quota is temporarily exhausted')
    }
  }

  return {
    EsiQuotaError,
    createMarketClient: vi.fn(),
    getCharacter: vi.fn(),
    listCharacterOrderHistory: vi.fn(),
    listCharacterOrders: vi.fn(),
    loadLocationNames: vi.fn(),
    loadTypeNames: vi.fn(),
  }
})

vi.mock('@evespace/esi-client/domains/market', () => ({
  createMarketClient: mocks.createMarketClient,
}))
vi.mock('../../src/esi-resilience/cooldowns.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.getCharacter }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))
vi.mock('../../src/characters/finance-type-names.js', () => ({
  loadFinanceTypeNames: mocks.loadTypeNames,
  financeTypeName: (typeId: number, names: ReadonlyMap<number, string>) =>
    names.get(typeId) ?? `Unknown type ${typeId}`,
}))
vi.mock('../../src/characters/finance-location-names.js', () => ({
  loadFinanceLocationNames: mocks.loadLocationNames,
  financeLocationName: (locationId: number, names: ReadonlyMap<number, string>) =>
    names.get(locationId) ?? null,
}))

const characterId = 90_000_001
const authority = { accessToken: 'access-token', principal: `character-${characterId}` }
const revalidation = {
  ifNoneMatch: 'orders-etag',
  ifModifiedSince: 'Wed, 19 Aug 2026 12:00:00 GMT',
}
const outerMetadata = {
  cachedUntil: '2026-08-20T13:00:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  mocks.createMarketClient.mockReturnValue({
    withMetadata: () => ({
      listCharacterOrders: mocks.listCharacterOrders,
      listCharacterOrderHistory: mocks.listCharacterOrderHistory,
    }),
  })
  mocks.getCharacter.mockImplementation(async (resource) => {
    const loaded = await resource.load(authority, revalidation)
    return { data: loaded.data, ...outerMetadata }
  })
  mocks.listCharacterOrders.mockResolvedValue(response([]))
  mocks.listCharacterOrderHistory.mockResolvedValue(response([], 1))
  mocks.loadTypeNames.mockResolvedValue(new Map())
  mocks.loadLocationNames.mockResolvedValue(new Map())
})

describe('character market service', () => {
  test('maps personal open orders, defaults omitted sell sides, and excludes corporation orders', async () => {
    mocks.listCharacterOrders.mockResolvedValue(
      response([
        order(10, 34, { is_buy_order: true, escrow: 12, min_volume: 5 }),
        order(11, 35),
        order(12, 36, { is_corporation: true }),
      ]),
    )
    mocks.loadTypeNames.mockResolvedValue(
      new Map([
        [35, 'Pyerite'],
        [34, 'Tritanium'],
      ]),
    )
    mocks.loadLocationNames.mockResolvedValue(
      new Map([[60_000_001, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant']]),
    )
    const { getCharacterMarketOrders, marketOrdersScope } =
      await import('../../src/characters/market.js')

    const result = await getCharacterMarketOrders(characterId)

    expect(result).toEqual({
      orders: [
        {
          orderId: 10,
          typeId: 34,
          typeName: 'Tritanium',
          isBuy: true,
          price: 7.5,
          volumeRemain: 20,
          volumeTotal: 40,
          minimumVolume: 5,
          escrow: 12,
          range: 'station',
          locationId: 60_000_001,
          locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
          regionId: 10_000_002,
          issuedAt: '2026-08-20T12:00:00Z',
          durationDays: 3,
          expiresAt: '2026-08-23T12:00:00.000Z',
        },
        expect.objectContaining({
          orderId: 11,
          typeName: 'Pyerite',
          isBuy: false,
          minimumVolume: null,
          escrow: null,
          locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        }),
      ],
      cachedUntil: outerMetadata.cachedUntil,
      validatedAt: outerMetadata.validatedAt,
      stale: false,
    })
    expect(marketOrdersScope).toBe('esi-markets.read_character_orders.v1')
    expect(mocks.loadTypeNames).toHaveBeenCalledWith([34, 35])
    expect(mocks.listCharacterOrders).toHaveBeenCalledWith(characterId, revalidation)
    expect(JSON.stringify(result)).not.toMatch(/isCorporation|corporation|"typeId":36/)
  })

  test('retains cancelled and expired history states on a sparse page', async () => {
    mocks.listCharacterOrderHistory.mockResolvedValue(
      response(
        [
          { ...order(30, 34), state: 'cancelled' },
          { ...order(31, 35, { is_corporation: true }), state: 'cancelled' },
          { ...order(32, 36), state: 'expired' },
        ],
        8,
      ),
    )
    mocks.loadTypeNames.mockResolvedValue(new Map([[36, 'Mexallon']]))
    const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

    const result = await getCharacterMarketOrderHistory(characterId, 3)

    expect(result).toMatchObject({
      orders: [
        { orderId: 30, typeName: 'Unknown type 34', state: 'cancelled' },
        { orderId: 32, typeName: 'Mexallon', state: 'expired' },
      ],
      page: 3,
      totalPages: 8,
    })
    expect(mocks.getCharacter.mock.calls[0]?.[0]).toMatchObject({
      operation: 'market-order-history',
      inputs: { characterId, page: 3 },
    })
    expect(mocks.listCharacterOrderHistory).toHaveBeenCalledWith(characterId, {
      page: 3,
      ...revalidation,
    })
    expect(mocks.loadTypeNames).toHaveBeenCalledWith([34, 36])
    expect(result.orders).toEqual([
      expect.objectContaining({ orderId: 30, expiresAt: '2026-08-23T12:00:00.000Z' }),
      expect.objectContaining({ orderId: 32, expiresAt: '2026-08-23T12:00:00.000Z' }),
    ])
  })

  test('retains history pagination and stale metadata from cache data', async () => {
    mocks.getCharacter.mockResolvedValueOnce({
      data: { orders: [], page: 4, totalPages: 9 },
      cachedUntil: '2026-08-20T11:00:00.000Z',
      validatedAt: '2026-08-20T10:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-cooldown',
    })
    const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

    await expect(getCharacterMarketOrderHistory(characterId, 4)).resolves.toEqual({
      orders: [],
      page: 4,
      totalPages: 9,
      cachedUntil: '2026-08-20T11:00:00.000Z',
      validatedAt: '2026-08-20T10:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-cooldown',
    })
    expect(mocks.listCharacterOrderHistory).not.toHaveBeenCalled()
  })

  test('maps market quota failures without invoking the SDK', async () => {
    mocks.getCharacter.mockRejectedValueOnce(new mocks.EsiQuotaError(45))
    const { getCharacterMarketOrders, MarketQuotaError } =
      await import('../../src/characters/market.js')

    await expect(getCharacterMarketOrders(characterId)).rejects.toEqual(new MarketQuotaError(45))
    expect(mocks.listCharacterOrders).not.toHaveBeenCalled()
  })

  test('rejects invalid history pages before cache access', async () => {
    const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

    await expect(getCharacterMarketOrderHistory(characterId, 0)).rejects.toThrow(
      'Market order history page must be a positive safe integer',
    )
    expect(mocks.getCharacter).not.toHaveBeenCalled()
  })

  test.each([undefined, 0])(
    'defaults missing or zero history pages to the requested page',
    async (pages) => {
      mocks.listCharacterOrderHistory.mockResolvedValue(response([], pages))
      const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

      await expect(getCharacterMarketOrderHistory(characterId, 3)).resolves.toMatchObject({
        page: 3,
        totalPages: 3,
      })
    },
  )
})

function response<Data>(data: Data, pages?: number) {
  return {
    data,
    meta: {
      status: 200,
      headers: {},
      ...(pages === undefined ? {} : { pagination: { pages } }),
    },
  }
}

function order(orderId: number, typeId: number, overrides: Record<string, unknown> = {}) {
  return { ...baseOrder(), order_id: orderId, type_id: typeId, ...overrides }
}

function baseOrder() {
  return {
    duration: 3,
    is_corporation: false,
    issued: '2026-08-20T12:00:00Z',
    location_id: 60_000_001,
    order_id: 1,
    price: 7.5,
    range: 'station' as const,
    region_id: 10_000_002,
    type_id: 34,
    volume_remain: 20,
    volume_total: 40,
  }
}
