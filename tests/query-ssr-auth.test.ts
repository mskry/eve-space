import {
  hydrateQueryCache,
  PiniaColada,
  serializeQueryCache,
  useQuery,
  useQueryCache,
} from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { parse, stringify } from 'devalue'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import { unauthenticatedSession } from '../app/queries/auth'
import { characterOverviewQuery } from '../app/queries/characters'
import { canRunProtectedQuery, clearAuthenticatedQueries } from '../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../app/queries/query-keys'
import { systemStatusQuery } from '../app/queries/system-status'
import { createApiClient } from '../app/utils/api-client'
import { coladaOptions } from '../app/utils/colada-options'
import {
  ApiQueryError,
  reduceApiQueryError,
  reduceNativeError,
  reviveApiQueryError,
  reviveNativeError,
} from '../app/utils/query-error'
import { mountWithQueryPlugins } from './support/mount-with-query-plugins'
import { queryServer } from './support/query-server'

describe('SSR and authentication query boundaries', () => {
  it('hydrates a public SSR result without a duplicate browser request', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/status', () => {
        requests()
        return HttpResponse.json(systemStatusResponse())
      }),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const { data } = useQuery(systemStatusQuery(apiClient))
        return () => h('span', data.value?.telemetry.status ?? 'loading')
      },
    })

    const serverPinia = createPinia()
    const serverApp = createSSRApp(Root)
    serverApp.use(serverPinia)
    serverApp.use(PiniaColada, coladaOptions)
    const html = await renderToString(serverApp)
    const payload = serializeQueryCache(useQueryCache(serverPinia))

    expect(html).toContain('operational')
    expect(requests).toHaveBeenCalledTimes(1)

    document.body.innerHTML = `<div id="app">${html}</div>`
    const clientPinia = createPinia()
    const clientApp = createSSRApp(Root)
    clientApp.use(clientPinia)
    clientApp.use(PiniaColada, coladaOptions)
    hydrateQueryCache(useQueryCache(clientPinia), payload)
    clientApp.mount('#app')
    await flushPromises()

    expect(requests).toHaveBeenCalledTimes(1)
    clientApp.unmount()
  })

  it.each([
    new ApiQueryError('Status unavailable.', { status: 503, code: 'STATUS_UNAVAILABLE' }),
    new TypeError('fetch failed'),
  ])('serializes and revives a caught SSR query error', async (queryError) => {
    const Root = defineComponent({
      setup() {
        useQuery({
          key: ['public', 'failing-query', queryError.name],
          query: async () => {
            throw queryError
          },
          retry: 0,
          ssrCatchError: true,
        })
        return () => h('span', 'fallback')
      },
    })
    const pinia = createPinia()
    const app = createSSRApp(Root)
    app.use(pinia)
    app.use(PiniaColada, coladaOptions)
    await renderToString(app)

    const cache = serializeQueryCache(useQueryCache(pinia))
    const serialized = stringify(cache, {
      ApiQueryError: reduceApiQueryError,
      QueryNativeError: reduceNativeError,
    })
    const revived = parse(serialized, {
      ApiQueryError: reviveApiQueryError,
      QueryNativeError: reviveNativeError,
    }) as Record<string, [unknown, unknown]>
    const revivedError = Object.values(revived)[0]?.[1]

    expect(revivedError).toBeInstanceOf(queryError.constructor)
    expect(revivedError).toMatchObject({ name: queryError.name, message: queryError.message })
  })

  it('does not run a protected SSR query and enables it after browser authentication', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7', () => {
        requests()
        return HttpResponse.json(characterOverviewResponse())
      }),
    )
    const apiClient = createApiClient('http://localhost')
    const authenticated = ref(false)
    const Root = defineComponent({
      setup() {
        const { data } = useQuery({
          ...characterOverviewQuery({ apiClient, characterId: 7 }),
          enabled: () => canRunProtectedQuery(true, authenticated.value, 7),
        })
        return () => h('span', data.value?.profile.name ?? 'locked')
      },
    })

    const ServerRoot = defineComponent({
      setup() {
        useQuery({
          ...characterOverviewQuery({ apiClient, characterId: 7 }),
          enabled: canRunProtectedQuery(false, true, 7),
        })
        return () => h('span', 'locked')
      },
    })
    const serverPinia = createPinia()
    const serverApp = createSSRApp(ServerRoot)
    serverApp.use(serverPinia)
    serverApp.use(PiniaColada, coladaOptions)
    await renderToString(serverApp)
    expect(requests).not.toHaveBeenCalled()

    const { wrapper } = mountWithQueryPlugins(Root)
    expect(wrapper.text()).toBe('locked')
    authenticated.value = true
    await flushPromises()
    expect(requests).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toBe('Capsuleer')
    wrapper.unmount()
  })

  it('clears private cache entries while keeping an anonymous active session value', () => {
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.session(),
      query: async () => unauthenticatedSession,
    })
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.roster(),
      query: async () => ({ characters: [] }),
    })
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.wallet(7),
      query: async () => ({ balance: 0 }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.session(), {
      authenticated: true,
      account: { userId: 'user', mainCharacter: { characterId: 7 } },
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), { characters: [{ characterId: 7 }] })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.wallet(7), { balance: 123 })

    clearAuthenticatedQueries(queryCache, unauthenticatedSession)

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual({
      authenticated: false,
    })
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.roster())).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.wallet(7))).toBeUndefined()
    expect(queryCache.getEntries({ key: PRIVATE_QUERY_KEYS.root })).toHaveLength(1)
    wrapper.unmount()
  })
})

function systemStatusResponse() {
  return {
    status: 'operational',
    checkedAt: '2026-08-20T00:00:00.000Z',
    cachedUntil: '2026-08-20T00:00:15.000Z',
    services: {
      api: { status: 'operational', uptimeSeconds: 100 },
      database: { status: 'operational', latencyMs: 1 },
      esi: {
        status: 'operational',
        latencyMs: 2,
        checkedAt: '2026-08-20T00:00:00.000Z',
        players: 20_000,
        serverVersion: 'test',
        startedAt: null,
        vip: false,
        errorBudgetRemaining: 100,
        errorBudgetResetSeconds: 10,
      },
    },
  }
}

function characterOverviewResponse() {
  return {
    profile: {
      id: 7,
      name: 'Capsuleer',
      birthday: '2020-01-01T00:00:00.000Z',
      gender: 'Female',
      race: 'Caldari',
      bloodline: 'Deteis',
      securityStatus: 1,
      achievementScore: 0,
      corporation: { id: 1, name: 'Corp', ticker: 'CORP', memberCount: 1 },
      alliance: null,
    },
    location: { status: 'unavailable', message: 'Unavailable' },
    ship: { status: 'unavailable', message: 'Unavailable' },
    skills: { status: 'unavailable', message: 'Unavailable' },
  }
}
