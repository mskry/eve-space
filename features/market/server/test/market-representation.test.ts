import { expect, test } from 'vitest'
import {
  mapActiveMarketTypes,
  mapMarketDailyRecord,
  mapPublicMarketOrder,
  mapReferencePrice,
  mapStructureMarketOrder,
  referencePricesRequest,
  regionHistoryRequest,
  regionOrderRequest,
  regionTypesRequest,
  structureOrdersRequest,
} from '../src/market-representation.js'

test('canonicalizes bounded region order requests without ambiguous page-one identities', () => {
  expect(regionOrderRequest(10000002, 1, 34)).toStrictEqual({
    regionId: 10000002,
    page: 1,
    orderType: 'all',
    typeId: 34,
  })
  expect(() => regionOrderRequest(11000001, 1)).toThrow('Unsupported')
  expect(() => regionOrderRequest(10000002, 513)).toThrow('bound')
  expect(regionTypesRequest(10000002, 1)).toStrictEqual({ regionId: 10000002, page: 1 })
  expect(regionHistoryRequest(10000002, 34)).toStrictEqual({ regionId: 10000002, typeId: 34 })
  expect(regionOrderRequest(19000001, 1, 44992)).toStrictEqual({
    regionId: 19000001,
    page: 1,
    orderType: 'all',
    typeId: 44992,
  })
  expect(regionHistoryRequest(19000001, 44992)).toStrictEqual({ regionId: 19000001, typeId: 44992 })
  expect(() => regionOrderRequest(19000001, 1, 34)).toThrow('only PLEX')
  expect(() => regionOrderRequest(19000001, 1)).toThrow('only PLEX')
  expect(() => regionHistoryRequest(19000001, 34)).toThrow('only PLEX')
  expect(structureOrdersRequest(1020000000000, 1)).toStrictEqual({
    structureId: 1020000000000,
    page: 1,
  })
  expect(referencePricesRequest()).toStrictEqual({})
  expect(mapActiveMarketTypes([35, 34, 35])).toStrictEqual([34, 35])
})

test('keeps structure orders private and reference prices non-executable', () => {
  expect(
    mapStructureMarketOrder({
      order_id: 42,
      type_id: 34,
      location_id: 1020000000000,
      is_buy_order: false,
      price: 6.42,
      volume_remain: 123,
      issued: '2026-09-28T12:00:00Z',
      duration: 90,
      min_volume: 1,
      range: 'station',
    }),
  ).toMatchObject({ locationId: 1020000000000, solarSystemId: null })
  expect(mapReferencePrice({ type_id: 34, adjusted_price: 6.42 })).toStrictEqual({
    typeId: 34,
    adjustedPriceIsk: '6.42',
    averagePriceIsk: null,
  })
})

test('maps only intentional public order identity, exact price, and buy constraints', () => {
  const wire = {
    order_id: 42,
    type_id: 34,
    location_id: 60003760,
    system_id: 30000142,
    is_buy_order: true,
    price: 6.42,
    volume_remain: 123,
    issued: '2026-09-28T12:00:00Z',
    duration: 365,
    min_volume: 5,
    range: 'station',
  }
  expect(mapPublicMarketOrder(wire)).toStrictEqual({
    orderId: 42,
    typeId: 34,
    locationId: 60003760,
    solarSystemId: 30000142,
    side: 'buy',
    price: '6.42',
    volumeRemain: 123,
    issuedAt: '2026-09-28T12:00:00.000Z',
    durationDays: 365,
    minimumVolume: 5,
    range: 'station',
  })
  expect(() => mapPublicMarketOrder({ ...wire, duration: 366 })).toThrow('Invalid Market duration')
})

test('labels historical average correctly and rejects fabricated precision or incoherent range', () => {
  expect(
    mapMarketDailyRecord({
      date: '2026-09-27',
      average: 6.42,
      highest: 7,
      lowest: 6,
      volume: 1000,
      order_count: 8,
    }),
  ).toMatchObject({ date: '2026-09-27', averageIsk: '6.42', highIsk: '7.00' })
  expect(() =>
    mapMarketDailyRecord({
      date: '2026-09-27',
      average: 6.421,
      highest: 7,
      lowest: 6,
      volume: 1000,
      order_count: 8,
    }),
  ).toThrow('more than two')
  expect(() =>
    mapMarketDailyRecord({
      date: '2026-02-30',
      average: 6.42,
      highest: 7,
      lowest: 6,
      volume: 1000,
      order_count: 8,
    }),
  ).toThrow('Invalid Market history date')
})
