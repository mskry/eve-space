import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useMarketOverview } from '../src/runtime/app/useMarketOverview'

type MarketFixtureValue =
  | string
  | number
  | boolean
  | null
  | MarketFixtureValue[]
  | MarketFixtureBody
interface MarketFixtureBody {
  readonly [field: string]: MarketFixtureValue
}

const json = (body: MarketFixtureBody, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

afterEach(() => vi.unstubAllGlobals())

test('renders returned history and rejects a late uncollected read without refetching', async () => {
  const profileId = '00000000-0000-4000-8000-000000000091'
  const revision = {
    buildNumber: 1,
    ingestVersion: 6,
    ingestedAt: '2026-09-30T00:00:00Z',
  }
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
    if (path.includes('/market/catalogue/body/'))
      return Promise.resolve(
        json({
          kind: 'type-by-id',
          complete: true,
          revision,
          item: { id: 34, groupId: 18, name: 'Tritanium' },
        }),
      )
    if (path === '/api/modules/market/books/profiles')
      return Promise.resolve(json({ profiles: [profile] }))
    if (path.includes('/market/history-intent/')) {
      demands += 1
      return Promise.resolve(json({ status: 'ready', history }))
    }
    if (path.includes('/market/history/')) {
      historyReads += 1
      return staleRead.promise
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
    staleRead.resolve(
      json({
        ...history,
        status: 'uncollected',
        freshness: 'uncollected',
        validatedAt: null,
        freshUntil: null,
        days: [],
      }),
    )
    await flushPromises()
    expect(wrapper.text()).toBe('6.42')
    expect(historyReads).toBe(1)
  } finally {
    wrapper.unmount()
  }
})
