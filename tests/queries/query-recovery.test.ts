import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PUBLIC_QUERY_KEYS } from '../../app/queries/query-keys'
import { systemStatusQuery } from '../../app/queries/system-status'
import type { ApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ESI query recovery', () => {
  it('auto-refetches only the opted-in system-status query', async () => {
    vi.useFakeTimers()
    const statusQuery = vi.fn().mockResolvedValue(systemStatusResult('operational'))
    const ordinaryQuery = vi.fn().mockResolvedValue('ordinary')
    const statusOptions = systemStatusQuery({} as ApiClient)
    const Consumer = defineComponent({
      setup() {
        useQuery({ ...statusOptions, query: statusQuery })
        useQuery({ ...statusOptions, query: statusQuery })
        useQuery({
          key: ['test', 'ordinary-polling'],
          query: ordinaryQuery,
          staleTime: 1,
        })
        return () => h('span')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Consumer)
    await flushPromises()

    expect(statusOptions.autoRefetch).toBe(true)
    expect(statusQuery).toHaveBeenCalledOnce()
    expect(ordinaryQuery).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(statusOptions.staleTime ?? 0)
    await flushPromises()

    expect(statusQuery).toHaveBeenCalledTimes(2)
    expect(ordinaryQuery).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('invalidates one recovery transition without touching ineligible entries or removal', async () => {
    const statusQuery = vi
      .fn()
      .mockResolvedValueOnce(systemStatusResult('unavailable'))
      .mockResolvedValue(systemStatusResult('operational'))
    const eligibleStaleQuery = vi.fn().mockResolvedValue('eligible-stale')
    const eligibleFreshQuery = vi.fn().mockResolvedValue('eligible-fresh')
    const unclassifiedQuery = vi.fn().mockResolvedValue('unclassified')
    const inactiveQuery = vi.fn().mockResolvedValue('inactive')
    const Consumer = defineComponent({
      setup() {
        useQuery({
          key: PUBLIC_QUERY_KEYS.systemStatus(),
          query: statusQuery,
          staleTime: 60_000,
          autoRefetch: false,
          meta: { esiPersistence: { kind: 'none' } },
        })
        useQuery({
          key: ['public', 'eligible-stale'],
          query: eligibleStaleQuery,
          staleTime: 0,
          meta: { esiPersistence: { kind: 'public-esi' } },
        })
        useQuery({
          key: ['public', 'eligible-fresh'],
          query: eligibleFreshQuery,
          staleTime: 60_000,
          meta: { esiPersistence: { kind: 'public-esi' } },
        })
        useQuery({
          key: ['public', 'unclassified'],
          query: unclassifiedQuery,
          staleTime: 0,
          meta: { esiPersistence: { kind: 'none' } },
        })
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Consumer)
    await flushPromises()
    const inactiveEntry = queryCache.ensure({
      key: ['public', 'eligible-inactive'],
      query: inactiveQuery,
      staleTime: 0,
      meta: { esiPersistence: { kind: 'public-esi' } },
    })
    await queryCache.refresh(inactiveEntry)
    const invalidateQueries = vi.spyOn(queryCache, 'invalidateQueries')
    const remove = vi.spyOn(queryCache, 'remove')
    const statusEntry = queryCache.get(PUBLIC_QUERY_KEYS.systemStatus())
    if (!statusEntry) throw new Error('Expected a system-status query entry.')

    await queryCache.fetch(statusEntry)
    await flushPromises()

    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(eligibleStaleQuery).toHaveBeenCalledTimes(2)
    expect(eligibleFreshQuery).toHaveBeenCalledOnce()
    expect(unclassifiedQuery).toHaveBeenCalledOnce()
    expect(inactiveQuery).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()

    await queryCache.fetch(statusEntry)
    await flushPromises()

    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(eligibleStaleQuery).toHaveBeenCalledTimes(2)
    expect(remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('recognizes an unavailable status restored before the first client poll', async () => {
    const statusQuery = vi.fn().mockResolvedValue(systemStatusResult('operational'))
    const staleQuery = vi.fn().mockResolvedValue('current')
    const Consumer = defineComponent({
      setup() {
        useQuery({
          key: PUBLIC_QUERY_KEYS.systemStatus(),
          initialData: () => systemStatusResult('unavailable'),
          initialDataUpdatedAt: 0,
          enabled: false,
          query: statusQuery,
          staleTime: 0,
          autoRefetch: false,
          meta: { esiPersistence: { kind: 'none' } },
        })
        useQuery({
          key: ['public', 'hydrated-recovery'],
          query: staleQuery,
          staleTime: 0,
          meta: { esiPersistence: { kind: 'public-esi' } },
        })
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Consumer)
    await flushPromises()
    const invalidateQueries = vi.spyOn(queryCache, 'invalidateQueries')
    const statusEntry = queryCache.get(PUBLIC_QUERY_KEYS.systemStatus())
    if (!statusEntry) throw new Error('Expected a system-status query entry.')

    await queryCache.fetch(statusEntry)
    await flushPromises()

    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(staleQuery).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})

function systemStatusResult(status: 'operational' | 'unavailable') {
  return { telemetry: { services: { esi: { status } } } }
}
