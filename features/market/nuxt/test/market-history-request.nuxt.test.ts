import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import {
  useMarketHistoryRequest,
  type MarketHistoryRequestTarget,
} from '../src/runtime/app/useMarketHistoryRequest'

const profileId = '00000000-0000-4000-8000-000000000001'

const stubDemand = (response: () => Response | Promise<Response>) => {
  const demands: string[] = []
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/market/history-intent/')) {
      demands.push(url)
      return Promise.resolve(response())
    }
    return originalFetch(input, init)
  })
  return demands
}

const useControlledTimers = () =>
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'Date'],
  })

interface DemandResponseBody {
  readonly status?: 'accepted' | 'ready'
  readonly phase?: 'queued' | 'collecting'
  readonly code?: string
  readonly history?: object
}

const json = (body: DemandResponseBody, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const mountRequest = async (onDemand = true) => {
  const active = ref(true)
  const uncollected = ref(true)
  const refetch = vi.fn(async () => undefined)
  const onReady = vi.fn()
  const target = ref<MarketHistoryRequestTarget>({
    profileId,
    profileRevision: 1,
    typeId: 34,
    onDemand,
  })
  let request!: ReturnType<typeof useMarketHistoryRequest>
  const Harness = defineComponent({
    setup() {
      request = useMarketHistoryRequest({
        target,
        active,
        uncollected,
        refetch,
        onReady,
      })
      return () => h('div')
    },
  })
  const wrapper = await mountSuspended(Harness)
  return { wrapper, request, active, target, uncollected, refetch, onReady }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('polls while collecting and settles once history arrives', async () => {
  const demands = stubDemand(() => json({ status: 'accepted', phase: 'collecting' }, 202))
  useControlledTimers()
  const { wrapper, request, uncollected, refetch } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  expect(demands).toHaveLength(1)
  expect(refetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(4_000)
  expect(refetch).toHaveBeenCalledTimes(2)
  expect(request.status.value).toBe('collecting')
  uncollected.value = false
  await vi.advanceTimersByTimeAsync(4_000)
  expect(request.status.value).toBe('idle')
  await vi.advanceTimersByTimeAsync(20_000)
  expect(refetch).toHaveBeenCalledTimes(3)
  wrapper.unmount()
})

test('stops polling after the timeout and can check again', async () => {
  const demands = stubDemand(() => json({ status: 'accepted', phase: 'collecting' }, 202))
  useControlledTimers()
  const { wrapper, request } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  await vi.advanceTimersByTimeAsync(92_000)
  expect(request.status.value).toBe('timed-out')
  request.retry()
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  expect(demands).toHaveLength(2)
  wrapper.unmount()
})

test('resumes an accepted history demand after returning to the tab without posting it again', async () => {
  const demands = stubDemand(() => json({ status: 'accepted', phase: 'collecting' }, 202))
  useControlledTimers()
  const { wrapper, request, active, uncollected, refetch } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  active.value = false
  await nextTick()
  const pausedRefetches = refetch.mock.calls.length
  await vi.advanceTimersByTimeAsync(8_000)
  expect(refetch).toHaveBeenCalledTimes(pausedRefetches)
  active.value = true
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  await vi.advanceTimersByTimeAsync(4_000)
  expect(refetch.mock.calls.length).toBeGreaterThan(pausedRefetches)
  expect(demands).toHaveLength(1)
  uncollected.value = false
  await vi.advanceTimersByTimeAsync(4_000)
  expect(request.status.value).toBe('idle')
  wrapper.unmount()
})

test('does not revive a paused poll after its refresh finishes in a reopened tab', async () => {
  const demands = stubDemand(() => json({ status: 'accepted', phase: 'collecting' }, 202))
  useControlledTimers()
  const { wrapper, request, active, refetch } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  const refresh = Promise.withResolvers<void>()
  refetch.mockReturnValueOnce(refresh.promise)
  vi.advanceTimersByTime(4_000)
  expect(refetch).toHaveBeenCalledTimes(2)
  active.value = false
  await nextTick()
  active.value = true
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  expect(refetch).toHaveBeenCalledTimes(3)
  refresh.resolve()
  await flushPromises()
  await vi.advanceTimersByTimeAsync(4_000)
  expect(refetch).toHaveBeenCalledTimes(4)
  expect(demands).toHaveLength(1)
  wrapper.unmount()
})

test('reports the per-market demand limit separately from other failures', async () => {
  stubDemand(() => json({ code: 'MARKET_HISTORY_DEMAND_LIMIT' }, 429))
  const limited = await mountRequest()
  await vi.waitFor(() => expect(limited.request.status.value).toBe('limit'))
  expect(limited.refetch).not.toHaveBeenCalled()
  limited.wrapper.unmount()
  vi.unstubAllGlobals()
  stubDemand(() => json({}, 503))
  const failed = await mountRequest()
  await vi.waitFor(() => expect(failed.request.status.value).toBe('unavailable'))
  failed.wrapper.unmount()
})

test('does not request history for profiles without on-demand collection', async () => {
  const demands = stubDemand(() => json({ status: 'accepted' }, 202))
  const { wrapper, request } = await mountRequest(false)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(demands).toHaveLength(0)
  expect(request.status.value).toBe('idle')
  wrapper.unmount()
})

test('shows waiting rather than collecting for a queued request', async () => {
  stubDemand(() => json({ status: 'accepted', phase: 'queued' }, 202))
  useControlledTimers()
  const { wrapper, request } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('queued'))
  wrapper.unmount()
})

test('applies a ready response without an extra history read or polling', async () => {
  const history = {
    status: 'observed',
    regionId: 10000002,
    typeId: 34,
    validatedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 60_000).toISOString(),
    days: [],
    freshness: 'current',
  }
  stubDemand(() => json({ status: 'ready', history }, 200))
  useControlledTimers()
  const { wrapper, request, onReady, refetch } = await mountRequest()
  await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(history))
  expect(request.status.value).toBe('idle')
  expect(refetch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(refetch).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('does not apply a late ready response to a different selected item', async () => {
  const held = Promise.withResolvers<Response>()
  let first = true
  stubDemand(() => {
    if (first) {
      first = false
      return held.promise
    }
    return json({ status: 'accepted', phase: 'queued' }, 202)
  })
  const { wrapper, request, target, onReady } = await mountRequest()
  target.value = { ...target.value, typeId: 35 }
  await vi.waitFor(() => expect(request.status.value).toBe('queued'))
  held.resolve(json({ status: 'ready', history: { typeId: 34 } }, 200))
  await flushPromises()
  expect(onReady).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('requests again once collected history later goes stale', async () => {
  const demands = stubDemand(() => json({ status: 'accepted', phase: 'collecting' }, 202))
  useControlledTimers()
  const { wrapper, request, active, uncollected } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('collecting'))
  uncollected.value = false
  await vi.advanceTimersByTimeAsync(4_000)
  expect(request.status.value).toBe('idle')
  uncollected.value = true
  active.value = false
  await nextTick()
  active.value = true
  await vi.waitFor(() => expect(demands).toHaveLength(2))
  wrapper.unmount()
})

test('requests again after a pending request outlives the poll window', async () => {
  const demands = stubDemand(() => json({ status: 'accepted', phase: 'queued' }, 202))
  useControlledTimers()
  const { wrapper, request, active } = await mountRequest()
  await vi.waitFor(() => expect(request.status.value).toBe('queued'))
  await vi.advanceTimersByTimeAsync(92_000)
  expect(request.status.value).toBe('timed-out')
  active.value = false
  await nextTick()
  active.value = true
  await vi.waitFor(() => expect(demands).toHaveLength(2))
  wrapper.unmount()
})
