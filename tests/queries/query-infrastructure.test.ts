import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { queryRetryDelay, shouldRetryQuery } from '../../app/utils/colada-options'
import { ApiQueryError, toApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

afterEach(() => {
  vi.useRealTimers()
})

describe('query infrastructure', () => {
  it('deduplicates consumers and reuses fresh data', async () => {
    const request = vi.fn()
    queryServer.use(
      http.get('http://localhost/query', () => {
        request()
        return HttpResponse.json({ value: 'shared' })
      }),
    )

    const Consumer = defineComponent({
      setup() {
        const { data } = useQuery({
          key: ['test', 'deduplication'],
          query: () => fetch('http://localhost/query').then((response) => response.json()),
          staleTime: 60_000,
        })
        return () => h('span', data.value?.value ?? 'loading')
      },
    })
    const Parent = defineComponent({
      setup: () => () => h('div', [h(Consumer), h(Consumer)]),
    })

    const { wrapper } = mountWithQueryPlugins(Parent)
    await flushPromises()

    expect(request).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toBe('sharedshared')
    wrapper.unmount()
  })

  it('keeps the previous data visible while a stale query refreshes', async () => {
    let resolveSecond: ((value: string) => void) | undefined
    let refreshQuery: (() => Promise<unknown>) | undefined
    const query = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
    const Consumer = defineComponent({
      setup() {
        const { data, refresh } = useQuery({ key: ['test', 'stale'], query, staleTime: 0 })
        refreshQuery = refresh
        return () => h('span', data.value ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Consumer)
    await flushPromises()
    expect(wrapper.text()).toBe('first')

    const refreshing = refreshQuery?.()
    await flushPromises()
    expect(wrapper.text()).toBe('first')
    resolveSecond?.('second')
    await refreshing
    await flushPromises()
    expect(wrapper.text()).toBe('second')
    wrapper.unmount()
  })

  it('normalizes safe API error fields and Retry-After', async () => {
    const error = await toApiQueryError(
      new Response(
        JSON.stringify({
          code: 'EVE_SCOPE_REQUIRED',
          message: 'Authorize access.',
          authorizeUrl: 'https://login.example.test',
          requiredScope: 'scope.read',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
      ),
      'Fallback',
    )

    expect(error).toMatchObject({
      status: 403,
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize access.',
      authorizeUrl: 'https://login.example.test',
      requiredScope: 'scope.read',
      retryAfterSeconds: 60,
    })
    expect(Object.keys(error)).not.toContain('body')
    expect(Object.keys(error)).not.toContain('headers')
  })

  it('leaves retry timing undefined when Retry-After is absent', async () => {
    const error = await toApiQueryError(
      new Response(JSON.stringify({ message: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
      'Fallback',
    )

    expect(error.retryAfterSeconds).toBeUndefined()
  })

  it('bounds transient retries and excludes application responses', () => {
    expect(shouldRetryQuery(0, new TypeError('network'))).toBe(true)
    expect(shouldRetryQuery(1, new ApiQueryError('Gateway', { status: 502 }))).toBe(true)
    expect(shouldRetryQuery(2, new TypeError('network'))).toBe(false)

    for (const status of [400, 401, 403, 404, 422, 429]) {
      expect(shouldRetryQuery(0, new ApiQueryError('Application response', { status }))).toBe(false)
    }

    expect(queryRetryDelay(0)).toBe(500)
    expect(queryRetryDelay(1)).toBe(1_000)
  })

  it('performs at most two retry attempts for an active transient query', async () => {
    vi.useFakeTimers()
    const query = vi.fn().mockRejectedValue(new TypeError('network'))
    const Consumer = defineComponent({
      setup() {
        useQuery({
          key: ['test', 'retry-limit'],
          query,
          retry: { retry: shouldRetryQuery, delay: 0 },
        })
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Consumer)
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(query).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('does not schedule a retry for quota exhaustion', async () => {
    vi.useFakeTimers()
    const query = vi.fn().mockRejectedValue(new ApiQueryError('Quota exhausted', { status: 429 }))
    const Consumer = defineComponent({
      setup() {
        useQuery({
          key: ['test', 'quota'],
          query,
          retry: { retry: shouldRetryQuery, delay: 0 },
        })
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Consumer)
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(query).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('keys private resources by character identity', () => {
    expect(PRIVATE_QUERY_KEYS.wallet(7)).not.toEqual(PRIVATE_QUERY_KEYS.wallet(8))
    expect(PRIVATE_QUERY_KEYS.characterHistory(7)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterHistory(8),
    )
    expect(PRIVATE_QUERY_KEYS.characterAttributes(7)).toEqual([
      'private',
      'characters',
      7,
      'attributes',
    ])
    expect(PRIVATE_QUERY_KEYS.characterAttributes(7)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterAttributes(8),
    )
    expect(PRIVATE_QUERY_KEYS.characterSkillQueue(7)).toEqual([
      'private',
      'characters',
      7,
      'skill-queue',
    ])
    expect(PRIVATE_QUERY_KEYS.characterSkillQueue(7)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterSkillQueue(8),
    )
    expect(PRIVATE_QUERY_KEYS.characterOverview(7)).toEqual([
      'private',
      'characters',
      7,
      'overview',
    ])
    expect(PRIVATE_QUERY_KEYS.characterModuleResource(7, 'member-audit', 'records')).toEqual([
      'private',
      'characters',
      7,
      'modules',
      'member-audit',
      'records',
    ])
  })
})
