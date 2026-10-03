import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useQueryCache } from '@pinia/colada'
import type { GraphQLJSONObject } from '@eve-space/platform-module-nuxt/runtime'
import { clearQueryCache } from '../../../../tests/support/clear-query-cache'
import { marketGraphQLKey } from '../src/runtime/app/market-query-options'
import type { MarketHistoryQuery } from '../src/runtime/app/market-graphql'
import type { MarketHistoryResource } from '../src/runtime/app/useMarketReadQueries'
import { useMarketOverview } from '../src/runtime/app/useMarketOverview'

const json = (body: GraphQLJSONObject, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type HistorySelection = NonNullable<NonNullable<MarketHistoryQuery['market']>['history']>
const polledHistory = (profileId: string, complete: boolean): HistorySelection => ({
  profileId,
  profileRevision: '1',
  regionId: '10000058',
  typeId: '34',
  status: complete ? 'observed' : 'uncollected',
  freshness: complete ? 'current' : 'uncollected',
  validatedAt: complete ? '2026-10-02T10:00:00.000Z' : null,
  freshUntil: complete ? '2099-01-01T00:00:00.000Z' : null,
  days: complete
    ? [
        {
          date: '2026-10-01',
          averageIsk: '6.42',
          highIsk: '7.00',
          lowIsk: '6.00',
          volume: '100',
          orderCount: '9',
        },
      ]
    : [],
})

beforeEach(() => clearQueryCache())
afterEach(() => {
  clearQueryCache()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('renders returned history and rejects a late uncollected read without refetching', async () => {
  const profileId = '00000000-0000-4000-8000-000000000091'
  const profile = {
    profileId,
    revision: 1,
    regionId: 10000058,
    marketScope: 'region',
    mode: 'region',
    watchedTypeIds: [],
    stationIds: [],
  }
  const history = {
    status: 'observed',
    freshness: 'current',
    regionId: 10000058,
    typeId: 34,
    validatedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 60_000).toISOString(),
    days: [
      {
        date: '2026-09-29',
        averageIsk: '6.42',
        highIsk: '7.00',
        lowIsk: '6.00',
        volume: 100,
        orderCount: 9,
      },
    ],
  }
  const staleRead = Promise.withResolvers<Response>()
  let historyReads = 0
  let demands = 0
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    if (path === '/graphql') {
      // SAFETY: the generated executor serializes the document into the outgoing JSON request.
      const body = JSON.parse(String(init?.body)) as { query: string }
      if (body.query.includes('query MarketItem'))
        return Promise.resolve(
          json({
            data: {
              market: {
                catalogueType: {
                  revision: 'ready-fixture',
                  item: { id: '34', groupId: '18', name: 'Tritanium' },
                },
              },
            },
          }),
        )
      if (body.query.includes('query MarketProfiles'))
        return Promise.resolve(
          json({
            data: { market: { profiles: [{ ...profile, revision: '1', regionId: '10000058' }] } },
          }),
        )
      historyReads += 1
      return staleRead.promise
    }
    if (path.includes('/market/history-intent/')) {
      demands += 1
      return Promise.resolve(json({ status: 'ready', history }))
    }
    return originalFetch(input, init)
  })
  const Host = defineComponent({
    setup() {
      const overview = useMarketOverview(ref('ready-fixture'), ref(34), ref(profileId), ref(true))
      return () => h('output', overview.history.value?.days[0]?.averageIsk ?? 'Waiting')
    },
  })
  const wrapper = await mountSuspended(Host)
  try {
    await vi.waitFor(() => expect(wrapper.text()).toBe('6.42'))
    expect(demands).toBe(1)
    expect(historyReads).toBe(1)
    const key = marketGraphQLKey('MarketHistory', [profileId, 1, 34])
    expect(useQueryCache().getQueryData<MarketHistoryResource>(key)).toEqual({
      selected: [profileId, 1, 34],
      result: history,
      provenance: 'history-demand',
    })
    staleRead.resolve(
      json({
        data: {
          market: {
            history: {
              ...history,
              profileId,
              profileRevision: '1',
              regionId: '10000058',
              typeId: '34',
              status: 'uncollected',
              freshness: 'uncollected',
              validatedAt: null,
              freshUntil: null,
              days: [],
            },
          },
        },
      }),
    )
    await flushPromises()
    expect(wrapper.text()).toBe('6.42')
    expect(historyReads).toBe(1)
  } finally {
    wrapper.unmount()
  }
})

test('polls the exact GraphQL history resource, pauses with the tab, times out, and retries the REST command', async () => {
  const profileId = '00000000-0000-4000-8000-000000000092'
  const active = ref(true)
  let complete = false
  let resource!: ReturnType<typeof useMarketOverview>
  let historyReads = 0
  let demands = 0
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    if (path === '/graphql') {
      // SAFETY: the generated executor serializes the document into the outgoing JSON request.
      const { query } = JSON.parse(String(init?.body)) as { query: string }
      if (query.includes('query MarketItem'))
        return Promise.resolve(
          json({
            data: {
              market: {
                catalogueType: {
                  revision: 'poll-fixture',
                  item: { id: '34', groupId: '18', name: 'Tritanium' },
                },
              },
            },
          }),
        )
      if (query.includes('query MarketProfiles'))
        return Promise.resolve(
          json({
            data: {
              market: {
                profiles: [
                  {
                    profileId,
                    revision: '1',
                    regionId: '10000058',
                    marketScope: 'region',
                    mode: 'region',
                    watchedTypeIds: [],
                    stationIds: [],
                  },
                ],
              },
            },
          }),
        )
      if (query.includes('query MarketBook'))
        return Promise.resolve(
          json({
            data: {
              market: {
                book: {
                  profileId,
                  profileRevision: '1',
                  typeId: '34',
                  status: 'uncollected',
                  collectionStatus: 'ready',
                  replacement: null,
                  observation: null,
                },
              },
            },
          }),
        )
      if (!query.includes('query MarketHistory')) throw new Error('Unexpected generated operation.')
      historyReads += 1
      return Promise.resolve(
        json({ data: { market: { history: polledHistory(profileId, complete) } } }),
      )
    }
    if (path.includes('/market/history-intent/')) {
      demands += 1
      return Promise.resolve(json({ status: 'accepted', phase: 'queued' }, 202))
    }
    return originalFetch(input, init)
  })
  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        resource = useMarketOverview(ref('poll-fixture'), ref(34), ref(profileId), active)
        return () =>
          h('output', resource.history.value?.days[0]?.averageIsk ?? resource.historyRequest.value)
      },
    }),
  )
  try {
    await vi.waitFor(() => expect(wrapper.text()).toBe('queued'))
    expect(historyReads).toBe(2)
    expect(demands).toBe(1)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    active.value = false
    await flushPromises()
    const pausedReads = historyReads
    await vi.advanceTimersByTimeAsync(8_000)
    expect(historyReads).toBe(pausedReads)
    active.value = true
    await flushPromises()
    expect(wrapper.text()).toBe('queued')
    expect(demands).toBe(1)
    await vi.advanceTimersByTimeAsync(92_000)
    expect(wrapper.text()).toBe('timed-out')
    const finishedReads = historyReads
    await vi.advanceTimersByTimeAsync(20_000)
    expect(historyReads).toBe(finishedReads)
    complete = true
    resource.retryHistoryRequest()
    await flushPromises()
    expect(wrapper.text()).toBe('6.42')
    expect(demands).toBe(2)
    const key = marketGraphQLKey('MarketHistory', [profileId, 1, 34])
    expect(useQueryCache().getQueryData<MarketHistoryResource>(key)).toMatchObject({
      selected: [profileId, 1, 34],
      provenance: 'graphql',
      result: {
        validatedAt: '2026-10-02T10:00:00.000Z',
        freshUntil: '2099-01-01T00:00:00.000Z',
      },
    })
    const settledReads = historyReads
    await vi.advanceTimersByTimeAsync(12_000)
    expect(historyReads).toBe(settledReads)
  } finally {
    wrapper.unmount()
  }
})
