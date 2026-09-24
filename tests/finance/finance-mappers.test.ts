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
  stale: false,
  validatedAt: '2026-09-02T12:00:00.000Z',
}

describe('character Finance presentation mappings', () => {
  it('removes response identity and maps balance, journal, and transactions explicitly', () => {
    expect(
      mapCharacterFinanceBalance({ balance: 123.45, characterId: 7, ...freshness }),
    ).toStrictEqual({
      balance: 123.45,
      stale: false,
      validatedAt: freshness.validatedAt,
    })

    const journal = mapCharacterFinanceJournal({
      characterId: 7,
      entries: [
        {
          amount: null,
          balance: null,
          context: null,
          date: '2026-09-01T10:00:00.000Z',
          description: 'Contract reward',
          journalId: 11,
          reason: null,
          referenceType: 'contract_reward',
          taxAmount: null,
        },
      ],
      page: 2,
      totalPages: 4,
      ...freshness,
    })
    expect(journal).toStrictEqual({
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
      stale: false,
      totalPages: 4,
      validatedAt: freshness.validatedAt,
    })

    const transactions = mapCharacterFinanceTransactions({
      characterId: 7,
      fromId: null,
      nextFromId: 20,
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
          locationId: 60_003_760,
          locationName: null,
        },
      ],
      ...freshness,
    })
    expect(transactions).toStrictEqual({
      fromId: null,
      nextFromId: 20,
      stale: false,
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
          locationId: 60_003_760,
          locationName: null,
        },
      ],
      validatedAt: freshness.validatedAt,
    })
  })

  it('normalizes open and historical orders into one presentation shape', () => {
    const order = {
      durationDays: 30,
      escrow: null,
      expiresAt: '2026-10-01T10:00:00.000Z',
      isBuy: true,
      issuedAt: '2026-09-01T10:00:00.000Z',
      locationId: 60_003_760,
      locationName: null,
      minimumVolume: null,
      orderId: 41,
      price: 12,
      range: 'station' as const,
      regionId: 10_000_002,
      typeId: 35,
      typeName: 'Pyerite',
      volumeRemain: 4,
      volumeTotal: 10,
    }

    expect(
      mapCharacterFinanceOpenOrders({ characterId: 7, orders: [order], ...freshness }).orders[0],
    ).toStrictEqual({
      escrow: null,
      expiresAt: '2026-10-01T10:00:00.000Z',
      isBuy: true,
      issuedAt: '2026-09-01T10:00:00.000Z',
      locationId: 60_003_760,
      locationName: null,
      orderId: 41,
      price: 12,
      range: 'station',
      state: null,
      typeId: 35,
      typeName: 'Pyerite',
      volumeRemain: 4,
      volumeTotal: 10,
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
          acceptedAt: null,
          availability: 'personal',
          buyout: null,
          collateral: null,
          completedAt: null,
          contractId: 51,
          daysToComplete: null,
          endLocationId: null,
          expiredAt: '2026-09-03T10:00:00.000Z',
          issuedAt: '2026-09-01T10:00:00.000Z',
          price: null,
          reward: 500,
          role: 'assigned',
          startLocationId: null,
          status: 'outstanding',
          title: null,
          type: 'item_exchange',
          volume: null,
        },
      ],
      page: 1,
      totalPages: 1,
      ...freshness,
    })
    expect(contracts.contracts[0]).toStrictEqual({
      availability: 'personal',
      collateral: null,
      contractId: 51,
      daysToComplete: null,
      expiredAt: '2026-09-03T10:00:00.000Z',
      issuedAt: '2026-09-01T10:00:00.000Z',
      price: null,
      reward: 500,
      role: 'assigned',
      status: 'outstanding',
      title: null,
      type: 'item_exchange',
      volume: null,
    })

    expect(
      mapCharacterFinanceContractItems({
        characterId: 7,
        contractId: 51,
        items: [
          {
            blueprint: null,
            direction: 'included',
            isSingleton: false,
            quantity: 2,
            recordId: 61,
            typeId: 34,
            typeName: 'Tritanium',
          },
        ],
        ...freshness,
      }),
    ).toStrictEqual({
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
      stale: false,
      validatedAt: freshness.validatedAt,
    })
    expect(
      mapCharacterFinanceContractBids({
        bids: [{ bidId: 71, amount: 900, bidAt: '2026-09-02T10:00:00.000Z' }],
        characterId: 7,
        contractId: 51,
        ...freshness,
      }),
    ).toStrictEqual({
      bids: [{ bidId: 71, amount: 900, bidAt: '2026-09-02T10:00:00.000Z' }],
      stale: false,
      validatedAt: freshness.validatedAt,
    })
  })

  it('maps native, quota, and authorization failures without exposing errors or retry functions', () => {
    expect(
      mapCharacterFinanceResourceState({ data: { stale: true }, error: null, loading: true }),
    ).toStrictEqual({
      authorizationAction: null,
      authorizationRequired: false,
      canRetry: false,
      errorCode: null,
      errorMessage: null,
      loading: true,
      stale: true,
    })
    expect(
      mapCharacterFinanceResourceState({
        data: null,
        error: new ApiQueryError('Wallet quota exhausted.', {
          retryAfterSeconds: 15,
          status: 429,
        }),
        loading: false,
      }),
    ).toMatchObject({
      canRetry: true,
      errorCode: 'ESI / QUOTA',
      errorMessage: 'Wallet quota exhausted. Retry after 15 seconds.',
    })
    expect(
      mapCharacterFinanceResourceState({
        authorizationLabel: 'AUTHORIZE WALLET',
        error: new ApiQueryError('Authorize wallet.', {
          status: 403,
          code: 'EVE_SCOPE_REQUIRED',
          authorizeUrl: '/authorize',
        }),
        loading: false,
      }),
    ).toMatchObject({
      authorizationAction: { href: '/authorize', label: 'AUTHORIZE WALLET' },
      authorizationRequired: true,
      canRetry: false,
      errorMessage: 'Authorize wallet.',
    })
    expect(
      mapCharacterFinanceResourceState({
        error: new ApiQueryError('Reauthorize wallet.', {
          code: 'EVE_REAUTH_REQUIRED',
          status: 403,
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
    ).toMatchObject({ canRetry: true, errorCode: 'ESI 502 / FINANCE', errorMessage: 'Failed.' })
    expect(
      mapCharacterFinanceResourceState({ error: new Error(''), loading: false }),
    ).toMatchObject({
      canRetry: true,
      errorCode: 'ESI 502 / FINANCE',
      errorMessage: 'This Finance resource is temporarily unavailable.',
    })
  })
})
