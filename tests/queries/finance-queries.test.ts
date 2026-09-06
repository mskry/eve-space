import { PiniaColada, useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import { unauthenticatedSession } from '../../app/queries/auth'
import {
  canRunCharacterFinanceQuery,
  characterFinanceBalanceQuery,
  characterFinanceContractBidsQuery,
  characterFinanceContractItemsQuery,
  characterFinanceContractsQuery,
  characterFinanceJournalQuery,
  characterFinanceOpenOrdersQuery,
  characterFinanceOrderHistoryQuery,
  characterFinanceTransactionsQuery,
  type CharacterFinanceAccess,
} from '../../app/queries/finance'
import { clearAuthenticatedQueries, removeCharacterQueries } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { QUERY_POLICY } from '../../app/queries/query-policy'
import { createApiClient } from '../../app/utils/api-client'
import { coladaOptions, QUERY_GC_TIME } from '../../app/utils/colada-options'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const allowed: CharacterFinanceAccess = {
  isClient: true,
  authenticated: true,
  ownsCharacter: true,
}
const characterId = 7
const contractId = 7001
const freshness = {
  cachedUntil: '2026-09-02T12:05:00.000Z',
  validatedAt: '2026-09-02T12:00:00.000Z',
  stale: true,
  refreshFailureClass: 'esi-unavailable' as const,
}

describe('character Finance query identities and policies', () => {
  it('uses a hierarchical identity for every Finance resource boundary', () => {
    expect(PRIVATE_QUERY_KEYS.characterFinanceBalance(7)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'wallet',
      'balance',
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceJournal(7, 2)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'wallet',
      'journal',
      2,
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceTransactions(7, 501)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'wallet',
      'transactions',
      501,
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceOpenOrders(7)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'market',
      'open-orders',
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceOrderHistory(7, 3)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'market',
      'history',
      3,
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceContractPage(7, 4)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'contracts',
      'pages',
      4,
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceContractItems(7, contractId)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'contracts',
      'detail',
      contractId,
      'items',
    ])
    expect(PRIVATE_QUERY_KEYS.characterFinanceContractBids(7, contractId)).toEqual([
      'private',
      'characters',
      7,
      'finance',
      'contracts',
      'detail',
      contractId,
      'bids',
    ])
  })

  it('isolates characters, pages, continuations, contracts, and detail kinds', () => {
    expect(PRIVATE_QUERY_KEYS.characterFinanceJournal(7, 1)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterFinanceJournal(7, 2),
    )
    expect(PRIVATE_QUERY_KEYS.characterFinanceTransactions(7, null)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterFinanceTransactions(7, 501),
    )
    expect(PRIVATE_QUERY_KEYS.characterFinanceOrderHistory(7, 1)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterFinanceOrderHistory(7, 2),
    )
    expect(PRIVATE_QUERY_KEYS.characterFinanceContractPage(7, 1)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterFinanceContractPage(7, 2),
    )
    expect(PRIVATE_QUERY_KEYS.characterFinanceContractItems(7, 7001)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterFinanceContractItems(7, 7002),
    )
    expect(PRIVATE_QUERY_KEYS.characterFinanceContractItems(7, 7001)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterFinanceContractBids(7, 7001),
    )

    for (const [seven, eight] of financeKeyPairs()) expect(seven).not.toEqual(eight)
  })

  it('keeps contractPage out of detail cache identity', () => {
    const firstPage = characterFinanceContractItemsQuery({
      apiClient,
      characterId,
      access: allowed,
      requested: true,
      contractId,
      contractPage: 1,
    })
    const secondPage = characterFinanceContractItemsQuery({
      apiClient,
      characterId,
      access: allowed,
      requested: true,
      contractId,
      contractPage: 9,
    })
    const firstBidPage = characterFinanceContractBidsQuery({
      apiClient,
      characterId,
      access: allowed,
      requested: true,
      contractId,
      contractPage: 1,
    })
    const secondBidPage = characterFinanceContractBidsQuery({
      apiClient,
      characterId,
      access: allowed,
      requested: true,
      contractId,
      contractPage: 9,
    })

    expect(firstPage.key).toEqual(secondPage.key)
    expect(firstBidPage.key).toEqual(secondBidPage.key)
  })

  it('uses each ESI resource freshness window and memory garbage-collection policy', () => {
    expect(QUERY_POLICY.characterFinanceBalance).toEqual({
      staleTime: 2 * 60_000,
      gcTime: QUERY_GC_TIME,
    })
    expect(QUERY_POLICY.characterFinanceJournal.staleTime).toBe(60 * 60_000)
    expect(QUERY_POLICY.characterFinanceTransactions.staleTime).toBe(60 * 60_000)
    expect(QUERY_POLICY.characterFinanceOpenOrders.staleTime).toBe(20 * 60_000)
    expect(QUERY_POLICY.characterFinanceOrderHistory.staleTime).toBe(60 * 60_000)
    expect(QUERY_POLICY.characterFinanceContracts.staleTime).toBe(5 * 60_000)
    expect(QUERY_POLICY.characterFinanceContractItems.staleTime).toBe(60 * 60_000)
    expect(QUERY_POLICY.characterFinanceContractBids.staleTime).toBe(5 * 60_000)

    expect(
      [
        QUERY_POLICY.characterFinanceBalance,
        QUERY_POLICY.characterFinanceJournal,
        QUERY_POLICY.characterFinanceTransactions,
        QUERY_POLICY.characterFinanceOpenOrders,
        QUERY_POLICY.characterFinanceOrderHistory,
        QUERY_POLICY.characterFinanceContracts,
        QUERY_POLICY.characterFinanceContractItems,
        QUERY_POLICY.characterFinanceContractBids,
      ].every((policy) => policy.gcTime === QUERY_GC_TIME),
    ).toBe(true)
  })
})

describe('character Finance query gates', () => {
  it('requires client execution, authentication, ownership, and a valid character', () => {
    expect(canRunCharacterFinanceQuery(allowed, characterId)).toBe(true)
    expect(canRunCharacterFinanceQuery({ ...allowed, isClient: false }, characterId)).toBe(false)
    expect(canRunCharacterFinanceQuery({ ...allowed, authenticated: false }, characterId)).toBe(
      false,
    )
    expect(canRunCharacterFinanceQuery({ ...allowed, ownsCharacter: false }, characterId)).toBe(
      false,
    )
    expect(canRunCharacterFinanceQuery(allowed, 0)).toBe(false)
    expect(canRunCharacterFinanceQuery(allowed, characterId, false)).toBe(false)
  })

  it('leaves every secondary and detail query unopened until requested', () => {
    expect(characterFinanceBalanceQuery(balanceParameters()).enabled).toBe(true)
    for (const options of secondaryOptions(false)) expect(options.enabled).toBe(false)
  })

  it('does not issue client requests for unopened secondary or detail queries', async () => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch')
    const Root = defineComponent({
      setup() {
        for (const options of secondaryOptions(false)) useQuery(options)
        return () => h('span')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(fetchRequest).not.toHaveBeenCalled()
    fetchRequest.mockRestore()
    wrapper.unmount()
  })

  it('requires canonical page, continuation, and contract detail identities', () => {
    expect(characterFinanceJournalQuery({ ...pagedParameters(), page: 0 }).enabled).toBe(false)
    expect(
      characterFinanceOrderHistoryQuery({ ...pagedParameters(), page: Number.NaN }).enabled,
    ).toBe(false)
    expect(characterFinanceContractsQuery({ ...pagedParameters(), page: -1 }).enabled).toBe(false)
    expect(characterFinanceTransactionsQuery({ ...requestedParameters(), fromId: 0 }).enabled).toBe(
      false,
    )
    expect(
      characterFinanceTransactionsQuery({ ...requestedParameters(), fromId: null }).enabled,
    ).toBe(true)
    expect(
      characterFinanceContractItemsQuery({ ...detailParameters(), contractId: 0 }).enabled,
    ).toBe(false)
    expect(
      characterFinanceContractBidsQuery({ ...detailParameters(), contractPage: 0 }).enabled,
    ).toBe(false)
  })

  it('never executes any protected Finance route during SSR', async () => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch')
    const serverAccess = { ...allowed, isClient: false }
    const Root = defineComponent({
      setup() {
        useQuery(characterFinanceBalanceQuery(balanceParameters(serverAccess)))
        for (const options of secondaryOptions(true, serverAccess)) useQuery(options)
        return () => h('span', 'finance locked')
      },
    })
    const pinia = createPinia()
    const app = createSSRApp(Root)
    app.use(pinia)
    app.use(PiniaColada, coladaOptions)

    await expect(renderToString(app)).resolves.toContain('finance locked')
    expect(fetchRequest).not.toHaveBeenCalled()
    fetchRequest.mockRestore()
  })
})

describe('character Finance Hono query factories', () => {
  it('loads every route, forwards page parameters, and preserves stale metadata', async () => {
    const parameters = new Map<string, string | null>()
    installSuccessfulHandlers(parameters)
    const Root = allFinanceConsumer()
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    for (const key of financeKeys(characterId)) {
      expect(
        queryCache.getQueryData<typeof freshness & Record<string, unknown>>(key),
      ).toMatchObject(freshness)
    }
    expect(parameters).toEqual(
      new Map([
        ['journalPage', '2'],
        ['fromId', '501'],
        ['historyPage', '2'],
        ['contractPage', '2'],
        ['itemContractPage', '2'],
        ['bidContractPage', '2'],
      ]),
    )
    wrapper.unmount()
  })

  it('rejects mismatched selected-character responses for every service', async () => {
    installSuccessfulHandlers(new Map(), 8)
    const errors: unknown[] = []
    const Root = defineComponent({
      setup() {
        const results = allFinanceOptions().map((options) => useQuery({ ...options, retry: 0 }))
        return () => {
          errors.splice(0, errors.length, ...results.map((result) => result.error.value))
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(errors).toHaveLength(8)
    for (const error of errors) {
      expect(error).toBeInstanceOf(ApiQueryError)
      expect(error).toMatchObject({ status: 409, code: 'FINANCE_IDENTITY_MISMATCH' })
    }
    wrapper.unmount()
  })

  it('rejects mismatched page, continuation, and contract detail response identities', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/wallet/journal', () =>
        HttpResponse.json({
          characterId,
          entries: [],
          page: 3,
          totalPages: 4,
          ...freshness,
        }),
      ),
      http.get('http://localhost/api/me/characters/7/wallet/transactions', () =>
        HttpResponse.json({
          characterId,
          transactions: [],
          fromId: 999,
          nextFromId: null,
          ...freshness,
        }),
      ),
      http.get('http://localhost/api/me/characters/7/contracts/7001/items', () =>
        HttpResponse.json({
          characterId,
          contractId: 7002,
          items: [],
          ...freshness,
        }),
      ),
    )
    const errors: unknown[] = []
    const Root = defineComponent({
      setup() {
        const results = [
          useQuery({
            ...characterFinanceJournalQuery(pagedParameters()),
            retry: 0,
          }),
          useQuery({
            ...characterFinanceTransactionsQuery({ ...requestedParameters(), fromId: 501 }),
            retry: 0,
          }),
          useQuery({
            ...characterFinanceContractItemsQuery(detailParameters()),
            retry: 0,
          }),
        ]
        return () => {
          errors.splice(0, errors.length, ...results.map((result) => result.error.value))
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(errors).toHaveLength(3)
    for (const error of errors) {
      expect(error).toMatchObject({ status: 409, code: 'FINANCE_IDENTITY_MISMATCH' })
    }
    wrapper.unmount()
  })

  it('maps one service error without invalidating successful sibling data', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/wallet/journal', () =>
        HttpResponse.json(
          { code: 'ESI_UNAVAILABLE', message: 'Journal is unavailable.' },
          { status: 502 },
        ),
      ),
      http.get('http://localhost/api/me/characters/7/market/orders', () =>
        HttpResponse.json({ characterId, orders: [], ...freshness }),
      ),
    )
    let journalError: unknown
    let orderData: unknown
    const Root = defineComponent({
      setup() {
        const journal = useQuery({
          ...characterFinanceJournalQuery({ ...pagedParameters(), page: 2 }),
          retry: 0,
        })
        const orders = useQuery(characterFinanceOpenOrdersQuery(requestedParameters()))
        return () => {
          journalError = journal.error.value
          orderData = orders.data.value
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(journalError).toMatchObject({
      status: 502,
      code: 'ESI_UNAVAILABLE',
      message: 'Journal is unavailable.',
    })
    expect(orderData).toMatchObject({ characterId, orders: [], stale: true })
    wrapper.unmount()
  })

  it('sends contractPage for parent eligibility without adding it to detail identity', async () => {
    const requestedPages: string[] = []
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/contracts/7001/items', ({ request }) => {
        requestedPages.push(new URL(request.url).searchParams.get('contractPage') ?? '')
        return HttpResponse.json({ characterId, contractId, items: [], ...freshness })
      }),
    )
    const Root = defineComponent({
      setup() {
        useQuery(characterFinanceContractItemsQuery({ ...detailParameters(), contractPage: 9 }))
        return () => h('span')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(requestedPages).toEqual(['9'])
    expect(
      characterFinanceContractItemsQuery({ ...detailParameters(), contractPage: 9 }).key,
    ).toEqual(PRIVATE_QUERY_KEYS.characterFinanceContractItems(characterId, contractId))
    wrapper.unmount()
  })
})

describe('character Finance private cache lifecycle', () => {
  it('removes every Finance descendant for a removed character only', () => {
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    seedFinanceCache(queryCache, 7)
    seedFinanceCache(queryCache, 8)

    removeCharacterQueries(queryCache, 7)

    for (const key of financeKeys(7)) expect(queryCache.getQueryData(key)).toBeUndefined()
    for (const key of financeKeys(8)) expect(queryCache.getQueryData(key)).toBeDefined()
    wrapper.unmount()
  })

  it('clears every Finance descendant on logout', () => {
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    seedFinanceCache(queryCache, 7)
    seedFinanceCache(queryCache, 8)

    clearAuthenticatedQueries(queryCache, unauthenticatedSession)

    for (const character of [7, 8]) {
      for (const key of financeKeys(character)) expect(queryCache.getQueryData(key)).toBeUndefined()
    }
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    wrapper.unmount()
  })

  it('keeps every Finance descendant isolated when character context switches', () => {
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    seedFinanceCache(queryCache, 7)
    seedFinanceCache(queryCache, 8)

    for (const [seven, eight] of financeKeyPairs()) {
      expect(queryCache.getQueryData(seven)).toEqual({ characterId: 7 })
      expect(queryCache.getQueryData(eight)).toEqual({ characterId: 8 })
    }
    wrapper.unmount()
  })

  it('does not write Finance cache data to browser storage', () => {
    localStorage.clear()
    sessionStorage.clear()
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    seedFinanceCache(queryCache, 7)

    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)
    wrapper.unmount()
  })
})

function balanceParameters(access = allowed) {
  return { apiClient, characterId, access }
}

function requestedParameters(access = allowed) {
  return { ...balanceParameters(access), requested: true }
}

function pagedParameters(access = allowed) {
  return { ...requestedParameters(access), page: 2 }
}

function detailParameters(access = allowed) {
  return { ...requestedParameters(access), contractId, contractPage: 2 }
}

function allFinanceOptions(access = allowed) {
  return [
    characterFinanceBalanceQuery(balanceParameters(access)),
    characterFinanceJournalQuery(pagedParameters(access)),
    characterFinanceTransactionsQuery({
      ...requestedParameters(access),
      fromId: 501,
    }),
    characterFinanceOpenOrdersQuery(requestedParameters(access)),
    characterFinanceOrderHistoryQuery(pagedParameters(access)),
    characterFinanceContractsQuery(pagedParameters(access)),
    characterFinanceContractItemsQuery(detailParameters(access)),
    characterFinanceContractBidsQuery(detailParameters(access)),
  ] as const
}

function secondaryOptions(requested: boolean, access = allowed) {
  const parameters = { ...balanceParameters(access), requested }
  return [
    characterFinanceJournalQuery({ ...parameters, page: 2 }),
    characterFinanceTransactionsQuery({ ...parameters, fromId: null }),
    characterFinanceOpenOrdersQuery(parameters),
    characterFinanceOrderHistoryQuery({ ...parameters, page: 2 }),
    characterFinanceContractsQuery({ ...parameters, page: 2 }),
    characterFinanceContractItemsQuery({ ...parameters, contractId, contractPage: 2 }),
    characterFinanceContractBidsQuery({ ...parameters, contractId, contractPage: 2 }),
  ] as const
}

function allFinanceConsumer() {
  return defineComponent({
    setup() {
      for (const options of allFinanceOptions()) useQuery(options)
      return () => h('span')
    },
  })
}

function financeKeys(id: number) {
  return [
    PRIVATE_QUERY_KEYS.characterFinanceBalance(id),
    PRIVATE_QUERY_KEYS.characterFinanceJournal(id, 2),
    PRIVATE_QUERY_KEYS.characterFinanceTransactions(id, 501),
    PRIVATE_QUERY_KEYS.characterFinanceOpenOrders(id),
    PRIVATE_QUERY_KEYS.characterFinanceOrderHistory(id, 2),
    PRIVATE_QUERY_KEYS.characterFinanceContractPage(id, 2),
    PRIVATE_QUERY_KEYS.characterFinanceContractItems(id, contractId),
    PRIVATE_QUERY_KEYS.characterFinanceContractBids(id, contractId),
  ] as const
}

function financeKeyPairs() {
  return financeKeys(7).map((key, index) => [key, financeKeys(8)[index]!] as const)
}

function seedFinanceCache(
  queryCache: ReturnType<typeof mountWithQueryPlugins>['queryCache'],
  id: number,
) {
  for (const key of financeKeys(id)) {
    queryCache.ensure({ key, query: async () => ({ characterId: id }) })
    queryCache.setQueryData(key, { characterId: id })
  }
}

function installSuccessfulHandlers(
  parameters: Map<string, string | null>,
  responseCharacterId = 7,
) {
  queryServer.use(
    http.get('http://localhost/api/me/characters/7/wallet', () =>
      HttpResponse.json({ characterId: responseCharacterId, balance: 123, ...freshness }),
    ),
    http.get('http://localhost/api/me/characters/7/wallet/journal', ({ request }) => {
      parameters.set('journalPage', new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: responseCharacterId,
        entries: [],
        page: 2,
        totalPages: 4,
        ...freshness,
      })
    }),
    http.get('http://localhost/api/me/characters/7/wallet/transactions', ({ request }) => {
      parameters.set('fromId', new URL(request.url).searchParams.get('fromId'))
      return HttpResponse.json({
        characterId: responseCharacterId,
        transactions: [],
        fromId: 501,
        nextFromId: null,
        ...freshness,
      })
    }),
    http.get('http://localhost/api/me/characters/7/market/orders', () =>
      HttpResponse.json({ characterId: responseCharacterId, orders: [], ...freshness }),
    ),
    http.get('http://localhost/api/me/characters/7/market/orders/history', ({ request }) => {
      parameters.set('historyPage', new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: responseCharacterId,
        orders: [],
        page: 2,
        totalPages: 3,
        ...freshness,
      })
    }),
    http.get('http://localhost/api/me/characters/7/contracts', ({ request }) => {
      parameters.set('contractPage', new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: responseCharacterId,
        contracts: [],
        page: 2,
        totalPages: 3,
        ...freshness,
      })
    }),
    http.get('http://localhost/api/me/characters/7/contracts/7001/items', ({ request }) => {
      parameters.set('itemContractPage', new URL(request.url).searchParams.get('contractPage'))
      return HttpResponse.json({
        characterId: responseCharacterId,
        contractId,
        items: [],
        ...freshness,
      })
    }),
    http.get('http://localhost/api/me/characters/7/contracts/7001/bids', ({ request }) => {
      parameters.set('bidContractPage', new URL(request.url).searchParams.get('contractPage'))
      return HttpResponse.json({
        characterId: responseCharacterId,
        contractId,
        bids: [],
        ...freshness,
      })
    }),
  )
}
