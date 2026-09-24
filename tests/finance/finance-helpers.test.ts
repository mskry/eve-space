import { describe, expect, it } from 'vitest'
import type {
  FinanceContract,
  FinanceJournal,
  FinanceOrder,
  FinanceOrders,
  FinanceResourceState,
} from '../../app/types/finance'
import {
  buildFinanceSummaryMetrics,
  calculateFinanceSummary,
  expiresWithinFinanceUrgency,
  filterFinanceContracts,
  filterFinanceJournalEntries,
  filterFinanceOrders,
  financeContractHasItems,
  financeContractValue,
  financeJournalGroup,
  financeOrderFill,
  financeOrderStateLabel,
  financeOrderVolumeNumerator,
  formatFinanceCollectionCount,
  formatFinanceContractType,
  formatFinanceCountdown,
  formatFinanceDate,
  formatFinanceIsk,
  formatFinanceSynced,
  formatFinanceTerm,
  formatSignedFinanceIsk,
  isWithinFinanceRange,
  toFinanceEsiResourceState,
} from '../../app/utils/finance'

const now = Date.parse('2026-09-02T12:00:00.000Z')
const summaryCopy = {
  awaitingDetail: 'contracts assigned to you · loaded page',
  awaitingLabel: 'Awaiting me',
}

describe('Finance presentation helpers', () => {
  it('maps finance loading, authorization, error, and ready states', () => {
    expect(
      toFinanceEsiResourceState(
        financeResourceState({
          authorizationAction: { href: '/reauthorize', label: 'AUTHORIZE' },
          authorizationRequired: true,
          errorMessage: 'Wallet scope required.',
          loading: true,
        }),
        'Wallet',
      ),
    ).toStrictEqual({
      action: { href: '/reauthorize', label: 'AUTHORIZE' },
      code: 'ESI 403 / FINANCE',
      message: 'Wallet scope required.',
      status: 'authorization-required',
      title: 'Wallet not authorized',
    })
    expect(
      toFinanceEsiResourceState(
        financeResourceState({ errorMessage: 'Previous failure.', loading: true }),
        'Wallet Journal',
      ),
    ).toStrictEqual({
      message: 'Loading wallet journal...',
      status: 'loading',
      title: '',
    })
    expect(
      toFinanceEsiResourceState(
        financeResourceState({
          canRetry: true,
          errorCode: 'ESI 504 / JOURNAL',
          errorMessage: 'Journal timed out.',
        }),
        'Wallet Journal',
      ),
    ).toStrictEqual({
      code: 'ESI 504 / JOURNAL',
      message: 'Journal timed out.',
      retryLabel: 'RETRY',
      status: 'error',
      title: 'Wallet Journal unavailable',
    })
    expect(
      toFinanceEsiResourceState(
        financeResourceState({ errorMessage: 'Balance unavailable.' }),
        'Wallet',
      ),
    ).toStrictEqual({
      code: 'ESI 502 / FINANCE',
      message: 'Balance unavailable.',
      retryLabel: undefined,
      status: 'error',
      title: 'Wallet unavailable',
    })
    expect(toFinanceEsiResourceState(financeResourceState(), 'Wallet')).toStrictEqual({
      status: 'ready',
    })
  })

  it('preserves nullable and formatting behavior', () => {
    expect(formatFinanceIsk(1234.5)).toBe('1,234.50')
    expect(formatFinanceIsk(0, 2, 0)).toBe('0')
    expect(formatFinanceIsk(-1_050_000, 2, 0)).toBe('-1,050,000')
    expect(formatSignedFinanceIsk(12)).toBe('+12.00')
    expect(formatSignedFinanceIsk(-12)).toBe('-12.00')
    expect(formatSignedFinanceIsk(null)).toBe('UNAVAILABLE')
    expect(formatFinanceTerm(null)).toBe('—')
    expect(formatFinanceTerm(1234.5)).toBe('1,235 ISK')
    expect(financeContractValue({ price: null, reward: null })).toBe('—')
    expect(financeContractValue({ price: 0, reward: 500 })).toBe('0 ISK')
    expect(formatFinanceContractType('item_exchange')).toBe('ITEM EXCHANGE')
    expect(formatFinanceDate('2026-09-02T01:05:00.000Z')).toBe('2026.09.02 01:05')
    expect(financeOrderStateLabel({ state: null })).toBe('—')
    expect(financeOrderStateLabel({ state: 'expired' })).toBe('EXPIRED')
  })

  it('keeps deterministic sentinel, invalid dates, and exact range boundaries', () => {
    const exactlySevenDaysAgo = new Date(now - 7 * 86_400_000).toISOString()
    const beyondSevenDays = new Date(now - 7 * 86_400_000 - 1).toISOString()

    expect(isWithinFinanceRange(beyondSevenDays, '7D', 0)).toBe(true)
    expect(isWithinFinanceRange(exactlySevenDaysAgo, '7D', now)).toBe(true)
    expect(isWithinFinanceRange(beyondSevenDays, '7D', now)).toBe(false)
    expect(isWithinFinanceRange(beyondSevenDays, 'ALL', now)).toBe(true)
    expect(isWithinFinanceRange('invalid', '7D', now)).toBe(true)
  })

  it('uses strict elapsed and inclusive 48-hour expiry thresholds', () => {
    expect(expiresWithinFinanceUrgency(new Date(now + 1).toISOString(), now)).toBe(true)
    expect(expiresWithinFinanceUrgency(new Date(now + 48 * 3_600_000).toISOString(), now)).toBe(
      true,
    )
    expect(expiresWithinFinanceUrgency(new Date(now + 48 * 3_600_000 + 1).toISOString(), now)).toBe(
      false,
    )
    expect(expiresWithinFinanceUrgency(new Date(now).toISOString(), now)).toBe(false)
    expect(expiresWithinFinanceUrgency('invalid', now)).toBe(false)
    expect(expiresWithinFinanceUrgency(new Date(now + 1).toISOString(), 0)).toBe(false)

    expect(formatFinanceCountdown(new Date(now + 47 * 3_600_000).toISOString(), now)).toBe('47h')
    expect(formatFinanceCountdown(new Date(now + 49 * 3_600_000).toISOString(), now)).toBe('2d 1h')
    expect(formatFinanceCountdown(new Date(now).toISOString(), now)).toBe('ELAPSED')
    expect(formatFinanceCountdown('invalid', now)).toBe('—')
    expect(formatFinanceCountdown(new Date(now + 1).toISOString(), 0)).toBe('—')
  })

  it('groups and filters loaded journal entries without changing range identity', () => {
    const entries = [
      journalEntry(1, 'contract_reward', 20, now - 1000),
      journalEntry(2, 'market_transaction', -10, now - 1000),
      journalEntry(3, 'player_donation', null, now - 31 * 86_400_000),
    ]

    expect(financeJournalGroup('contract_reward')).toBe('Contracts')
    expect(financeJournalGroup('brokers_fee')).toBe('Market')
    expect(financeJournalGroup('player_donation')).toBe('Other')
    expect(
      filterFinanceJournalEntries(entries, '30D', 'All', now).map((entry) => entry.journalId),
    ).toStrictEqual([1, 2])
    expect(
      filterFinanceJournalEntries(entries, 'ALL', 'Expense', now).map((entry) => entry.journalId),
    ).toStrictEqual([2])
    expect(
      filterFinanceJournalEntries(entries, 'ALL', 'Contracts', now).map((entry) => entry.journalId),
    ).toStrictEqual([1])
  })

  it('preserves open-versus-history order calculations and collection labels', () => {
    const open = [order(1, { escrow: 50, isBuy: true, volumeRemain: 3, volumeTotal: 10 })]
    const history = [order(2, { issuedAt: new Date(now - 31 * 86_400_000).toISOString() })]

    expect(filterFinanceOrders(open, history, 'open', '7D', 'Escrowed', now)).toStrictEqual(open)
    expect(filterFinanceOrders(open, history, 'history', '30D', 'All', now)).toStrictEqual([])
    expect(financeOrderFill(open[0]!)).toBe(70)
    expect(financeOrderFill({ volumeRemain: 0, volumeTotal: 0 })).toBe(0)
    expect(financeOrderVolumeNumerator(open[0]!, 'open')).toBe(3)
    expect(financeOrderVolumeNumerator(open[0]!, 'history')).toBe(7)
    expect(formatFinanceCollectionCount(2, 10, 'loaded-page')).toBe('2 OF 10 on the loaded page')
    expect(formatFinanceCollectionCount(2, 10, 'loaded-range')).toBe('2 OF 10 in the loaded range')
    expect(formatFinanceCollectionCount(2, 10, 'complete-collection')).toBe(
      '2 OF 10 in the complete collection',
    )
  })

  it('preserves contract grouping and applicability', () => {
    const contracts = [
      contract(1, { role: 'assigned', status: 'outstanding', type: 'courier' }),
      contract(2, { role: 'issued', status: 'finished', type: 'auction' }),
      contract(3, { role: 'issued', status: 'in_progress', type: 'item_exchange' }),
    ]

    expect(financeContractHasItems('auction')).toBe(true)
    expect(financeContractHasItems('courier')).toBe(true)
    expect(financeContractHasItems('item_exchange')).toBe(true)
    expect(financeContractHasItems('loan')).toBe(false)
    expect(filterFinanceContracts(contracts, 'ALL', 'awaiting', now)).toStrictEqual([contracts[0]])
    expect(filterFinanceContracts(contracts, 'ALL', 'active', now)).toStrictEqual([
      contracts[0],
      contracts[2],
    ])
    expect(filterFinanceContracts(contracts, 'ALL', 'closed', now)).toStrictEqual([contracts[1]])
  })

  it('calculates and labels page-scoped and complete-collection summary metrics', () => {
    const journal: FinanceJournal = {
      entries: [
        journalEntry(1, 'mission_reward', 200, now - 1000),
        journalEntry(2, 'tax', null, now - 1000),
      ],
      page: 1,
      stale: false,
      totalPages: 3,
      validatedAt: new Date(now).toISOString(),
    }
    const openOrders: FinanceOrders = {
      orders: [order(1, { escrow: 100, expiresAt: new Date(now + 1000).toISOString() })],
      stale: false,
      validatedAt: new Date(now).toISOString(),
    }
    const contracts = {
      contracts: [
        contract(1, {
          role: 'assigned',
          status: 'outstanding',
          expiredAt: new Date(now + 48 * 3_600_000).toISOString(),
        }),
        contract(2, {
          role: 'assigned',
          status: 'outstanding',
          issuedAt: new Date(now - 31 * 86_400_000).toISOString(),
          expiredAt: new Date(now + 1000).toISOString(),
        }),
      ],
      page: 1,
      stale: false,
      totalPages: 2,
      validatedAt: new Date(now).toISOString(),
    }

    const summary = calculateFinanceSummary({ contracts, journal, now, openOrders, range: '30D' })
    expect(summary).toMatchObject({
      awaitingContractCount: 1,
      escrowOrderCount: 1,
      escrowTotal: 100,
      expiringContractCount: 1,
      expiringOrderCount: 1,
      journalEntryCount: 2,
      netInRange: 200,
    })
    expect(buildFinanceSummaryMetrics(summary, summaryCopy)).toStrictEqual([
      {
        detail: '2 journal entries · loaded page',
        id: 'net',
        label: 'Net change',
        value: '+200.00 ISK',
      },
      {
        detail: '1 buy orders · complete collection',
        id: 'escrow',
        label: 'In escrow',
        value: '100 ISK',
      },
      {
        detail: 'contracts assigned to you · loaded page',
        id: 'awaiting',
        label: 'Awaiting me',
        link: true,
        value: '1',
      },
      {
        detail: '1 orders · 1 contracts',
        id: 'expiring',
        label: 'Expiring < 48h',
        value: '2',
      },
    ])
    expect(
      buildFinanceSummaryMetrics(calculateFinanceSummary({ now, range: '30D' }), summaryCopy),
    ).toStrictEqual([])
  })

  it('formats synchronization ages from the supplied instant only', () => {
    expect(formatFinanceSynced(undefined, now)).toBe('—')
    expect(formatFinanceSynced('invalid', now)).toBe('—')
    expect(formatFinanceSynced(new Date(now - 59_999).toISOString(), now)).toBe('JUST NOW')
    expect(formatFinanceSynced(new Date(now - 59 * 60_000).toISOString(), now)).toBe('59M AGO')
    expect(formatFinanceSynced(new Date(now - 23 * 3_600_000).toISOString(), now)).toBe('23H AGO')
    expect(formatFinanceSynced(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2D AGO')
    expect(formatFinanceSynced(new Date(now).toISOString(), 0)).toBe('—')
  })
})

function financeResourceState(overrides: Partial<FinanceResourceState> = {}): FinanceResourceState {
  return {
    authorizationAction: null,
    authorizationRequired: false,
    canRetry: false,
    errorCode: null,
    errorMessage: null,
    loading: false,
    stale: false,
    ...overrides,
  }
}

function journalEntry(id: number, referenceType: string, amount: number | null, timestamp: number) {
  return {
    amount,
    balance: null,
    date: new Date(timestamp).toISOString(),
    description: `Entry ${id}`,
    journalId: id,
    referenceType,
  }
}

function order(id: number, overrides: Partial<FinanceOrder> = {}): FinanceOrder {
  return {
    escrow: null,
    expiresAt: new Date(now + 7 * 86_400_000).toISOString(),
    isBuy: false,
    issuedAt: new Date(now - 1000).toISOString(),
    locationId: 60_003_760,
    locationName: null,
    orderId: id,
    price: 5,
    range: 'station',
    state: null,
    typeId: 34,
    typeName: 'Tritanium',
    volumeRemain: 5,
    volumeTotal: 10,
    ...overrides,
  }
}

function contract(id: number, overrides: Partial<FinanceContract> = {}): FinanceContract {
  return {
    availability: 'personal',
    collateral: null,
    contractId: id,
    daysToComplete: null,
    expiredAt: new Date(now + 7 * 86_400_000).toISOString(),
    issuedAt: new Date(now - 1000).toISOString(),
    price: null,
    reward: null,
    role: 'issued',
    status: 'outstanding',
    title: null,
    type: 'item_exchange',
    volume: null,
    ...overrides,
  }
}
