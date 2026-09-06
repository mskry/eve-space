import { describe, expect, it } from 'vitest'
import {
  mapCharacterFinanceBalance,
  mapCharacterFinanceContractBids,
  mapCharacterFinanceContractItems,
  mapCharacterFinanceContracts,
  mapCharacterFinanceJournal,
  mapCharacterFinanceOpenOrders,
  mapCharacterFinanceOrderHistory,
  mapCharacterFinanceResourceState,
  mapCharacterFinanceTransactions,
} from '../../app/utils/character-finance-mappers'
import { ApiQueryError } from '../../app/utils/query-error'

const freshness = {
  cachedUntil: '2026-09-02T13:00:00.000Z',
  validatedAt: '2026-09-02T12:00:00.000Z',
  stale: false,
}

describe('character Finance presentation mappings', () => {
  it('removes response identity and maps balance, journal, and transactions explicitly', () => {
    expect(mapCharacterFinanceBalance({ characterId: 7, balance: 123.45, ...freshness })).toEqual({
      balance: 123.45,
      validatedAt: freshness.validatedAt,
      stale: false,
    })

    const journal = mapCharacterFinanceJournal({
      characterId: 7,
      entries: [
        {
          journalId: 11,
          date: '2026-09-01T10:00:00.000Z',
          amount: null,
          balance: null,
          referenceType: 'contract_reward',
          description: 'Contract reward',
          reason: null,
          taxAmount: null,
          context: null,
        },
      ],
      page: 2,
      totalPages: 4,
      ...freshness,
    })
    expect(journal).toEqual({
      entries: [
        {
          journalId: 11,
          date: '2026-09-01T10:00:00.000Z',
          amount: null,
          balance: null,
          referenceType: 'contract_reward',
          description: 'Contract reward',
        },
      ],
      page: 2,
      totalPages: 4,
      validatedAt: freshness.validatedAt,
      stale: false,
    })

    const transactions = mapCharacterFinanceTransactions({
      characterId: 7,
      transactions: [
        {
          transactionId: 21,
          journalRefId: 31,
          date: '2026-09-01T11:00:00.000Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 5,
          unitPrice: 4.25,
          totalPrice: 21.25,
          isBuy: true,
          locationId: 60003760,
          locationName: null,
        },
      ],
      fromId: null,
      nextFromId: 20,
      ...freshness,
    })
    expect(transactions).toEqual({
      transactions: [
        {
          transactionId: 21,
          date: '2026-09-01T11:00:00.000Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 5,
          unitPrice: 4.25,
          totalPrice: 21.25,
          isBuy: true,
          locationId: 60003760,
          locationName: null,
        },
      ],
      fromId: null,
      nextFromId: 20,
      validatedAt: freshness.validatedAt,
      stale: false,
    })
  })

  it('normalizes open and historical orders into one presentation shape', () => {
    const order = {
      orderId: 41,
      typeId: 35,
      typeName: 'Pyerite',
      isBuy: true,
      price: 12,
      volumeRemain: 4,
      volumeTotal: 10,
      minimumVolume: null,
      escrow: null,
      range: 'station' as const,
      locationId: 60003760,
      locationName: null,
      regionId: 10000002,
      issuedAt: '2026-09-01T10:00:00.000Z',
      durationDays: 30,
      expiresAt: '2026-10-01T10:00:00.000Z',
    }

    expect(
      mapCharacterFinanceOpenOrders({ characterId: 7, orders: [order], ...freshness }).orders[0],
    ).toEqual({
      orderId: 41,
      typeId: 35,
      typeName: 'Pyerite',
      isBuy: true,
      price: 12,
      volumeRemain: 4,
      volumeTotal: 10,
      escrow: null,
      range: 'station',
      locationId: 60003760,
      locationName: null,
      issuedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-10-01T10:00:00.000Z',
      state: null,
    })
    expect(
      mapCharacterFinanceOrderHistory({
        characterId: 7,
        orders: [{ ...order, state: 'expired' }],
        page: 3,
        totalPages: 5,
        ...freshness,
      }),
    ).toMatchObject({ orders: [{ state: 'expired' }], page: 3, totalPages: 5 })
  })

  it('maps contracts and their nullable item and bid details without entity identity', () => {
    const contracts = mapCharacterFinanceContracts({
      characterId: 7,
      contracts: [
        {
          contractId: 51,
          type: 'item_exchange',
          status: 'outstanding',
          availability: 'personal',
          role: 'assigned',
          title: null,
          issuedAt: '2026-09-01T10:00:00.000Z',
          expiredAt: '2026-09-03T10:00:00.000Z',
          acceptedAt: null,
          completedAt: null,
          daysToComplete: null,
          startLocationId: null,
          endLocationId: null,
          price: null,
          reward: 500,
          collateral: null,
          buyout: null,
          volume: null,
        },
      ],
      page: 1,
      totalPages: 1,
      ...freshness,
    })
    expect(contracts.contracts[0]).toEqual({
      contractId: 51,
      type: 'item_exchange',
      status: 'outstanding',
      availability: 'personal',
      role: 'assigned',
      title: null,
      issuedAt: '2026-09-01T10:00:00.000Z',
      expiredAt: '2026-09-03T10:00:00.000Z',
      daysToComplete: null,
      price: null,
      reward: 500,
      collateral: null,
      volume: null,
    })

    expect(
      mapCharacterFinanceContractItems({
        characterId: 7,
        contractId: 51,
        items: [
          {
            recordId: 61,
            typeId: 34,
            typeName: 'Tritanium',
            direction: 'included',
            quantity: 2,
            isSingleton: false,
            blueprint: null,
          },
        ],
        ...freshness,
      }),
    ).toEqual({
      items: [
        {
          recordId: 61,
          typeId: 34,
          typeName: 'Tritanium',
          direction: 'included',
          quantity: 2,
          blueprint: null,
        },
      ],
      validatedAt: freshness.validatedAt,
      stale: false,
    })
    expect(
      mapCharacterFinanceContractBids({
        characterId: 7,
        contractId: 51,
        bids: [{ bidId: 71, amount: 900, bidAt: '2026-09-02T10:00:00.000Z' }],
        ...freshness,
      }),
    ).toEqual({
      bids: [{ bidId: 71, amount: 900, bidAt: '2026-09-02T10:00:00.000Z' }],
      validatedAt: freshness.validatedAt,
      stale: false,
    })
  })

  it('maps native, quota, and authorization failures without exposing errors or retry functions', () => {
    expect(
      mapCharacterFinanceResourceState({ data: { stale: true }, error: null, loading: true }),
    ).toEqual({
      authorizationRequired: false,
      loading: true,
      stale: true,
      errorCode: null,
      errorMessage: null,
      canRetry: false,
      authorizationAction: null,
    })
    expect(
      mapCharacterFinanceResourceState({
        data: null,
        error: new ApiQueryError('Wallet quota exhausted.', {
          status: 429,
          retryAfterSeconds: 15,
        }),
        loading: false,
      }),
    ).toMatchObject({
      errorCode: 'ESI / QUOTA',
      errorMessage: 'Wallet quota exhausted. Retry after 15 seconds.',
      canRetry: true,
    })
    expect(
      mapCharacterFinanceResourceState({
        error: new ApiQueryError('Authorize wallet.', {
          status: 403,
          code: 'EVE_SCOPE_REQUIRED',
          authorizeUrl: '/authorize',
        }),
        loading: false,
        authorizationLabel: 'AUTHORIZE WALLET',
      }),
    ).toMatchObject({
      authorizationRequired: true,
      errorMessage: 'Authorize wallet.',
      canRetry: false,
      authorizationAction: { href: '/authorize', label: 'AUTHORIZE WALLET' },
    })
    expect(
      mapCharacterFinanceResourceState({
        error: new ApiQueryError('Reauthorize wallet.', {
          status: 403,
          code: 'EVE_REAUTH_REQUIRED',
        }),
        loading: false,
      }),
    ).toMatchObject({
      authorizationAction: null,
      authorizationRequired: true,
      canRetry: false,
      errorMessage: 'Reauthorize wallet.',
    })
    expect(
      mapCharacterFinanceResourceState({ error: new Error('Failed.'), loading: false }),
    ).toMatchObject({ errorCode: 'ESI 502 / FINANCE', errorMessage: 'Failed.', canRetry: true })
    expect(
      mapCharacterFinanceResourceState({ error: new Error(''), loading: false }),
    ).toMatchObject({
      errorCode: 'ESI 502 / FINANCE',
      errorMessage: 'This Finance resource is temporarily unavailable.',
      canRetry: true,
    })
  })
})
