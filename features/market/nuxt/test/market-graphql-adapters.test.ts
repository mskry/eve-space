import { describe, expect, it } from 'vitest'
import {
  adaptMarketOrders,
  adaptMarketHistory,
  adaptMarketBook,
  adaptMarketItem,
  adaptMarketProfiles,
  marketField,
} from '../src/runtime/app/market-graphql-adapters'
import type {
  MarketOrderPageFieldsFragment,
  MarketHistoryQuery,
} from '../src/runtime/app/market-graphql'
import { marketBookSummary } from '../src/runtime/app/market-book-summary'

const page: MarketOrderPageFieldsFragment = {
  observationId: 'observation',
  profileRevision: '1',
  hasMore: true,
  nextCursor: 'opaque',
  labelsComplete: true,
  observation: {
    observationId: 'observation',
    profileId: 'profile',
    regionId: '10000002',
    typeId: '587',
    observedAt: '2026-10-02T00:00:00Z',
    validatedAt: '2026-10-02T00:01:00Z',
    freshUntil: '2026-10-02T00:05:00Z',
    expectedPages: 1,
    totalBookOrders: '101',
  },
  rows: [
    {
      orderId: '1000000000001',
      side: 'sell',
      price: '123456789012345678.12',
      volumeRemain: '10',
      locationId: '60003760',
      solarSystemId: '30000142',
      locationName: 'Jita',
      solarSystemSecurityStatus: 0.9,
      issuedAt: '2026-10-02T00:00:00Z',
      durationDays: 90,
      expiryAt: '2026-12-31T00:00:00Z',
      minimumVolume: '1',
      range: 'station',
    },
  ],
}

describe('generated Market selection adapters', () => {
  it('retains exact prices, labels and opaque continuation before presenting numeric quantities', () => {
    const result = adaptMarketOrders(page)
    expect(result.rows[0]?.price).toBe('123456789012345678.12')
    expect(result).toMatchObject({
      kind: 'ready',
      nextCursor: 'opaque',
      rows: [{ orderId: 1000000000001, volumeRemain: 10, locationName: 'Jita' }],
    })
  })
  it('rejects unsafe identities and aggregates before table arithmetic', () => {
    for (const row of [
      { ...page.rows[0]!, orderId: '9007199254740993' },
      { ...page.rows[0]!, volumeRemain: '01' },
    ]) {
      expect(() => adaptMarketOrders({ ...page, rows: [row] })).toThrow(
        /Unsupported Market integer|supported range/,
      )
    }
    expect(() =>
      adaptMarketOrders({
        ...page,
        rows: [
          { ...page.rows[0]!, volumeRemain: '9007199254740991' },
          { ...page.rows[0]!, orderId: '1000000000002', volumeRemain: '1' },
        ],
      }),
    ).toThrow('total exceeds')
  })
  it('keeps an unavailable sibling unknown without discarding a successful alias', () => {
    const envelope = {
      data: { market: { sellers: page, buyers: null } },
      errors: [
        {
          message: 'Unavailable',
          path: ['market', 'buyers'],
          extensions: { code: 'MARKET_SIDE_UNAVAILABLE' },
        },
      ],
    }
    const sellers = adaptMarketOrders(
      marketField(envelope, ['market', 'sellers'], envelope.data.market.sellers),
    )
    expect(() => marketField(envelope, ['market', 'buyers'], envelope.data.market.buyers)).toThrow(
      'Unavailable',
    )
    expect(
      marketBookSummary(sellers, { rows: [], hasMore: false, kind: 'unavailable' }),
    ).toMatchObject({ bestBuy: null, spread: null, buyUnits: '—', sellUnits: '10+' })
  })
  it('rejects nested field failures and missing resources without poisoning sibling data', () => {
    const error = {
      message: 'No type',
      path: ['market', 'catalogueType', 'item'],
      extensions: { code: 'MARKET_TYPE_UNAVAILABLE', status: 404 },
    }
    expect(() =>
      marketField({ errors: [error] }, ['market', 'catalogueType'], { item: null }),
    ).toThrow('No type')
    expect(() =>
      marketField({ errors: [{ message: 'Rejected document' }] }, ['market', 'book'], null),
    ).toThrow('Rejected document')
    expect(() => marketField({}, ['market', 'book'], null)).toThrow('Market field is unavailable')
  })
  it('checks catalogue and profile selectors and keeps uncollected and replacement states distinct', () => {
    expect(
      adaptMarketItem({
        revision: 'catalogue-a',
        item: { id: '587', groupId: '25', name: 'Rifter' },
      }),
    ).toEqual({ revision: 'catalogue-a', item: { id: 587, groupId: 25, name: 'Rifter' } })
    const profile = {
      profileId: 'profile',
      revision: '7',
      regionId: '10000002',
      marketScope: 'region',
      mode: 'watched-types',
      stationIds: ['60003760'],
      watchedTypeIds: ['587'],
    }
    expect(adaptMarketProfiles([profile])).toMatchObject([
      { revision: 7, stationIds: [60003760], watchedTypeIds: [587] },
    ])
    expect(() => adaptMarketProfiles([{ ...profile, marketScope: 'unknown' }])).toThrow(
      'Unsupported Market state',
    )
    const book = {
      profileId: 'profile',
      profileRevision: '1',
      typeId: '587',
      status: 'uncollected',
      collectionStatus: 'ready',
      observation: null,
      replacement: { status: 'incomplete', attemptedAt: '2026-10-02T00:00:00Z' },
    }
    expect(adaptMarketBook(book)).toMatchObject({
      status: 'uncollected',
      observation: null,
      replacement: book.replacement,
    })
    expect(
      adaptMarketBook({ ...book, status: 'stale', observation: page.observation }),
    ).toMatchObject({
      status: 'stale',
      observation: {
        validatedAt: page.observation.validatedAt,
        freshUntil: page.observation.freshUntil,
        totalBookOrders: 101,
      },
      replacement: book.replacement,
    })
    expect(() => adaptMarketBook({ ...book, status: 'unknown' })).toThrow(
      'Unsupported Market state',
    )
  })
  it('rejects unsupported price precision and unsafe history totals instead of rendering rounded or omitted values', () => {
    expect(() =>
      adaptMarketOrders({ ...page, rows: [{ ...page.rows[0]!, price: '123.12345' }] }),
    ).toThrow('price precision')
    const history: NonNullable<NonNullable<MarketHistoryQuery['market']>['history']> = {
      profileId: 'profile',
      profileRevision: '1',
      regionId: '10000002',
      typeId: '587',
      status: 'observed',
      freshness: 'current',
      validatedAt: page.observation.validatedAt,
      freshUntil: page.observation.freshUntil,
      days: [
        {
          date: '2026-10-01',
          averageIsk: '1.23',
          highIsk: '2.00',
          lowIsk: '1.00',
          volume: '9007199254740991',
          orderCount: '5',
        },
        {
          date: '2026-10-02',
          averageIsk: '1.23',
          highIsk: '2.00',
          lowIsk: '1.00',
          volume: '1',
          orderCount: '5',
        },
      ],
    }
    expect(() => adaptMarketHistory(history)).toThrow('total exceeds')
    expect(() =>
      adaptMarketHistory({
        ...history,
        days: [{ ...history.days[1]!, volume: '9007199254740993' }],
      }),
    ).toThrow('supported range')
    expect(() =>
      adaptMarketHistory({
        ...history,
        days: [{ ...history.days[1]!, volume: '1', averageIsk: 'invalid' }],
      }),
    ).toThrow('history values')
  })
  it('retains independent history source clocks and rejects unknown domain states', () => {
    const history: NonNullable<NonNullable<MarketHistoryQuery['market']>['history']> = {
      profileId: 'profile',
      profileRevision: '1',
      regionId: '10000002',
      typeId: '587',
      status: 'observed',
      freshness: 'stale',
      validatedAt: '2026-10-01T00:00:00Z',
      freshUntil: '2026-10-01T00:05:00Z',
      days: [
        {
          date: '2026-10-01',
          averageIsk: '1.23',
          highIsk: '2.00',
          lowIsk: '1.00',
          volume: '100',
          orderCount: '5',
        },
      ],
    }
    expect(adaptMarketHistory(history)).toMatchObject({
      freshness: 'stale',
      validatedAt: '2026-10-01T00:00:00Z',
      days: [{ averageIsk: '1.23', volume: 100 }],
    })
    expect(() => adaptMarketHistory({ ...history, freshness: 'invented' })).toThrow(
      'Unsupported Market state',
    )
  })
})
