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
import { unauthenticatedSession } from '../../app/queries/auth'
import { characterOverviewQuery, publicCharacterQuery } from '../../app/queries/characters'
import { corporationAllianceHistoryQuery, corporationQuery } from '../../app/queries/corporations'
import { canRunProtectedCharacterQuery } from '../../app/queries/protected-character-query-access'
import { platformReviewerContributionTargetQueryKey } from '@eve-space/platform-module-nuxt/runtime'
import { clearAuthenticatedQueries } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import {
  organizationReviewDirectoryQuery,
  organizationReviewEntryQuery,
  organizationReviewTargetQuery,
} from '../../app/queries/organization-review'
import { systemStatusQuery } from '../../app/queries/system-status'
import { createApiClient } from '../../app/utils/api-client'
import { coladaOptions } from '../../app/utils/colada-options'
import {
  ApiQueryError,
  reduceApiQueryError,
  reduceNativeError,
  reviveApiQueryError,
  reviveNativeError,
} from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

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
    new ApiQueryError('Status unavailable.', { code: 'STATUS_UNAVAILABLE', status: 503 }),
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
    expect(revivedError).toMatchObject({ message: queryError.message, name: queryError.name })
  })

  it('classifies session-protected record lookups as private and non-persistent', () => {
    const apiClient = createApiClient('http://localhost')
    const options = [
      publicCharacterQuery({ apiClient, characterId: 7 }),
      corporationQuery({ apiClient, corporationId: 8 }),
      corporationAllianceHistoryQuery({ apiClient, corporationId: 8 }),
    ]

    expect(options.map((option) => option.key[0])).toStrictEqual(['private', 'private', 'private'])
    expect(options.map((option) => option.meta?.esiPersistence)).toStrictEqual([
      { kind: 'none' },
      { kind: 'none' },
      { kind: 'none' },
    ])
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
          enabled: () =>
            canRunProtectedCharacterQuery(
              {
                authenticated: authenticated.value,
                authenticationReady: true,
                isClient: true,
                ownsCharacter: true,
              },
              7,
            ),
        })
        return () => h('span', data.value?.profile.name ?? 'locked')
      },
    })

    const ServerRoot = defineComponent({
      setup() {
        useQuery({
          ...characterOverviewQuery({ apiClient, characterId: 7 }),
          enabled: canRunProtectedCharacterQuery(
            {
              authenticated: true,
              authenticationReady: true,
              isClient: false,
              ownsCharacter: true,
            },
            7,
          ),
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

  it('does not request reviewer entry, directory, target, or panel data during SSR', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/review', () => {
        requests('entry')
        return HttpResponse.json({ contributions: [], organizationVersion: 7 })
      }),
      http.get('http://localhost/api/organization/review/members', () => {
        requests('directory')
        return HttpResponse.json({
          groupFacets: [],
          items: [],
          nextCursor: null,
          organizationVersion: 7,
          status: 'available',
        })
      }),
    )
    const apiClient = createApiClient('http://localhost')
    const panelQuery = vi.fn()
    const Root = defineComponent({
      setup() {
        useQuery(organizationReviewEntryQuery({ apiClient, authenticated: true }))
        useQuery(
          organizationReviewDirectoryQuery({
            apiClient,
            enabled: true,
            input: { limit: 25, organizationVersion: 7 },
          }),
        )
        useQuery(
          organizationReviewTargetQuery({
            apiClient,
            enabled: true,
            input: {
              organizationVersion: 7,
              targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
            },
          }),
        )
        useQuery({
          enabled: import.meta.client,
          key: ['private', 'organization', 7, 'modules', 'alpha', 'reviewer'],
          query: panelQuery,
        })
        return () => h('span', 'Reviewer shell')
      },
    })
    const pinia = createPinia()
    const app = createSSRApp(Root)
    app.use(pinia)
    app.use(PiniaColada, coladaOptions)

    await expect(renderToString(app)).resolves.toContain('Reviewer shell')
    expect(requests).not.toHaveBeenCalled()
    expect(panelQuery).not.toHaveBeenCalled()
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
      key: PRIVATE_QUERY_KEYS.characterFinanceBalance(7),
      query: async () => ({ balance: 0 }),
    })
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.characterModuleResource(7, 'member-audit', 'records'),
      query: async () => ({ records: [] }),
    })
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationCompliance(),
      query: async () => ({ state: 'compliant' }),
    })
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationReviewerEntry(),
      query: async () => ({ contributions: [], organizationVersion: 7 }),
    })
    const reviewerTargetKey = platformReviewerContributionTargetQueryKey({
      contributionId: 'summary',
      moduleId: 'alpha',
      organizationVersion: 7,
      target: {
        kind: 'managed-organization-account',
        managedMemberLifecycleId: 'member-lifecycle-1',
        sectionActivationVersion: 1,
        userId: 'target-user',
      },
    })
    queryCache.ensure({
      key: reviewerTargetKey,
      query: async () => ({ privateRecord: true }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.session(), {
      account: { mainCharacter: { characterId: 7 }, userId: 'user' },
      authenticated: true,
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), { characters: [{ characterId: 7 }] })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.characterFinanceBalance(7), { balance: 123 })
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterModuleResource(7, 'member-audit', 'records'),
      { records: [] },
    )
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationCompliance(), { state: 'compliant' })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationReviewerEntry(), {
      contributions: [],
      organizationVersion: 7,
    })
    queryCache.setQueryData(reviewerTargetKey, { privateRecord: true })

    clearAuthenticatedQueries(queryCache, unauthenticatedSession)

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toStrictEqual({
      authenticated: false,
    })
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.roster())).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterFinanceBalance(7))).toBeUndefined()
    expect(
      queryCache.getQueryData(
        PRIVATE_QUERY_KEYS.characterModuleResource(7, 'member-audit', 'records'),
      ),
    ).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationCompliance())).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationReviewerEntry())).toBeUndefined()
    expect(queryCache.getQueryData(reviewerTargetKey)).toBeUndefined()
    expect(queryCache.getEntries({ key: PRIVATE_QUERY_KEYS.root })).toHaveLength(1)
    wrapper.unmount()
  })
})

function systemStatusResponse() {
  return {
    cachedUntil: '2026-08-20T00:00:15.000Z',
    checkedAt: '2026-08-20T00:00:00.000Z',
    services: {
      api: { status: 'operational', uptimeSeconds: 100 },
      database: { latencyMs: 1, status: 'operational' },
      esi: {
        checkedAt: '2026-08-20T00:00:00.000Z',
        errorBudgetRemaining: 100,
        errorBudgetResetSeconds: 10,
        latencyMs: 2,
        players: 20_000,
        serverVersion: 'test',
        startedAt: null,
        status: 'operational',
        vip: false,
      },
      sde: {
        buildNumber: 3_503_375,
        checkedAt: '2026-08-20T00:00:00.000Z',
        ingestVersion: 4,
        ingestedAt: '2026-08-19T23:00:00.000Z',
        latencyMs: 1,
        status: 'operational',
      },
    },
    status: 'operational',
  }
}

function characterOverviewResponse() {
  return {
    location: { message: 'Unavailable', status: 'unavailable' },
    profile: {
      achievementScore: 0,
      alliance: null,
      birthday: '2020-01-01T00:00:00.000Z',
      bloodline: 'Deteis',
      corporation: { id: 1, memberCount: 1, name: 'Corp', ticker: 'CORP' },
      gender: 'Female',
      id: 7,
      name: 'Capsuleer',
      race: 'Caldari',
      securityStatus: 1,
    },
    ship: { message: 'Unavailable', status: 'unavailable' },
    skills: { message: 'Unavailable', status: 'unavailable' },
  }
}
