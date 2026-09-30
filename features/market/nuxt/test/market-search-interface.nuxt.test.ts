import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { useMarketSearch } from '../src/runtime/app/useMarketSearch'
import type { MarketSearchWorker } from '../src/runtime/app/market-search'
import { clearQueryCache } from '../../../../tests/support/clear-query-cache'

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }))
vi.mock('../src/runtime/app/market-search-worker', () => ({
  createMarketSearchWorker: mocks.createWorker,
}))

const item = { id: 1, groupId: 19, name: 'Test market item' }
const sourceFor = (key: string) => ({
  key,
  tree: { revision: { buildNumber: 1, ingestVersion: 6, ingestedAt: key } },
})
const indexFor = (key: string) => ({
  kind: 'search-index',
  complete: true,
  types: [item],
  revision: sourceFor(key).tree.revision,
})
const mountedWrappers: { unmount: () => void }[] = []

const mountSearch = async () => {
  const source = ref(sourceFor('revision-a'))
  const query = ref('')
  let search!: ReturnType<typeof useMarketSearch>
  const Harness = defineComponent({
    name: 'MarketSearchHarness',
    setup() {
      search = useMarketSearch(
        source,
        query,
        computed(() => false),
      )
      return () => h('div')
    },
  })
  const wrapper = await mountSuspended(Harness)
  mountedWrappers.push(wrapper)
  return { source, query, search, wrapper }
}

beforeEach(() => {
  clearQueryCache()
  mocks.createWorker.mockReset()
  mocks.createWorker.mockImplementation(() => ({
    search: vi.fn().mockResolvedValue([{ item, score: 0 }]),
    terminate: vi.fn(),
  }))
  useQueryCache().setQueryData(
    ['market', 'catalogue', 'revision-a', 'search-index'],
    indexFor('revision-a'),
  )
  useQueryCache().setQueryData(
    ['market', 'catalogue', 'revision-b', 'search-index'],
    indexFor('revision-b'),
  )
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  clearQueryCache()
})

test('discards a pending old-revision query when replacement worker initialization fails', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<MarketSearchWorker['search']>>>()
  const oldWorker = {
    search: vi.fn().mockResolvedValueOnce([]).mockReturnValueOnce(pending.promise),
    terminate: vi.fn(),
  }
  mocks.createWorker.mockReturnValueOnce(oldWorker).mockImplementationOnce(() => {
    throw new Error('Worker initialization failed')
  })
  const { source, query, search } = await mountSearch()
  query.value = 'test'
  await vi.waitFor(() => expect(oldWorker.search).toHaveBeenCalledWith('test', { limit: 100 }))
  source.value = sourceFor('revision-b')
  await vi.waitFor(() => expect(search.status.value).toBe('unavailable'))
  expect(oldWorker.terminate).toHaveBeenCalledOnce()
  pending.resolve([{ item, score: 0 }])
  await flushPromises()
  await nextTick()
  expect(search.results.value).toEqual([])
  search.retry()
  await vi.waitFor(() => expect(search.results.value).toEqual([item]))
})

test('ignores a previous revision worker failure after its replacement is ready', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<MarketSearchWorker['search']>>>()
  const oldWorker = { search: vi.fn().mockReturnValue(pending.promise), terminate: vi.fn() }
  mocks.createWorker.mockReturnValueOnce(oldWorker)
  const { source, query, search } = await mountSearch()
  query.value = 'test'
  await vi.waitFor(() => expect(oldWorker.search).toHaveBeenCalledOnce())
  source.value = sourceFor('revision-b')
  await vi.waitFor(() => expect(search.results.value).toEqual([item]))
  pending.reject(new Error('Previous worker failed'))
  await flushPromises()
  expect(search.status.value).toBe('ready')
  expect(oldWorker.terminate).toHaveBeenCalledOnce()
})

test('keeps only the newest query result and disposes the worker with its owner', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<MarketSearchWorker['search']>>>()
  const worker = {
    search: vi
      .fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce([{ item, score: 0 }]),
    terminate: vi.fn(),
  }
  mocks.createWorker.mockReturnValueOnce(worker)
  const { query, search, wrapper } = await mountSearch()
  query.value = 'test'
  await vi.waitFor(() => expect(worker.search).toHaveBeenCalledWith('test', { limit: 100 }))
  query.value = 'test market'
  await vi.waitFor(() => expect(search.results.value).toEqual([item]))
  pending.resolve([])
  await flushPromises()
  expect(search.results.value).toEqual([item])
  wrapper.unmount()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
