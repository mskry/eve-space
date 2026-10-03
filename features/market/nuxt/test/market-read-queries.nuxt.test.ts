import type { GraphQLJSONObject } from '@eve-space/platform-module-nuxt/runtime'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { useQueryCache } from '@pinia/colada'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import {
  useMarketBookQuery,
  useMarketHistoryQuery,
  useMarketItemQuery,
  useMarketProfiles,
} from '../src/runtime/app/useMarketReadQueries'
import {
  MarketBookDocument,
  MarketHistoryDocument,
  MarketItemDocument,
  MarketProfilesDocument,
  type MarketBookQuery,
  type MarketHistoryQuery,
} from '../src/runtime/app/market-graphql'
import { marketGraphQLKey } from '../src/runtime/app/market-query-options'
import { clearQueryCache } from '../../../../tests/support/clear-query-cache'

type Book = NonNullable<NonNullable<MarketBookQuery['market']>['book']>
type History = NonNullable<NonNullable<MarketHistoryQuery['market']>['history']>
type WireRequest = {
  query: string
  variables: { revision?: string; typeId?: string; profileId?: string }
}
const wrappers: { unmount: () => void }[] = []
const json = (market: GraphQLJSONObject) =>
  new Response(JSON.stringify({ data: { market } }), {
    headers: { 'Content-Type': 'application/json' },
  })
const book = (profileId = 'forge', typeId = '587', revision = '1'): Book => ({
  profileId,
  typeId,
  profileRevision: revision,
  status: 'current',
  collectionStatus: 'ready',
  replacement: null,
  observation: {
    observationId: 'observation',
    profileId,
    typeId,
    regionId: '10000002',
    expectedPages: 1,
    totalBookOrders: '10',
    observedAt: '2026-10-02T00:00:00Z',
    validatedAt: '2026-10-02T00:01:00Z',
    freshUntil: '2099-10-02T00:05:00Z',
  },
})
const history = (profileId = 'forge', typeId = '587', revision = '1'): History => ({
  profileId,
  typeId,
  profileRevision: revision,
  regionId: '10000002',
  status: 'observed',
  freshness: 'current',
  validatedAt: '2026-10-02T00:01:00Z',
  freshUntil: '2099-10-02T00:05:00Z',
  days: [
    {
      date: '2026-10-01',
      averageIsk: '6.42',
      highIsk: '7.00',
      lowIsk: '6.00',
      volume: '100',
      orderCount: '9',
    },
  ],
})
const selection = () => ({
  profileId: ref('forge'),
  profileRevision: ref(1),
  typeId: ref<number | null>(587),
  historyActive: ref(false),
})
const serve = (handler: (request: WireRequest) => Promise<Response> | Response) => {
  const original = globalThis.fetch
  const requests: WireRequest[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.endsWith('/graphql')) return original(input, init)
    // SAFETY: this intercepts the configured transport’s serialized generated documents and variables.
    const request = JSON.parse(String(init?.body)) as WireRequest
    requests.push(request)
    return Promise.resolve(handler(request))
  })
  return requests
}
const mount = async (setup: () => () => ReturnType<typeof h>) => {
  const wrapper = await mountSuspended(defineComponent({ setup }))
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => clearQueryCache())
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  clearQueryCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('shares in-flight and fresh catalogue reads and separates catalogue revisions', async () => {
  const revision = ref('a')
  const typeId = ref<number | null>(587)
  const pending = Promise.withResolvers<Response>()
  const requests = serve(({ variables }) =>
    variables.revision === 'a'
      ? pending.promise
      : json({
          catalogueType: {
            revision: variables.revision,
            item: { id: '587', groupId: '25', name: 'New catalogue' },
          },
        }),
  )
  const wrapper = await mount(() => {
    const first = useMarketItemQuery(revision, typeId)
    const second = useMarketItemQuery(revision, typeId)
    return () => h('output', [first.item.value?.name, second.item.value?.name].join('|'))
  })
  expect(requests).toHaveLength(1)
  pending.resolve(
    json({ catalogueType: { revision: 'a', item: { id: '587', groupId: '25', name: 'Rifter' } } }),
  )
  await vi.waitFor(() => expect(wrapper.text()).toBe('Rifter|Rifter'))
  const warm = await mount(() => {
    const result = useMarketItemQuery(revision, typeId)
    return () => h('output', result.item.value?.name)
  })
  expect(warm.text()).toBe('Rifter')
  expect(requests).toHaveLength(1)
  revision.value = 'b'
  await vi.waitFor(() => expect(wrapper.text()).toBe('New catalogue|New catalogue'))
  expect(requests).toHaveLength(2)
  expect(requests[0]?.query).toBe(MarketItemDocument.toString())
})

test('rejects late item completions and mismatched result selectors', async () => {
  const revision = ref('a')
  const typeId = ref<number | null>(587)
  const pending = Promise.withResolvers<Response>()
  let query!: ReturnType<typeof useMarketItemQuery>
  serve(({ variables }) =>
    variables.typeId === '587'
      ? pending.promise
      : json({
          catalogueType: { revision: 'a', item: { id: '34', groupId: '18', name: 'Tritanium' } },
        }),
  )
  const wrapper = await mount(() => {
    query = useMarketItemQuery(revision, typeId)
    return () => h('output', query.item.value?.name ?? 'Waiting')
  })
  typeId.value = 34
  await vi.waitFor(() => expect(wrapper.text()).toBe('Tritanium'))
  pending.resolve(
    json({
      catalogueType: { revision: 'a', item: { id: '587', groupId: '25', name: 'Obsolete' } },
    }),
  )
  await flushPromises()
  expect(wrapper.text()).toBe('Tritanium')
  expect(useQueryCache().getQueryData(marketGraphQLKey('MarketItem', ['a', 587]))).toBeUndefined()
  revision.value = 'wrong-revision'
  await vi.waitFor(() => expect(query.itemQuery.error.value).toBeTruthy())
  expect(wrapper.text()).toBe('Waiting')
})

test('activates only the selected tab and retains same-selection book data and clocks on a failed refresh', async () => {
  const refs = selection()
  let fail = false
  let bookQuery!: ReturnType<typeof useMarketBookQuery>
  let historyQuery!: ReturnType<typeof useMarketHistoryQuery>
  const requests = serve(({ query }) => {
    if (fail)
      return new Response(
        JSON.stringify({
          errors: [
            {
              message: 'Document rejected',
              extensions: { code: 'GRAPHQL_VALIDATION_FAILED', status: 400 },
            },
          ],
        }),
        { status: 400 },
      )
    return query === MarketBookDocument.toString()
      ? json({ book: book() })
      : json({ history: history() })
  })
  const wrapper = await mount(() => {
    bookQuery = useMarketBookQuery(refs)
    historyQuery = useMarketHistoryQuery(refs)
    return () =>
      h(
        'output',
        refs.historyActive.value
          ? historyQuery.history.value?.days[0]?.averageIsk
          : bookQuery.bookState.value?.observation?.validatedAt,
      )
  })
  await vi.waitFor(() => expect(wrapper.text()).toBe('2026-10-02T00:01:00Z'))
  expect(requests.map(({ query }) => query)).toEqual([MarketBookDocument.toString()])
  fail = true
  await bookQuery.bookQuery.refetch()
  expect(bookQuery.bookQuery.error.value).toMatchObject({
    code: 'GRAPHQL_VALIDATION_FAILED',
    status: 400,
  })
  expect(wrapper.text()).toBe('2026-10-02T00:01:00Z')
  const failedCount = requests.length
  await flushPromises()
  expect(requests).toHaveLength(failedCount)
  fail = false
  refs.historyActive.value = true
  await vi.waitFor(() => expect(wrapper.text()).toBe('6.42'))
  expect(requests.at(-1)?.query).toBe(MarketHistoryDocument.toString())
  refs.historyActive.value = false
  await nextTick()
  await flushPromises()
  expect(wrapper.text()).toBe('2026-10-02T00:01:00Z')
  expect(requests).toHaveLength(failedCount + 2)
  refs.historyActive.value = true
  await nextTick()
  refs.historyActive.value = false
  await nextTick()
  await flushPromises()
  expect(requests).toHaveLength(failedCount + 2)
})

test('fences history completions across profile revisions and profiles and keeps old success on field refresh failure', async () => {
  const refs = selection()
  refs.historyActive.value = true
  const pending = Promise.withResolvers<Response>()
  let reject = false
  let resource!: ReturnType<typeof useMarketHistoryQuery>
  const requests = serve(({ variables }) => {
    if (variables.profileId === 'forge') return pending.promise
    if (reject)
      return new Response(
        JSON.stringify({
          data: { market: { history: null } },
          errors: [
            {
              message: 'History unavailable',
              path: ['market', 'history'],
              extensions: { code: 'MARKET_HISTORY_UNAVAILABLE', status: 503 },
            },
          ],
        }),
      )
    return json({ history: history('domain', '587', String(refs.profileRevision.value)) })
  })
  const wrapper = await mount(() => {
    resource = useMarketHistoryQuery(refs)
    return () => h('output', resource.history.value?.validatedAt ?? 'Waiting')
  })
  refs.profileId.value = 'domain'
  await vi.waitFor(() => expect(wrapper.text()).toBe('2026-10-02T00:01:00Z'))
  pending.resolve(
    json({ history: { ...history(), days: [{ ...history().days[0]!, averageIsk: '6.00' }] } }),
  )
  await flushPromises()
  expect(resource.history.value?.days[0]?.averageIsk).toBe('6.42')
  expect(
    useQueryCache().getQueryData(marketGraphQLKey('MarketHistory', ['forge', 1, 587])),
  ).toBeUndefined()
  refs.profileRevision.value = 2
  await vi.waitFor(() => expect(resource.historyQuery.data.value?.selected[1]).toBe(2))
  expect(requests).toHaveLength(3)
  reject = true
  await resource.historyQuery.refetch()
  expect(resource.historyQuery.error.value).toMatchObject({ code: 'MARKET_HISTORY_UNAVAILABLE' })
  expect(resource.history.value).toMatchObject({
    validatedAt: '2026-10-02T00:01:00Z',
    days: [{ averageIsk: '6.42' }],
  })
})

test('keeps successful profile selection during refresh failures and restricts PLEX to its global profile', async () => {
  const typeId = ref<number | null>(44992)
  const requested = ref('forge')
  let fail = false
  let resource!: ReturnType<typeof useMarketProfiles>
  const requests = serve(() =>
    fail
      ? new Response('{}', { status: 503 })
      : json({
          profiles: [
            {
              profileId: 'forge',
              revision: '1',
              regionId: '10000002',
              marketScope: 'region',
              mode: 'region',
              stationIds: [],
              watchedTypeIds: [],
            },
            {
              profileId: 'plex',
              revision: '1',
              regionId: '19000001',
              marketScope: 'global-plex',
              mode: 'watched-types',
              stationIds: [],
              watchedTypeIds: ['44992'],
            },
          ],
        }),
  )
  const wrapper = await mount(() => {
    resource = useMarketProfiles(typeId, requested)
    return () => h('output', resource.profileId.value)
  })
  await vi.waitFor(() => expect(wrapper.text()).toBe('plex'))
  fail = true
  await resource.profilesQuery.refetch()
  expect(resource.profilesQuery.error.value).toBeTruthy()
  expect(wrapper.text()).toBe('plex')
  typeId.value = 587
  await nextTick()
  expect(wrapper.text()).toBe('forge')
  expect(requests).toHaveLength(2)
  expect(requests[0]?.query).toBe(MarketProfilesDocument.toString())
})

test('expires book reuse at its source boundary and caps history reuse at sixty seconds', async () => {
  const start = Date.parse('2026-10-02T12:00:00Z')
  let now = start
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const refs = selection()
  const requests = serve(({ query }) =>
    query === MarketBookDocument.toString()
      ? json({
          book: {
            ...book(),
            observation: {
              ...book().observation!,
              freshUntil: new Date(start + 2500).toISOString(),
            },
          },
        })
      : json({ history: history() }),
  )
  type SelectedResources = {
    book: ReturnType<typeof useMarketBookQuery>
    history: ReturnType<typeof useMarketHistoryQuery>
  }
  let resources!: SelectedResources
  await mount(() => {
    resources = { book: useMarketBookQuery(refs), history: useMarketHistoryQuery(refs) }
    return () => h('output', resources.book.bookState.value?.status)
  })
  await vi.waitFor(() => expect(resources.book.bookState.value).toBeTruthy())
  refs.historyActive.value = true
  await vi.waitFor(() => expect(resources.history.history.value).toBeTruthy())
  now = start + 2499
  refs.historyActive.value = false
  await nextTick()
  await flushPromises()
  expect(requests.filter(({ query }) => query === MarketBookDocument.toString())).toHaveLength(1)
  refs.historyActive.value = true
  await nextTick()
  now = start + 2501
  refs.historyActive.value = false
  await nextTick()
  await flushPromises()
  expect(requests.filter(({ query }) => query === MarketBookDocument.toString())).toHaveLength(2)
  now = start + 59_999
  refs.historyActive.value = true
  await nextTick()
  await flushPromises()
  expect(requests.filter(({ query }) => query === MarketHistoryDocument.toString())).toHaveLength(1)
  refs.historyActive.value = false
  await nextTick()
  now = start + 60_001
  refs.historyActive.value = true
  await nextTick()
  await flushPromises()
  expect(requests.filter(({ query }) => query === MarketHistoryDocument.toString())).toHaveLength(2)
})

test('keeps immutable catalogue reuse resident for five minutes then releases the detached entry', async () => {
  const revision = ref('finite-residency')
  const typeId = ref<number | null>(587)
  const requests = serve(() =>
    json({
      catalogueType: {
        revision: revision.value,
        item: { id: '587', groupId: '25', name: 'Rifter' },
      },
    }),
  )
  const wrapper = await mount(() => {
    const resource = useMarketItemQuery(revision, typeId)
    return () => h('output', resource.item.value?.name)
  })
  await vi.waitFor(() => expect(wrapper.text()).toBe('Rifter'))
  const key = marketGraphQLKey('MarketItem', [revision.value, typeId.value])
  const cache = useQueryCache()
  const entry = cache.get(key)!
  vi.useFakeTimers()
  try {
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(299_999)
    await cache.refresh(entry)
    expect(cache.getQueryData(key)).toMatchObject({ item: { name: 'Rifter' } })
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(cache.get(key)).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

test('distinguishes an explicitly missing catalogue type from a rejected operation', async () => {
  const typeId = ref<number | null>(587)
  const requests = serve(
    ({ variables }) =>
      new Response(
        JSON.stringify({
          errors: [
            variables.typeId === '587'
              ? {
                  message: 'Type unavailable',
                  path: ['market', 'catalogueType'],
                  extensions: { code: 'MARKET_TYPE_UNAVAILABLE', status: 404 },
                }
              : {
                  message: 'Document rejected',
                  extensions: { code: 'BAD_USER_INPUT' },
                },
          ],
          data: null,
        }),
        { status: variables.typeId === '587' ? 200 : 400 },
      ),
  )
  let resource!: ReturnType<typeof useMarketItemQuery>
  const wrapper = await mount(() => {
    resource = useMarketItemQuery(ref('catalogue'), typeId)
    return () => {
      if (resource.itemQuery.error.value) return h('output', 'Unavailable')
      if (resource.itemQuery.data.value?.item === null) return h('output', 'Missing')
      return h('output', 'Waiting')
    }
  })
  await vi.waitFor(() => expect(wrapper.text()).toBe('Missing'))
  expect(resource.itemQuery.error.value).toBeNull()
  typeId.value = 34
  await vi.waitFor(() => expect(wrapper.text()).toBe('Unavailable'))
  expect(resource.itemQuery.error.value).toMatchObject({ status: 400 })
  expect(requests).toHaveLength(2)
})
