import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useMarketGroupItems } from '../src/runtime/app/useMarketGroupItems'
import { clearQueryCache } from '../../../../tests/support/clear-query-cache'

const mountedWrappers: { unmount: () => void }[] = []
const marketPage = (revision: string, groupId: number, ids: number[], nextCursor: string | null) =>
  new Response(
    JSON.stringify({
      kind: 'group-types',
      groupId,
      revision: { buildNumber: 1, ingestVersion: 6, ingestedAt: revision },
      items: ids.map((id) => ({ id, groupId, name: `Item ${id}` })),
      nextCursor,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )

const mountGroupItems = async () => {
  const revision = ref('revision-a')
  const groupId = ref(19)
  const enabled = ref(true)
  let groupItems!: ReturnType<typeof useMarketGroupItems>
  const Harness = defineComponent({
    name: 'MarketGroupItemsHarness',
    setup() {
      groupItems = useMarketGroupItems(revision, groupId, enabled)
      return () => h('div')
    },
  })
  const wrapper = await mountSuspended(Harness)
  mountedWrappers.push(wrapper)
  return { revision, groupId, enabled, groupItems }
}

beforeEach(() => clearQueryCache())
afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  clearQueryCache()
})

test('accumulates bounded pages once and deduplicates repeated item identities', async () => {
  const originalFetch = globalThis.fetch
  const requests = vi.fn((url: string) =>
    Promise.resolve(
      url.includes('cursor=t_2s')
        ? marketPage('revision-a', 19, [2, 3], null)
        : marketPage('revision-a', 19, [1, 2], 't_2s'),
    ),
  )
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    return url.includes('/market/catalogue/body/') ? requests(url) : originalFetch(input, init)
  })
  const { groupItems } = await mountGroupItems()
  await vi.waitFor(() => expect(groupItems.items.value.map(({ id }) => id)).toEqual([1, 2]))
  expect(groupItems.hasMore.value).toBe(true)
  expect(groupItems.loadMore()).toBe(true)
  expect(groupItems.loadMore()).toBe(false)
  await vi.waitFor(() => expect(groupItems.items.value.map(({ id }) => id)).toEqual([1, 2, 3]))
  expect(groupItems.status.value).toBe('ready')
  expect(groupItems.hasMore.value).toBe(false)
  expect(requests).toHaveBeenCalledTimes(2)
})

test('discards late pages across revision and group changes', async () => {
  const oldPage = Promise.withResolvers<Response>()
  const oldStarted = Promise.withResolvers<void>()
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/market/catalogue/body/')) return originalFetch(input, init)
    if (url.includes('revision-a')) {
      oldStarted.resolve()
      return oldPage.promise
    }
    return Promise.resolve(marketPage('revision-b', 20, [42], null))
  })
  const { revision, groupId, groupItems } = await mountGroupItems()
  await oldStarted.promise
  revision.value = 'revision-b'
  groupId.value = 20
  await vi.waitFor(() => expect(groupItems.items.value.map(({ id }) => id)).toEqual([42]))
  oldPage.resolve(marketPage('revision-a', 19, [1], null))
  await Promise.resolve()
  expect(groupItems.items.value.map(({ id }) => id)).toEqual([42])
})

test('keeps the complete first page when a later page fails and retries the same cursor', async () => {
  let fail = true
  const requests: string[] = []
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/market/catalogue/body/')) return originalFetch(input, init)
    requests.push(url)
    if (!url.includes('cursor=t_2s'))
      return Promise.resolve(marketPage('revision-a', 19, [1], 't_2s'))
    if (fail) return Promise.resolve(new Response('{}', { status: 503 }))
    return Promise.resolve(marketPage('revision-a', 19, [2], null))
  })
  const { groupItems } = await mountGroupItems()
  await vi.waitFor(() => expect(groupItems.items.value.map(({ id }) => id)).toEqual([1]))
  expect(groupItems.loadMore()).toBe(true)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(new URL(requests[1]!).searchParams.get('cursor')).toBe('t_2s')
  await vi.waitFor(() => expect(groupItems.status.value).toBe('unavailable'))
  expect(groupItems.items.value.map(({ id }) => id)).toEqual([1])
  fail = false
  groupItems.retry()
  await vi.waitFor(() => expect(groupItems.items.value.map(({ id }) => id)).toEqual([1, 2]))
  expect(groupItems.status.value).toBe('ready')
})
