import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCharacterFinanceContractDetail } from '../../app/composables/useCharacterFinanceContractDetail'
import { useCharacterFinanceServices } from '../../app/composables/useCharacterFinanceServices'
import { useFinanceLedger } from '../../app/composables/useFinanceLedger'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiBase = 'http://localhost'
const characterIdValue = 7
const requests: URL[] = []
const mountedWrappers: { unmount: () => void }[] = []

type Services = ReturnType<typeof useCharacterFinanceServices>
type Ledger = ReturnType<typeof useFinanceLedger>
type Detail = ReturnType<typeof useCharacterFinanceContractDetail>

interface MountedControllers {
  authenticated: ReturnType<typeof ref<boolean>>
  authenticationReady: ReturnType<typeof ref<boolean>>
  characterId: ReturnType<typeof ref<number | undefined>>
  characters: ReturnType<typeof ref<Array<{ characterId: number }>>>
  services: Services
  ledger: Ledger
  detail: Detail
}

beforeEach(() => {
  requests.length = 0
  installFinanceHandlers()
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  document.body.replaceChildren()
})

describe('character Finance controllers', () => {
  it('waits for authentication loading to complete before issuing protected requests', async () => {
    const controllers = mountControllers({ authenticationReady: false })
    await settle()
    expect(financeRequests()).toStrictEqual([])

    controllers.authenticationReady.value = true
    await waitForRequest('/api/me/characters/7/wallet')
    await waitForRequest('/api/me/characters/7/wallet/journal')
  })

  it('requires client authentication and exact ownership before loading balance and journal', async () => {
    const controllers = mountControllers({ authenticated: false, owned: false })
    await settle()
    expect(financeRequests()).toStrictEqual([])

    controllers.authenticated.value = true
    await settle()
    expect(financeRequests()).toStrictEqual([])

    controllers.characters.value = [{ characterId: characterIdValue }]
    await waitForRequest('/api/me/characters/7/wallet')
    await waitForRequest('/api/me/characters/7/wallet/journal')

    expect(requestPaths()).toStrictEqual([
      '/api/me/characters/7/wallet',
      '/api/me/characters/7/wallet/journal?page=1',
    ])
    expect(controllers.services.journalRequested.value).toBe(true)
    expect(controllers.services.transactionsRequested.value).toBe(false)
    expect(controllers.services.openOrdersRequested.value).toBe(false)
    expect(controllers.services.orderHistoryRequested.value).toBe(false)
    expect(controllers.services.contractsRequested.value).toBe(false)
  })

  it('activates exact tab and order-mode gates and preserves page and continuation history', async () => {
    const { ledger, services } = mountControllers()
    await settle()

    ledger.selectService('transactions')
    await waitForRequest('/api/me/characters/7/wallet/transactions')
    expect(services.transactionFromId.value).toBeNull()
    expect(services.loadOlderTransactions()).toBe(true)
    await waitForRequest('/api/me/characters/7/wallet/transactions', 2)
    expect(services.transactionFromId.value).toBe(900)
    expect(services.transactionContinuations.value).toStrictEqual([null, 900])
    expect(services.showNewerTransactions()).toBe(true)
    await settle()
    expect(services.transactionFromId.value).toBeNull()

    ledger.selectService('orders')
    await waitForRequest('/api/me/characters/7/market/orders')
    expect(requestCount('/api/me/characters/7/market/orders/history')).toBe(0)
    ledger.orderFilter.value = 'Buy'
    ledger.selectOrderMode('history')
    await waitForRequest('/api/me/characters/7/market/orders/history')
    expect(ledger.orderFilter.value).toBe('All')

    expect(services.changePage('journal', 2)).toBe(true)
    await waitForRequest('/api/me/characters/7/wallet/journal', 2)
    expect(services.journalPage.value).toBe(2)
    expect(services.changePage('order-history', 2)).toBe(true)
    await waitForRequest('/api/me/characters/7/market/orders/history', 2)
    expect(services.orderHistoryPage.value).toBe(2)
    expect(services.changePage('journal', 0)).toBe(false)
    expect(services.journalPage.value).toBe(2)
    expect(requestCount('/api/me/characters/7/contracts')).toBe(0)
  })

  it('maps ledger data, keeps service-local filters, and derives summaries from one clock', async () => {
    const { ledger } = mountControllers()
    await waitForRequest('/api/me/characters/7/wallet/journal')

    expect(ledger.balance.value?.balance).toBe(1250)
    expect(ledger.journal.value?.entries).toHaveLength(2)
    expect(ledger.summary.value.netInRange).toBe(75)
    ledger.journalGroupFilter.value = 'Income'
    expect(ledger.filteredJournal.value.map((entry) => entry.journalId)).toStrictEqual([1])

    ledger.selectService('transactions')
    await waitForRequest('/api/me/characters/7/wallet/transactions')
    ledger.transactionSideFilter.value = 'Sell'
    ledger.transactionSearchQuery.value = 'tritanium'
    expect(ledger.filteredTransactions.value.map((entry) => entry.transactionId)).toStrictEqual([
      11,
    ])

    ledger.selectService('journal')
    expect(ledger.journalGroupFilter.value).toBe('Income')
    expect(ledger.transactionSideFilter.value).toBe('Sell')
    expect(ledger.currentTime.value).toBeGreaterThan(0)
  })

  it('opens only applicable details, retains origin pages, and restores focus conditionally', async () => {
    const { detail, ledger, services } = mountControllers()
    ledger.selectService('contracts')
    await waitForRequest('/api/me/characters/7/contracts')

    const courierTrigger = document.createElement('button')
    document.body.append(courierTrigger)
    courierTrigger.focus()
    expect(detail.openContractDrawer(102, courierTrigger)).toBe(true)
    await waitForRequest('/api/me/characters/7/contracts/102/items')
    expect(requestCount('/api/me/characters/7/contracts/102/bids')).toBe(0)
    expect(detail.selectedContractItemsRequested.value).toBe(true)
    expect(detail.selectedContractBidsRequested.value).toBe(false)
    expect(detail.openedItemDetails.value).toStrictEqual([{ contractId: 102, contractPage: 1 }])
    expect(
      requests
        .find((request) => request.pathname.endsWith('/contracts/102/items'))
        ?.searchParams.get('contractPage'),
    ).toBe('1')

    detail.closeContractDrawer()
    await nextTick()
    expect(document.activeElement).toBe(courierTrigger)

    const detachedTrigger = document.createElement('button')
    const focus = vi.spyOn(detachedTrigger, 'focus')
    expect(detail.openContractDrawer(103, detachedTrigger)).toBe(true)
    detail.closeContractDrawer()
    await nextTick()
    expect(focus).not.toHaveBeenCalled()
    expect(requestCount('/api/me/characters/7/contracts/103/items')).toBe(0)
    expect(requestCount('/api/me/characters/7/contracts/103/bids')).toBe(0)

    const auctionTrigger = document.createElement('button')
    document.body.append(auctionTrigger)
    const auctionFocus = vi.spyOn(auctionTrigger, 'focus')
    expect(detail.openContractDrawer(101, auctionTrigger)).toBe(true)
    await waitForRequest('/api/me/characters/7/contracts/101/items')
    await waitForRequest('/api/me/characters/7/contracts/101/bids')
    expect(detail.changeContractPage(2)).toBe(true)
    await waitForRequest('/api/me/characters/7/contracts', 2)
    expect(services.contractPage.value).toBe(2)
    expect(detail.contractDrawerOpen.value).toBe(false)
    expect(auctionFocus).not.toHaveBeenCalled()
    expect(detail.openedItemDetails.value).toContainEqual({ contractId: 101, contractPage: 1 })
    expect(detail.openedBidDetails.value).toStrictEqual([{ contractId: 101, contractPage: 1 }])
  })

  it('refreshes balance, opened services, and exposed details without activating unopened resources', async () => {
    const { detail, ledger } = mountControllers()
    ledger.selectService('contracts')
    await waitForRequest('/api/me/characters/7/contracts')
    detail.openContractDrawer(101)
    await waitForRequest('/api/me/characters/7/contracts/101/items')
    await waitForRequest('/api/me/characters/7/contracts/101/bids')
    detail.closeContractDrawer(false)
    expect(detail.contractDrawerOpen.value).toBe(false)

    const before = requestCounts()
    await detail.refreshRequestedFinance()

    expect(requestCount('/api/me/characters/7/wallet')).toBe(before.wallet + 1)
    expect(requestCount('/api/me/characters/7/wallet/journal')).toBe(before.journal + 1)
    expect(requestCount('/api/me/characters/7/contracts')).toBe(before.contracts + 1)
    expect(requestCount('/api/me/characters/7/contracts/101/items')).toBe(before.items + 1)
    expect(requestCount('/api/me/characters/7/contracts/101/bids')).toBe(before.bids + 1)
    expect(requestCount('/api/me/characters/7/wallet/transactions')).toBe(0)
    expect(requestCount('/api/me/characters/7/market/orders')).toBe(0)
    expect(requestCount('/api/me/characters/7/market/orders/history')).toBe(0)
    expect(detail.openedItemDetails.value).toStrictEqual([{ contractId: 101, contractPage: 1 }])
    expect(detail.openedBidDetails.value).toStrictEqual([{ contractId: 101, contractPage: 1 }])
  })
})

function mountControllers({
  authenticated = true,
  authenticationReady = true,
  owned = true,
} = {}): MountedControllers {
  const state = {} as MountedControllers
  const Host = defineComponent({
    setup() {
      state.authenticated = ref(authenticated)
      state.authenticationReady = ref(authenticationReady)
      state.characterId = ref(characterIdValue)
      state.characters = ref(owned ? [{ characterId: characterIdValue }] : [])
      state.services = useCharacterFinanceServices({
        apiClient: createApiClient(apiBase),
        authenticated: state.authenticated,
        authenticationReady: state.authenticationReady,
        characterId: state.characterId,
        characters: state.characters,
        isClient: true,
      })
      state.ledger = useFinanceLedger({
        services: state.services,
        summaryCopy: {
          awaitingDetail: 'contracts assigned to you · loaded page',
          awaitingLabel: 'Awaiting me',
        },
      })
      state.detail = useCharacterFinanceContractDetail({
        apiClient: createApiClient(apiBase),
        changePage: state.services.changePage,
        characterId: state.characterId,
        contractPage: state.services.contractPage,
        contracts: state.ledger.contracts,
        financeAccess: state.services.financeAccess,
        refreshRequestedServices: state.services.refreshRequestedServices,
      })
      return () => h('span')
    },
  })
  const { wrapper } = mountWithQueryPlugins(Host)
  mountedWrappers.push(wrapper)
  return state
}

async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}

async function waitForRequest(pathname: string, count = 1) {
  await vi.waitFor(() => expect(requestCount(pathname)).toBeGreaterThanOrEqual(count))
  await settle()
}

function financeRequests() {
  return requests.filter((request) => request.pathname.startsWith('/api/me/characters/7/'))
}

function requestPaths() {
  return financeRequests().map(
    (request) => `${request.pathname}${request.searchParams.size > 0 ? request.search : ''}`,
  )
}

function requestCount(pathname: string) {
  return requests.filter((request) => request.pathname === pathname).length
}

function requestCounts() {
  return {
    bids: requestCount('/api/me/characters/7/contracts/101/bids'),
    contracts: requestCount('/api/me/characters/7/contracts'),
    items: requestCount('/api/me/characters/7/contracts/101/items'),
    journal: requestCount('/api/me/characters/7/wallet/journal'),
    wallet: requestCount('/api/me/characters/7/wallet'),
  }
}

function metadata() {
  return {
    cachedUntil: '2026-09-02T13:00:00.000Z',
    stale: false,
    validatedAt: '2026-09-02T12:00:00.000Z',
  }
}

function installFinanceHandlers() {
  const record = (request: Request) => requests.push(new URL(request.url))
  queryServer.use(
    http.get(`${apiBase}/api/me/characters/:characterId/wallet`, ({ request, params }) => {
      record(request)
      return HttpResponse.json({
        balance: 1250,
        characterId: Number(params.characterId),
        ...metadata(),
      })
    }),
    http.get(`${apiBase}/api/me/characters/:characterId/wallet/journal`, ({ request, params }) => {
      record(request)
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: Number(params.characterId),
        entries:
          page === 1
            ? [
                {
                  amount: 100,
                  balance: 1250,
                  context: null,
                  date: '2026-09-01T10:00:00.000Z',
                  description: 'Mission reward',
                  journalId: 1,
                  reason: null,
                  referenceType: 'agent_mission_reward',
                  taxAmount: null,
                },
                {
                  amount: -25,
                  balance: 1225,
                  context: null,
                  date: '2026-09-01T11:00:00.000Z',
                  description: 'Market purchase',
                  journalId: 2,
                  reason: null,
                  referenceType: 'market_transaction',
                  taxAmount: null,
                },
              ]
            : [],
        page,
        totalPages: 2,
        ...metadata(),
      })
    }),
    http.get(
      `${apiBase}/api/me/characters/:characterId/wallet/transactions`,
      ({ request, params }) => {
        record(request)
        const fromIdValue = new URL(request.url).searchParams.get('fromId')
        const fromId = fromIdValue === null ? null : Number(fromIdValue)
        return HttpResponse.json({
          characterId: Number(params.characterId),
          fromId,
          nextFromId: fromId === null ? 900 : null,
          transactions: [
            {
              clientId: 90_000_001,
              date: '2026-09-01T11:00:00.000Z',
              isBuy: false,
              isPersonal: true,
              journalRefId: 20,
              locationId: 60_003_760,
              locationName: 'Jita IV - Moon 4',
              quantity: 5,
              totalPrice: 20,
              transactionId: fromId === null ? 11 : 10,
              typeId: 34,
              typeName: 'Tritanium',
              unitPrice: 4,
            },
          ],
          ...metadata(),
        })
      },
    ),
    http.get(`${apiBase}/api/me/characters/:characterId/market/orders`, ({ request, params }) => {
      record(request)
      return HttpResponse.json({
        characterId: Number(params.characterId),
        orders: [financeOrder(21)],
        ...metadata(),
      })
    }),
    http.get(
      `${apiBase}/api/me/characters/:characterId/market/orders/history`,
      ({ request, params }) => {
        record(request)
        const page = Number(new URL(request.url).searchParams.get('page'))
        return HttpResponse.json({
          characterId: Number(params.characterId),
          orders: [{ ...financeOrder(22), state: 'expired' }],
          page,
          totalPages: 2,
          ...metadata(),
        })
      },
    ),
    http.get(`${apiBase}/api/me/characters/:characterId/contracts`, ({ request, params }) => {
      record(request)
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: Number(params.characterId),
        contracts: page === 1 ? financeContracts() : [],
        page,
        totalPages: 2,
        ...metadata(),
      })
    }),
    http.get(
      `${apiBase}/api/me/characters/:characterId/contracts/:contractId/items`,
      ({ request, params }) => {
        record(request)
        return HttpResponse.json({
          characterId: Number(params.characterId),
          contractId: Number(params.contractId),
          items: [
            {
              blueprint: null,
              direction: 'included' as const,
              isSingleton: false,
              quantity: 1,
              recordId: Number(params.contractId) * 10,
              typeId: 34,
              typeName: 'Tritanium',
            },
          ],
          ...metadata(),
        })
      },
    ),
    http.get(
      `${apiBase}/api/me/characters/:characterId/contracts/:contractId/bids`,
      ({ request, params }) => {
        record(request)
        return HttpResponse.json({
          bids: [{ bidId: 1, amount: 500, bidAt: '2026-09-01T12:00:00.000Z' }],
          characterId: Number(params.characterId),
          contractId: Number(params.contractId),
          ...metadata(),
        })
      },
    ),
  )
}

function financeOrder(orderId: number) {
  return {
    durationDays: 30,
    escrow: 60,
    expiresAt: '2026-10-01T10:00:00.000Z',
    isBuy: true,
    issuedAt: '2026-09-01T10:00:00.000Z',
    locationId: 60_003_760,
    locationName: 'Jita IV - Moon 4',
    minimumVolume: null,
    orderId,
    price: 12,
    range: 'station' as const,
    regionId: 10_000_002,
    typeId: 35,
    typeName: 'Pyerite',
    volumeRemain: 5,
    volumeTotal: 10,
  }
}

function financeContracts() {
  const common = {
    acceptedAt: null,
    availability: 'personal',
    buyout: null,
    collateral: null,
    completedAt: null,
    daysToComplete: null,
    endLocationId: null,
    expiredAt: '2026-09-10T10:00:00.000Z',
    issuedAt: '2026-09-01T10:00:00.000Z',
    price: 100,
    reward: null,
    role: 'assigned' as const,
    startLocationId: null,
    status: 'outstanding',
    volume: 1,
  }
  return [
    { ...common, contractId: 101, title: 'Auction lot', type: 'auction' },
    { ...common, contractId: 102, title: 'Courier package', type: 'courier' },
    { ...common, contractId: 103, title: 'Loan terms', type: 'loan' },
  ]
}
