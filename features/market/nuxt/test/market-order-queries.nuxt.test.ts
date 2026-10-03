import type { GraphQLJSONObject } from '@eve-space/platform-module-nuxt/runtime'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { useQueryCache } from '@pinia/colada'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed, defineComponent, h, ref, type Ref } from 'vue'
import MarketOrderTables from '../src/runtime/app/components/MarketOrderTables.vue'
import MarketBookSummary from '../src/runtime/app/components/MarketBookSummary.vue'
import { useMarketOrderBook } from '../src/runtime/app/useMarketOrderBook'
import { useMarketOrderPaging } from '../src/runtime/app/useMarketOrderPaging'
import { useMarketInitialOrders } from '../src/runtime/app/useMarketInitialOrders'
import { useMarketOverview } from '../src/runtime/app/useMarketOverview'
import {
  MarketBookDocument,
  MarketInitialOrdersDocument,
  MarketOrderContinuationDocument,
  MarketProfilesDocument,
  MarketItemDocument,
  type MarketOrderPageFieldsFragment,
} from '../src/runtime/app/market-graphql'
import { adaptMarketOrders } from '../src/runtime/app/market-graphql-adapters'
import { marketGraphQLKey } from '../src/runtime/app/market-query-options'
import type { MarketObservedBook } from '../src/runtime/app/market-models'
import { clearQueryCache } from '../../../../tests/support/clear-query-cache'

type WireRequest = {
  query: string
  variables: {
    profileId: string
    typeId: string
    observationId: string
    side: 'buy' | 'sell'
    after: string
  }
}
const wrappers: { unmount: () => void }[] = []
const selection = () => ({
  profileId: ref('forge'),
  profileRevision: ref(1),
  typeId: ref<number | null>(587),
  historyActive: ref(false),
})
const observation = (id = 'complete', profileId = 'forge', typeId = '587') => ({
  observationId: id,
  profileId,
  typeId,
  regionId: '10000002',
  expectedPages: 1,
  totalBookOrders: '203',
  observedAt: '2026-10-03T00:00:00Z',
  validatedAt: '2026-10-03T00:01:00Z',
  freshUntil: '2099-10-03T00:05:00Z',
})
const discoveredBook = () => ({
  status: 'current',
  collectionStatus: 'ready',
  replacement: null,
  profileId: 'forge',
  profileRevision: '1',
  typeId: '587',
  observation: observation(),
})
const page = (
  side: 'buy' | 'sell',
  start = 1,
  count = 100,
  nextCursor: string | null = 'opaque+/=first',
): MarketOrderPageFieldsFragment => ({
  observationId: 'complete',
  observation: observation(),
  profileRevision: '1',
  labelsComplete: true,
  hasMore: nextCursor !== null,
  nextCursor,
  rows: Array.from({ length: count }, (_, index) => ({
    orderId: String(start + index),
    side,
    price: `${start + index}.00`,
    volumeRemain: '10',
    minimumVolume: '1',
    locationId: '60003760',
    solarSystemId: '30000142',
    solarSystemSecurityStatus: 0.9,
    locationName: `Location ${start + index}`,
    issuedAt: '2026-10-03T00:00:00Z',
    durationDays: 90,
    expiryAt: '2027-01-01T00:00:00Z',
    range: 'station',
  })),
})
const observedBook = (): MarketObservedBook => ({
  status: 'current',
  collectionStatus: 'ready',
  replacement: null,
  profileRevision: 1,
  observation: { ...observation(), typeId: 587, regionId: 10000002, totalBookOrders: 203 },
  sellers: adaptMarketOrders(page('sell')),
  buyers: adaptMarketOrders(page('buy', 500, 1, null)),
})
const json = (market: GraphQLJSONObject, errors: GraphQLJSONObject[] = []) =>
  new Response(JSON.stringify({ data: { market }, errors }), {
    headers: { 'Content-Type': 'application/json' },
  })
const fail = (code: string, alias = 'orders') =>
  json({ [alias]: null }, [
    { message: 'Unavailable', path: ['market', alias], extensions: { code, status: 404 } },
  ])
const serve = (
  handler: (request: WireRequest, signal?: AbortSignal | null) => Promise<Response> | Response,
) => {
  const original = globalThis.fetch
  const requests: WireRequest[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.endsWith('/api/graphql')) return original(input, init)
    // SAFETY: the configured transport serializes generated Market documents and variables intercepted here.
    const request = JSON.parse(String(init?.body)) as WireRequest
    requests.push(request)
    return Promise.resolve(handler(request, init?.signal))
  })
  return requests
}
const mount = async (component: Parameters<typeof mountSuspended>[0]) => {
  const wrapper = await mountSuspended(component)
  wrappers.push(wrapper)
  return wrapper
}
const rows = (wrapper: Awaited<ReturnType<typeof mount>>, side = 'Sellers') =>
  wrapper.get(`section[aria-label="${side}"]`).findAll('.market-order-table__row')
const button = (wrapper: Awaited<ReturnType<typeof mount>>, label: string) =>
  wrapper
    .get('section[aria-label="Sellers"]')
    .findAll('button')
    .find((item) => item.text() === label)!

const mountPaging = async (source: Ref<MarketObservedBook>, side = ref<'sell' | 'buy'>('sell')) => {
  let paging!: ReturnType<typeof useMarketOrderPaging>
  const wrapper = await mount(
    defineComponent({
      setup() {
        paging = useMarketOrderPaging(source, side)
        return () => h('output', String(paging.page.value.index))
      },
    }),
  )
  return { wrapper, paging }
}

beforeEach(clearQueryCache)
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  clearQueryCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('discovers a complete observation before a shared generated alias read and keeps its successful sibling truthful', async () => {
  const refs = selection()
  const pending = Promise.withResolvers<Response>()
  let discovering = true
  let failure = true
  let reject = false
  let resource!: ReturnType<typeof useMarketOrderBook>
  const requests = serve(({ query }) => {
    if (query === MarketBookDocument.toString())
      return discovering ? pending.promise : json({ book: discoveredBook() })
    if (reject)
      return new Response(
        JSON.stringify({
          errors: [{ message: 'Rejected operation', extensions: { code: 'BAD_USER_INPUT' } }],
        }),
        { status: 400 },
      )
    if (failure)
      return json({ sellers: page('sell', 1, 2, null), buyers: null }, [
        {
          message: 'Buy unavailable',
          path: ['market', 'buyers'],
          extensions: { code: 'MARKET_SIDE_UNAVAILABLE' },
        },
      ])
    return json({ sellers: page('sell', 1, 2, null), buyers: page('buy', 5, 1, null) })
  })
  const wrapper = await mount(
    defineComponent({
      setup() {
        resource = useMarketOrderBook(refs)
        const second = useMarketOrderBook(refs)
        return () =>
          h('div', [
            resource.book.value?.status !== 'uncollected' && resource.book.value
              ? h(MarketOrderTables, { book: resource.book.value })
              : null,
            second.book.value?.status !== 'uncollected' && second.book.value
              ? h(MarketBookSummary, { book: second.book.value })
              : null,
          ])
      },
    }),
  )
  expect(requests.map((request) => request.query)).toEqual([MarketBookDocument.toString()])
  discovering = false
  pending.resolve(json({ book: discoveredBook() }))
  await vi.waitFor(() => expect(wrapper.text()).toContain('Buyers are unavailable'))
  expect(rows(wrapper)).toHaveLength(2)
  expect(wrapper.findAll('.market-book-summary__pair:first-child dd')[1]?.text()).toContain('—')
  expect(
    requests.filter((request) => request.query === MarketInitialOrdersDocument.toString()),
  ).toHaveLength(1)
  failure = false
  await resource.restart()
  expect(rows(wrapper, 'Buyers')).toHaveLength(1)
  failure = true
  await resource.restart()
  expect(rows(wrapper, 'Buyers')).toHaveLength(1)
  expect(resource.book.value).toMatchObject({
    buyers: { error: 'MARKET_SIDE_UNAVAILABLE' },
    observation: { validatedAt: observation().validatedAt },
  })
  reject = true
  await resource.restart()
  expect(resource.presentation.value).toMatchObject({ unavailable: true, retained: true })
  expect(rows(wrapper)).toHaveLength(2)
  expect(resource.book.value).toMatchObject({
    observation: { validatedAt: observation().validatedAt },
  })
})

test('keeps pending initial orders loading across a focus refresh of the same observation', async () => {
  const refs = selection()
  const pending = Promise.withResolvers<Response>()
  let resource!: ReturnType<typeof useMarketOrderBook>
  let bookReads = 0
  let orderSignal: AbortSignal | null | undefined
  const requests = serve(({ query }, signal) => {
    if (query === MarketBookDocument.toString()) {
      bookReads += 1
      const book = discoveredBook()
      return json({
        book: {
          ...book,
          observation: { ...book.observation, validatedAt: `2026-10-03T00:0${bookReads}:00Z` },
        },
      })
    }
    orderSignal = signal
    return pending.promise
  })
  const wrapper = await mount(
    defineComponent({
      setup() {
        resource = useMarketOrderBook(refs)
        return () =>
          resource.book.value && resource.book.value.status !== 'uncollected'
            ? h(MarketOrderTables, { book: resource.book.value })
            : h('output', resource.presentation.value.loading ? 'Loading orders' : '')
      },
    }),
  )
  await vi.waitFor(() => expect(orderSignal).toBeDefined())
  expect(wrapper.text()).toContain('Loading orders')
  await useQueryCache().invalidateQueries(
    { key: marketGraphQLKey('MarketBook', ['forge', 1, 587]), exact: true },
    false,
  )
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.waitFor(() => expect(bookReads).toBe(2))
  await flushPromises()
  expect(orderSignal?.aborted).toBe(false)
  expect(resource.presentation.value).toMatchObject({ loading: true, unavailable: false })
  expect(wrapper.text()).toContain('Loading orders')
  pending.resolve(json({ sellers: page('sell', 1, 2, null), buyers: page('buy', 5, 1, null) }))
  await vi.waitFor(() => expect(rows(wrapper)).toHaveLength(2))
  expect(rows(wrapper, 'Buyers')).toHaveLength(1)
  expect(resource.book.value).toMatchObject({
    observation: { validatedAt: '2026-10-03T00:02:00Z' },
  })
  expect(resource.presentation.value).toMatchObject({ loading: false, unavailable: false })
  expect(
    requests.filter((request) => request.query === MarketInitialOrdersDocument.toString()),
  ).toHaveLength(1)
})

test('does not retain initial rows from an unavailable observation or relabel a delayed selection', async () => {
  const refs = selection()
  const state = ref({
    status: 'current' as const,
    collectionStatus: 'ready' as const,
    replacement: null,
    profileId: 'forge',
    profileRevision: 1,
    typeId: 587,
    observation: observedBook().observation,
  })
  let expired = false
  const pending = Promise.withResolvers<Response>()
  let resource!: ReturnType<typeof useMarketInitialOrders>
  serve(({ variables }) => {
    if (variables.typeId === '34') return pending.promise
    if (expired)
      return json(
        { sellers: null, buyers: null },
        ['sellers', 'buyers'].map((alias) => ({
          message: 'Unavailable',
          path: ['market', alias],
          extensions: { code: 'MARKET_OBSERVATION_UNAVAILABLE' },
        })),
      )
    return json({ sellers: page('sell', 1, 2, null), buyers: page('buy', 5, 1, null) })
  })
  await mount(
    defineComponent({
      setup() {
        resource = useMarketInitialOrders(refs, state)
        return () => h('output', resource.book.value?.status)
      },
    }),
  )
  await vi.waitFor(() => expect(resource.book.value).toMatchObject({ sellers: { kind: 'ready' } }))
  expired = true
  await resource.initialOrdersQuery.refetch()
  expect(resource.book.value).toMatchObject({
    sellers: { kind: 'unavailable', rows: [] },
    buyers: { kind: 'unavailable', rows: [] },
  })
  refs.typeId.value = 34
  state.value = {
    ...state.value,
    typeId: 34,
    observation: { ...state.value.observation, typeId: 34 },
  }
  await vi.waitFor(() => expect(resource.initialOrdersQuery.asyncStatus.value).toBe('loading'))
  refs.typeId.value = 587
  state.value = {
    ...state.value,
    typeId: 587,
    observation: { ...state.value.observation, typeId: 587 },
  }
  pending.resolve(
    json({
      sellers: { ...page('sell'), observation: observation('complete', 'forge', '34') },
      buyers: null,
    }),
  )
  await flushPromises()
  expect(
    useQueryCache().getQueryData(
      marketGraphQLKey('MarketInitialOrders', ['forge', 1, 34, 'complete', 100]),
    ),
  ).toBeUndefined()
})

test('uses opaque side pages with fresh backward reuse, local sorting, explicit retry and bounded visible rows', async () => {
  let failing = false
  const requests = serve(({ variables }) => {
    if (failing) return new Response('{}', { status: 503 })
    return variables.after === 'opaque+/=first'
      ? json({ orders: page('sell', 101, 100, 'opaque: second with spaces') })
      : json({ orders: page('sell', 201, 3, null) })
  })
  const wrapper = await mount(
    defineComponent({ setup: () => () => h(MarketOrderTables, { book: observedBook() }) }),
  )
  await button(wrapper, 'Next orders').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Showing 101–200 sellers orders.'))
  expect(rows(wrapper)).toHaveLength(100)
  expect(requests[0]).toMatchObject({
    query: MarketOrderContinuationDocument.toString(),
    variables: { side: 'sell', after: 'opaque+/=first', observationId: 'complete' },
  })
  await wrapper.get('button[aria-label="Sort visible Sellers orders by Price"]').trigger('click')
  expect(rows(wrapper)[0]?.text()).toContain('200.00')
  failing = true
  await button(wrapper, 'Next orders').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Retry loading orders'))
  expect(rows(wrapper)).toHaveLength(100)
  expect(rows(wrapper)[0]?.text()).toContain('200.00')
  const attempts = requests.length
  await flushPromises()
  expect(requests).toHaveLength(attempts)
  failing = false
  await button(wrapper, 'Retry loading orders').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Showing 201–203 sellers orders.'))
  expect(rows(wrapper)).toHaveLength(3)
  expect(requests.at(-1)?.variables.after).toBe('opaque: second with spaces')
  await button(wrapper, 'Previous orders').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Showing 101–200 sellers orders.'))
  expect(requests).toHaveLength(attempts + 1)
  await button(wrapper, 'Previous orders').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Showing 1–100 sellers orders.'))
  expect(requests).toHaveLength(attempts + 1)
})

test.each(['type', 'profile', 'revision', 'observation', 'side', 'unmount'] as const)(
  'cancels a pending continuation on %s changes and refuses its obsolete cache release through the paging interface',
  async (change) => {
    const source = ref(observedBook())
    const side = ref<'sell' | 'buy'>('sell')
    const pending = Promise.withResolvers<Response>()
    let signal: AbortSignal | null | undefined
    serve((_request, captured) => {
      signal = captured
      return pending.promise
    })
    const { wrapper, paging } = await mountPaging(source, side)
    const loading = paging.next()
    await vi.waitFor(() => expect(signal).toBeTruthy())
    const updates = {
      type: { typeId: 34 },
      profile: { profileId: 'domain' },
      revision: {},
      observation: { observationId: 'replacement' },
      side: {},
      unmount: {},
    }
    if (change === 'unmount') wrapper.unmount()
    else if (change === 'side') side.value = 'buy'
    else
      source.value = {
        ...source.value,
        profileRevision: change === 'revision' ? 2 : 1,
        observation: { ...source.value.observation, ...updates[change] },
        sellers: adaptMarketOrders(page('sell', 700, 2, null)),
      }
    const expectedRows = change === 'side' ? source.value.buyers.rows : source.value.sellers.rows
    expect(paging.page.value.rows).toEqual(expectedRows)
    expect(signal?.aborted).toBe(true)
    pending.resolve(json({ orders: page('sell', 101, 100, null) }))
    await loading
    await flushPromises()
    expect(paging.page.value.rows).toEqual(expectedRows)
    expect(paging.page.value.index).toBe(0)
    expect(
      useQueryCache().getQueryData(
        marketGraphQLKey('MarketOrderContinuation', [
          'forge',
          1,
          587,
          'complete',
          'sell',
          100,
          'opaque+/=first',
        ]),
      ),
    ).toBeUndefined()
  },
)

test('keeps failed pages out of the observation and invalidates only the expired side through the paging interface', async () => {
  let oversized = true
  serve(() =>
    oversized
      ? json({ orders: page('sell', 101, 101, null) })
      : fail('MARKET_OBSERVATION_UNAVAILABLE'),
  )
  const source = ref(observedBook())
  const { paging } = await mountPaging(source)
  const { paging: buyers } = await mountPaging(source, ref('buy'))
  await paging.next()
  expect(paging.failure.value).toBe('page')
  expect(paging.page.value.rows).toHaveLength(100)
  oversized = false
  await paging.retry()
  expect(paging.failure.value).toBe('observation')
  expect(paging.page.value.rows).toHaveLength(0)
  expect(buyers.page.value.rows).toHaveLength(1)
  expect(paging.first()).toBeNull()
  expect(await paging.next()).toBeNull()
  expect(await paging.retry()).toBeNull()
})

test('keeps fifty issued page starts with a usable first-page action beyond the backward limit', async () => {
  const requests = serve(({ variables }) => {
    const index =
      variables.after === 'opaque+/=first' ? 1 : Number(variables.after.slice('issued-'.length))
    return json({ orders: page('sell', 100 * index + 1, 1, `issued-${index + 1}`) })
  })
  const { paging } = await mountPaging(ref(observedBook()))
  for (let index = 1; index <= 51; index++) {
    await paging.next()
    expect(paging.page.value.index).toBe(index)
    expect(paging.page.value.rows[0]?.orderId).toBe(100 * index + 1)
  }
  for (let index = 50; index >= 2; index--) {
    await paging.previous()
    expect(paging.page.value.index).toBe(index)
    expect(paging.page.value.rows[0]?.orderId).toBe(100 * index + 1)
  }
  expect(paging.canPrevious.value).toBe(false)
  const attempts = requests.length
  expect(await paging.previous()).toBeNull()
  paging.first()
  expect(paging.page.value.index).toBe(0)
  expect(paging.page.value.rows).toHaveLength(100)
  expect(requests).toHaveLength(attempts)
})

test('rediscovery restarts traversal even if the complete observation is unchanged and does not page after failed discovery', async () => {
  let failBook = false
  const requests = serve(({ query }) => {
    if (query === MarketProfilesDocument.toString())
      return json({
        profiles: [
          {
            profileId: 'forge',
            revision: '1',
            regionId: '10000002',
            marketScope: 'region',
            mode: 'region',
            watchedTypeIds: [],
            stationIds: [],
          },
        ],
      })
    if (query === MarketItemDocument.toString())
      return json({
        catalogueType: {
          revision: 'catalogue',
          item: { id: '587', groupId: '25', name: 'Rifter' },
        },
      })
    if (query === MarketBookDocument.toString())
      return failBook
        ? new Response('{}', { status: 503 })
        : json({
            book: {
              profileId: 'forge',
              profileRevision: '1',
              typeId: '587',
              status: 'current',
              collectionStatus: 'ready',
              replacement: null,
              observation: observation(),
            },
          })
    if (query === MarketInitialOrdersDocument.toString())
      return json({ sellers: page('sell'), buyers: page('buy', 500, 1, null) })
    return fail('MARKET_OBSERVATION_UNAVAILABLE')
  })
  let resource!: ReturnType<typeof useMarketOverview>
  const wrapper = await mount(
    defineComponent({
      setup() {
        resource = useMarketOverview(ref('catalogue'), ref(587), ref('forge'), ref(false))
        const observed = computed(() =>
          resource.orders.book.value?.status !== 'uncollected' ? resource.orders.book.value : null,
        )
        return () =>
          observed.value
            ? h(MarketOrderTables, {
                key: resource.orders.version.value,
                book: observed.value,
                onRestart: resource.orders.restart,
              })
            : h('output', 'Waiting')
      },
    }),
  )
  await vi.waitFor(() => expect(rows(wrapper)).toHaveLength(100))
  await button(wrapper, 'Next orders').trigger('click')
  await vi.waitFor(() =>
    expect(wrapper.text()).toContain('Restart with the latest market observation'),
  )
  failBook = true
  const initialCount = requests.filter(
    (request) => request.query === MarketInitialOrdersDocument.toString(),
  ).length
  await button(wrapper, 'Restart with the latest market observation').trigger('click')
  await vi.waitFor(() => expect(resource.orders.presentation.value.unavailable).toBe(true))
  expect(
    requests.filter((request) => request.query === MarketInitialOrdersDocument.toString()),
  ).toHaveLength(initialCount)
  expect(rows(wrapper)).toHaveLength(0)
  failBook = false
  await button(wrapper, 'Restart with the latest market observation').trigger('click')
  await vi.waitFor(() => expect(rows(wrapper)).toHaveLength(100))
  expect(wrapper.text()).not.toContain('Restart with the latest market observation')
})

test('caps continuation reuse by its source expiry and releases detached pages after five minutes', async () => {
  const start = Date.parse('2026-10-03T12:00:00Z')
  let now = start
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const requests = serve(() =>
    json({
      orders: {
        ...page('sell', 101, 3, null),
        observation: { ...observation(), freshUntil: new Date(start + 2500).toISOString() },
      },
    }),
  )
  const { wrapper, paging } = await mountPaging(ref(observedBook()))
  await paging.next()
  expect(paging.page.value.rows).toHaveLength(3)
  paging.first()
  now = start + 2499
  await paging.next()
  await flushPromises()
  expect(requests).toHaveLength(1)
  paging.first()
  now = start + 2501
  await paging.next()
  await flushPromises()
  expect(requests).toHaveLength(2)
  const key = marketGraphQLKey('MarketOrderContinuation', [
    'forge',
    1,
    587,
    'complete',
    'sell',
    100,
    'opaque+/=first',
  ])
  vi.useFakeTimers()
  try {
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(299_999)
    expect(useQueryCache().getQueryData(key)).toMatchObject({
      rows: [{ orderId: 101 }, { orderId: 102 }, { orderId: 103 }],
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(useQueryCache().get(key)).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

test('clears a displayed continuation when the shared initial side reports an unavailable observation', async () => {
  const source = ref(observedBook())
  serve(() => json({ orders: page('sell', 101, 3, null) }))
  const { paging } = await mountPaging(source)
  const { paging: buyers } = await mountPaging(source, ref('buy'))
  await paging.next()
  expect(paging.page.value.rows).toHaveLength(3)
  source.value = {
    ...source.value,
    sellers: {
      kind: 'unavailable',
      rows: [],
      hasMore: false,
      nextCursor: null,
      labelsComplete: false,
      error: 'MARKET_OBSERVATION_UNAVAILABLE',
    },
  }
  await flushPromises()
  expect(paging.page.value.rows).toHaveLength(0)
  expect(buyers.page.value.rows).toHaveLength(1)
  expect(paging.failure.value).toBe('observation')
})
