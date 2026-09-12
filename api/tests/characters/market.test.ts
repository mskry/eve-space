import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI quota is temporarily exhausted')
    }
  }
  return { EsiQuotaError, executeRepresentation: vi.fn() }
})

vi.mock('../../src/esi-gateway/failures.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const characterId = 90_000_001
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const freshness = {
  cachedUntil: '2026-08-20T13:00:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) =>
    Promise.resolve(
      definition.operation === 'market-order-history'
        ? result({ orders: [], page: 1, totalPages: 1 })
        : result({ orders: [] }),
    ),
  )
})

describe('character market service', () => {
  test('returns the mapped order snapshot and preserves callable metadata', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce(
      result({
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
            locationName: 'Jita IV - Moon 4',
            regionId: 10_000_002,
            issuedAt: '2026-08-20T12:00:00Z',
            durationDays: 3,
            expiresAt: '2026-08-23T12:00:00.000Z',
          },
        ],
      }),
    )
    const { getCharacterMarketOrders, marketOrdersScope } =
      await import('../../src/characters/market.js')

    await expect(getCharacterMarketOrders(characterId, subjectLifecycleId)).resolves.toMatchObject({
      orders: [{ orderId: 10, typeName: 'Tritanium', isBuy: true }],
      cachedUntil: freshness.cachedUntil,
    })
    expect(marketOrdersScope).toBe('esi-markets.read_character_orders.v1')
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'market-orders' }),
      { characterId, subjectLifecycleId },
      { subjectLifecycleId },
    )
  })

  test('returns mapped history and preserves the requested page input', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce(
      result({
        orders: [{ orderId: 30, typeId: 34, typeName: 'Tritanium', state: 'cancelled' }],
        page: 3,
        totalPages: 8,
      }),
    )
    const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

    await expect(
      getCharacterMarketOrderHistory(characterId, 3, subjectLifecycleId),
    ).resolves.toMatchObject({
      orders: [{ orderId: 30, state: 'cancelled' }],
      page: 3,
      totalPages: 8,
    })
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'market-order-history' }),
      { characterId, page: 3, subjectLifecycleId },
      { subjectLifecycleId },
    )
  })

  test('preserves cached stale metadata without executing a second callable', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce({
      ...result({ orders: [], page: 4, totalPages: 9 }),
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-cooldown',
    })
    const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

    await expect(
      getCharacterMarketOrderHistory(characterId, 4, subjectLifecycleId),
    ).resolves.toMatchObject({
      page: 4,
      totalPages: 9,
      stale: true,
      refreshFailureClass: 'esi-cooldown',
    })
  })

  test('maps callable quota failures', async () => {
    mocks.executeRepresentation.mockRejectedValueOnce(new mocks.EsiQuotaError(45))
    const { getCharacterMarketOrders, MarketQuotaError } =
      await import('../../src/characters/market.js')

    await expect(getCharacterMarketOrders(characterId, subjectLifecycleId)).rejects.toEqual(
      new MarketQuotaError(45),
    )
  })

  test('rejects invalid history pages before invoking the callable', async () => {
    const { getCharacterMarketOrderHistory } = await import('../../src/characters/market.js')

    await expect(
      getCharacterMarketOrderHistory(characterId, 0, subjectLifecycleId),
    ).rejects.toThrow('Market order history page must be a positive safe integer')
    expect(mocks.executeRepresentation).not.toHaveBeenCalled()
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
