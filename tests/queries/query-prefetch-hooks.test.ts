import { useQuery, type QueryCache, type UseQueryEntry } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { authSessionQuery } from '../../app/queries/auth'
import { prefetchProtectedQuery, prefetchQuery } from '../../app/queries/query-cache'
import { createApiClient } from '../../app/utils/api-client'
import { QUERY_ERROR_EVENT } from '../../app/utils/colada-options'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'

describe('query prefetching and hooks', () => {
  it('opts the production session query into the centralized error policy', () => {
    expect(authSessionQuery(createApiClient('http://localhost')).meta).toStrictEqual({
      esiPersistence: { kind: 'none' },
      globalErrorMessage: 'Session verification is unavailable.',
    })
  })

  it('reuses an in-flight prefetched request when a consumer mounts', async () => {
    let resolveQuery: ((value: { name: string }) => void) | undefined
    const query = vi.fn(() => new Promise<{ name: string }>((resolve) => (resolveQuery = resolve)))
    const options = {
      key: ['test', 'prefetch'] as const,
      query,
      staleTime: 60_000,
    }
    const showConsumer = ref(false)
    const Consumer = defineComponent({
      setup() {
        const { data } = useQuery(options)
        return () => h('span', data.value?.name ?? 'loading')
      },
    })
    const Root = defineComponent({
      setup: () => () => (showConsumer.value ? h(Consumer) : h('span', 'idle')),
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)

    const prefetched = prefetchQuery(queryCache, options)
    showConsumer.value = true
    await flushPromises()
    expect(query).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toBe('loading')

    resolveQuery?.({ name: 'Prefetched' })
    await prefetched
    await flushPromises()
    expect(query).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toBe('Prefetched')
    wrapper.unmount()
  })

  it('preserves the ensure-options then refresh-entry prefetch flow', async () => {
    const options = { key: ['test', 'prefetch-flow'] as const, query: async () => 'value' }
    const entry = { key: options.key } as UseQueryEntry<string>
    const refreshResult = Promise.resolve({
      data: 'value',
      error: null,
      status: 'success',
    } as const)
    const queryCache = {
      ensure: vi.fn(() => entry),
      refresh: vi.fn(() => refreshResult),
    } as unknown as QueryCache

    await expect(prefetchQuery(queryCache, options)).resolves.toMatchObject({ data: 'value' })
    expect(queryCache.ensure).toHaveBeenCalledWith(options)
    expect(queryCache.refresh).toHaveBeenCalledWith(entry)
  })

  it('skips protected prefetch without a browser identity', async () => {
    const query = vi.fn().mockResolvedValue({ name: 'Private' })
    const options = { key: ['private', 'test'] as const, query }
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)

    const allowed = {
      authenticated: true,
      authenticationReady: true,
      isClient: true,
      ownsCharacter: true,
    }
    await prefetchProtectedQuery(queryCache, options, { ...allowed, isClient: false }, 7)
    await prefetchProtectedQuery(queryCache, options, { ...allowed, authenticationReady: false }, 7)
    await prefetchProtectedQuery(queryCache, options, { ...allowed, authenticated: false }, 7)
    await prefetchProtectedQuery(queryCache, options, { ...allowed, ownsCharacter: false }, 7)
    expect(query).not.toHaveBeenCalled()

    await prefetchProtectedQuery(queryCache, options, allowed, 7)
    expect(query).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('runs one opted-in global hook for one shared failed request', async () => {
    const report = vi.fn()
    globalThis.addEventListener(QUERY_ERROR_EVENT, report)
    const query = vi.fn().mockRejectedValue(new ApiQueryError('Forbidden', { status: 403 }))
    const Consumer = defineComponent({
      setup() {
        useQuery({
          key: ['test', 'global-hook'],
          meta: { globalErrorMessage: 'Shared request failed.' },
          query,
          retry: 0,
        })
        return () => h('span')
      },
    })
    const Root = defineComponent({ setup: () => () => h('div', [h(Consumer), h(Consumer)]) })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(query).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(1)
    const event = report.mock.calls[0]?.[0]
    expect(event).toBeInstanceOf(CustomEvent)
    expect((event as CustomEvent).detail).toStrictEqual({
      message: 'Shared request failed.',
    })
    globalThis.removeEventListener(QUERY_ERROR_EVENT, report)
    wrapper.unmount()
  })
})
