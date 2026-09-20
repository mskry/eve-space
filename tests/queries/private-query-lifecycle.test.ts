import { useQueryCache } from '@pinia/colada'
import { coreOrganizationAdmissionScopes } from '@eve-space/platform-module-contract/server'
import { http, HttpResponse } from 'msw'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '../../app/composables/useAuthSession'
import { useAuthSessionInitialization } from '../../app/composables/useAuthSessionInitialization'
import { useCharacterRoster } from '../../app/composables/useCharacterRoster'
import { unauthenticatedSession } from '../../app/queries/auth'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { createApiClient, type ApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const nuxtState = new Map<string, ReturnType<typeof ref>>()
const ORGANIZATION_SCOPE = coreOrganizationAdmissionScopes.activities

beforeEach(() => {
  nuxtState.clear()
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('onNuxtReady', vi.fn())
  vi.stubGlobal('readonly', (value: unknown) => value)
  vi.stubGlobal('useNuxtApp', () => ({ isHydrating: false, payload: { serverRendered: false } }))
  vi.stubGlobal('useState', (key: string, initialize: () => unknown) => {
    const existing = nuxtState.get(key)
    if (existing) return existing
    const state = ref(initialize())
    nuxtState.set(key, state)
    return state
  })
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRoute', () => ({ query: {} }))
  vi.stubGlobal('useAuthSession', () => ({
    authConfig: ref({ configured: false, loginUrl: '', attachUrl: '' }),
    authLoading: ref(false),
    authSession: ref({ authenticated: false }),
    initializeAuth: vi.fn(),
  }))
  queryServer.use(
    http.get('http://localhost/auth/config', () =>
      HttpResponse.json({ configured: false, loginUrl: '', attachUrl: '' }),
    ),
    http.get('http://localhost/auth/session', () => HttpResponse.json(authenticatedSession())),
    http.get('http://localhost/api/me/cache-admission', () => HttpResponse.json(cacheAdmission())),
    http.post('http://localhost/auth/logout', () => new HttpResponse(null, { status: 204 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('private query lifecycle', () => {
  it('shares hydration verification with middleware and reuses its completed result', async () => {
    const response = Promise.withResolvers<Response>()
    const sessionRequest = vi.fn(() => response.promise)
    queryServer.use(http.get('http://localhost/auth/session', sessionRequest))
    let initialization!: ReturnType<typeof useAuthSessionInitialization>
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        const api = createApiClient('http://localhost')
        initialization = useAuthSessionInitialization(api)
        authState = useAuthSession(api)
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const componentVerification = queryCache.refresh(queryCache.get(PRIVATE_QUERY_KEYS.session())!)
    await vi.waitFor(() => expect(sessionRequest).toHaveBeenCalledOnce())
    const middlewareVerification = initialization.initialize()
    const concurrentNavigation = initialization.initialize(true)
    expect(initialization.verification.state.value.generation).toBe(1)

    response.resolve(
      HttpResponse.json({ ...authenticatedSession(), cacheAdmission: cacheAdmission() }),
    )
    await expect(middlewareVerification).resolves.toEqual(authenticatedSession())
    await expect(concurrentNavigation).resolves.toEqual(authenticatedSession())
    await componentVerification
    await expect(initialization.initialize()).resolves.toEqual(authenticatedSession())
    expect(sessionRequest).toHaveBeenCalledOnce()
    expect(initialization.verification.state.value).toEqual({ generation: 1, status: 'verified' })
    expect(authState.authSession.value).toEqual(authenticatedSession())
    wrapper.unmount()
  })

  it.each([true, false])(
    'bootstraps session with admission available=%s in one request',
    async (available) => {
      const admissionRequest = vi.fn(() => HttpResponse.json(cacheAdmission()))
      const sessionRequest = vi.fn(({ request }: { request: Request }) => {
        expect(new URL(request.url).searchParams.get('includeAdmission')).toBe('true')
        return HttpResponse.json({
          ...authenticatedSession(),
          cacheAdmission: available ? cacheAdmission() : null,
        })
      })
      queryServer.use(
        http.get('http://localhost/auth/session', sessionRequest),
        http.get('http://localhost/api/me/cache-admission', admissionRequest),
      )
      let authState!: ReturnType<typeof useAuthSession>
      const Host = defineComponent({
        setup() {
          authState = useAuthSession(createApiClient('http://localhost'))
          return () => h('span')
        },
      })
      const { queryCache, wrapper } = mountWithQueryPlugins(Host)
      await queryCache.refresh(queryCache.get(PRIVATE_QUERY_KEYS.session())!)
      await flushPromises()

      expect(sessionRequest).toHaveBeenCalledOnce()
      expect(admissionRequest).not.toHaveBeenCalled()
      expect(authState.authSession.value).toEqual(authenticatedSession())
      expect(authState.authLoading.value).toBe(false)
      expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(authenticatedSession())
      wrapper.unmount()
    },
  )

  it('keeps authenticated data gated until cache admission resolves', async () => {
    let releaseAdmission!: () => void
    const admissionPending = new Promise<void>((resolve) => {
      releaseAdmission = resolve
    })
    queryServer.use(
      http.get('http://localhost/api/me/cache-admission', async () => {
        await admissionPending
        return HttpResponse.json(cacheAdmission())
      }),
    )
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())

    const verification = queryCache.fetch(sessionEntry!)
    await flushPromises()

    expect(authState.authLoading.value).toBe(true)
    expect(authState.authSession.value).toEqual(unauthenticatedSession)

    releaseAdmission()
    await verification
    await flushPromises()

    expect(authState.authLoading.value).toBe(false)
    expect(authState.authSession.value).toEqual(authenticatedSession())
    wrapper.unmount()
  })

  it('keeps verified identity visible while session and admission refresh in the background', async () => {
    const sessionRefresh = Promise.withResolvers<Response>()
    const admissionRefresh = Promise.withResolvers<Response>()
    const sessionRequest = vi
      .fn()
      .mockResolvedValueOnce(HttpResponse.json(authenticatedSession()))
      .mockReturnValueOnce(sessionRefresh.promise)
    const admissionRequest = vi
      .fn()
      .mockResolvedValueOnce(HttpResponse.json(cacheAdmission()))
      .mockReturnValueOnce(admissionRefresh.promise)
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(sessionApiClient(sessionRequest, admissionRequest))
        return () => h('span', authState.authLoading.value ? 'Checking identity' : 'Verified pilot')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())!
    await queryCache.fetch(sessionEntry)
    await flushPromises()

    const refreshing = queryCache.fetch(sessionEntry)
    await flushPromises()

    expect(wrapper.text()).toBe('Verified pilot')
    expect(authState.authSession.value).toEqual(authenticatedSession())

    sessionRefresh.resolve(HttpResponse.json(authenticatedSession()))
    await vi.waitFor(() => expect(admissionRequest).toHaveBeenCalledTimes(2))
    await flushPromises()

    expect(wrapper.text()).toBe('Verified pilot')
    expect(authState.authSession.value).toEqual(authenticatedSession())

    admissionRefresh.resolve(HttpResponse.json(cacheAdmission()))
    await refreshing
    await flushPromises()
    expect(wrapper.text()).toBe('Verified pilot')
    wrapper.unmount()
  })

  it('settles a canceled current verification instead of leaving authentication loading', async () => {
    const requestStarted = Promise.withResolvers<void>()
    const sessionRequest = vi.fn(
      (_input?: unknown, request?: { init?: { signal?: AbortSignal } }): Promise<Response> =>
        new Promise((_resolve, reject) => {
          const signal = request?.init?.signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          requestStarted.resolve()
        }),
    )
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(sessionApiClient(sessionRequest))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())!

    const verification = queryCache.fetch(sessionEntry)
    await requestStarted.promise
    expect(authState.authVerificationStatus.value).toBe('verifying')
    expect(authState.authVerificationInFlight.value).toBe(true)

    queryCache.cancel(sessionEntry, new Error('Last observer removed.'))
    await Promise.allSettled([verification])
    await flushPromises()

    expect(authState.authVerificationStatus.value).toBe('unavailable')
    expect(authState.authVerificationInFlight.value).toBe(false)
    expect(authState.authLoading.value).toBe(false)
    expect(authState.authSession.value).toEqual(unauthenticatedSession)
    wrapper.unmount()
  })

  it('does not let a superseded admission cancel its replacement verification', async () => {
    const sessionRequest = vi.fn(async () => HttpResponse.json(authenticatedSession()))
    const admissionRequest = vi
      .fn()
      .mockImplementationOnce(
        (_input?: unknown, request?: { init?: { signal?: AbortSignal } }): Promise<Response> =>
          new Promise((_resolve, reject) => {
            const signal = request?.init?.signal
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      )
      .mockImplementationOnce(async () => HttpResponse.json(cacheAdmission()))
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(sessionApiClient(sessionRequest, admissionRequest))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())!

    const superseded = queryCache.fetch(sessionEntry)
    await vi.waitFor(() => expect(admissionRequest).toHaveBeenCalledOnce())
    const replacement = queryCache.fetch(sessionEntry)
    await vi.waitFor(() => expect(sessionRequest).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(admissionRequest).toHaveBeenCalledTimes(2))
    await Promise.allSettled([superseded, replacement])
    await flushPromises()

    expect(authState.authVerificationStatus.value).toBe('verified')
    expect(authState.authVerificationInFlight.value).toBe(false)
    expect(authState.authSession.value).toEqual(authenticatedSession())
    wrapper.unmount()
  })

  it('gates a changed owner while its admission resolves during a background refresh', async () => {
    const nextSession = authenticatedSession('user-2', 8)
    const admissionRefresh = Promise.withResolvers<Response>()
    const sessionRequest = vi
      .fn()
      .mockResolvedValueOnce(HttpResponse.json(authenticatedSession()))
      .mockResolvedValueOnce(HttpResponse.json(nextSession))
    const admissionRequest = vi
      .fn()
      .mockResolvedValueOnce(HttpResponse.json(cacheAdmission()))
      .mockReturnValueOnce(admissionRefresh.promise)
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(sessionApiClient(sessionRequest, admissionRequest))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())!
    await queryCache.fetch(sessionEntry)
    seedAdmissionBoundQueries(queryCache)

    const refreshing = queryCache.fetch(sessionEntry)
    await vi.waitFor(() => expect(authState.authLoading.value).toBe(true))

    expect(authState.authLoading.value).toBe(true)
    expect(authState.authSession.value).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationActivities())).toBeUndefined()

    admissionRefresh.resolve(HttpResponse.json(cacheAdmission({ userId: 'user-2' })))
    await refreshing
    await flushPromises()

    expect(authState.authLoading.value).toBe(false)
    expect(authState.authSession.value).toEqual(nextSession)
    wrapper.unmount()
  })

  it('keeps live private ESI data and the verified session when admission is unreachable', async () => {
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    await queryCache.fetch(sessionEntry!)
    seedAdmissionBoundQueries(queryCache)
    queryServer.use(
      http.get('http://localhost/api/me/cache-admission', () =>
        HttpResponse.json({ code: 'CACHE_ADMISSION_UNAVAILABLE' }, { status: 503 }),
      ),
    )

    await queryCache.fetch(sessionEntry!)
    await flushPromises()

    expect(authState.authUnavailable.value).toBe(false)
    expect(authState.authSession.value).toEqual(authenticatedSession())
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toEqual({
      characterId: 7,
    })
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationActivities())).toEqual({
      activities: [],
    })

    const liveCharacterEntry = queryCache.get(PRIVATE_QUERY_KEYS.characterAssets(7))
    await queryCache.fetch(liveCharacterEntry!)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toEqual({
      characterId: 7,
    })
    wrapper.unmount()
  })

  it.each([
    [
      'character authorization revision',
      { characterRevision: 'character-revision-2' },
      false,
      true,
    ],
    ['organization version', { organizationVersion: 4 }, true, false],
    ['organization revision', { organizationRevision: 'organization-revision-2' }, true, false],
    ['organization access loss', { organization: null }, true, false],
    ['module disablement', { admissionScopes: [] }, true, false],
  ] as const)(
    'removes only data invalidated by %s',
    async (_label, overrides, characterRetained, organizationRetained) => {
      const Host = defineComponent({
        setup() {
          useAuthSession(createApiClient('http://localhost'))
          return () => h('span')
        },
      })
      const { queryCache, wrapper } = mountWithQueryPlugins(Host)
      const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
      await queryCache.fetch(sessionEntry!)
      seedAdmissionBoundQueries(queryCache)
      queryServer.use(
        http.get('http://localhost/api/me/cache-admission', () =>
          HttpResponse.json(cacheAdmission(overrides)),
        ),
      )

      await queryCache.fetch(sessionEntry!)
      await flushPromises()

      expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7)) !== undefined).toBe(
        characterRetained,
      )
      expect(
        queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationActivities()) !== undefined,
      ).toBe(organizationRetained)
      wrapper.unmount()
    },
  )

  it('clears authenticated data on logout', async () => {
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const cancelQueries = vi.spyOn(queryCache, 'cancelQueries')
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    await queryCache.fetch(sessionEntry!)
    seedAdmissionBoundQueries(queryCache)

    await authState.logout()

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationActivities())).toBeUndefined()
    expect(cancelQueries).toHaveBeenCalledWith(
      { exact: true, key: PRIVATE_QUERY_KEYS.session() },
      expect.any(Error),
    )
    wrapper.unmount()
  })

  it('cannot restore authenticated state from a pre-logout session response', async () => {
    let releaseSession!: (response: Response) => void
    const delayedSession = new Promise<Response>((resolve) => {
      releaseSession = resolve
    })
    const sessionRequest = vi
      .fn()
      .mockResolvedValueOnce(HttpResponse.json(authenticatedSession()))
      .mockImplementationOnce(() => delayedSession)
    const apiClient = sessionApiClient(sessionRequest)
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(apiClient)
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    await queryCache.fetch(sessionEntry!)
    await flushPromises()
    expect(authState.authSession.value).toEqual(authenticatedSession())

    const staleVerification = queryCache.fetch(sessionEntry!)
    await vi.waitFor(() => expect(sessionRequest).toHaveBeenCalledTimes(2))
    await authState.logout()
    expect(authState.authSession.value).toEqual(unauthenticatedSession)

    releaseSession(HttpResponse.json(authenticatedSession()))
    await Promise.allSettled([staleVerification])
    await flushPromises()

    expect(authState.authSession.value).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    wrapper.unmount()
  })

  it('clears all private data when an observed authenticated session becomes anonymous', async () => {
    const Host = defineComponent({
      setup() {
        useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    expect(sessionEntry).toBeDefined()
    await queryCache.refresh(sessionEntry!)
    await flushPromises()
    await nextTick()
    seedCharacterQuery(queryCache, 7)
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationCompliance(),
      query: async () => ({ state: 'compliant' }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationCompliance(), { state: 'compliant' })

    queryServer.use(
      http.get('http://localhost/auth/session', () => HttpResponse.json(unauthenticatedSession)),
    )
    await queryCache.fetch(sessionEntry!)
    await flushPromises()
    await nextTick()

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationCompliance())).toBeUndefined()
    wrapper.unmount()
  })

  it('clears prior private data while preserving a newly authenticated user session', async () => {
    const renderedStates: Array<{ hasPriorPrivateData: boolean; userId: string | null }> = []
    const Host = defineComponent({
      setup() {
        const { authSession } = useAuthSession(createApiClient('http://localhost'))
        const queryCache = useQueryCache()
        return () => {
          renderedStates.push({
            hasPriorPrivateData:
              queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7)) !== undefined,
            userId: authSession.value.authenticated ? authSession.value.account.userId : null,
          })
          return h('span')
        }
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    expect(sessionEntry).toBeDefined()
    await queryCache.refresh(sessionEntry!)
    await flushPromises()
    await nextTick()
    seedCharacterQuery(queryCache, 7)
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationRoles(),
      query: async () => ({ grants: [] }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationRoles(), { grants: [] })

    const nextSession = authenticatedSession('user-2', 8)
    queryServer.use(
      http.get('http://localhost/auth/session', () => HttpResponse.json(nextSession)),
      http.get('http://localhost/api/me/cache-admission', () =>
        HttpResponse.json(cacheAdmission({ userId: 'user-2' })),
      ),
    )
    await queryCache.fetch(sessionEntry!)
    await flushPromises()
    await nextTick()

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(nextSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationRoles())).toBeUndefined()
    expect(renderedStates).not.toContainEqual({ hasPriorPrivateData: true, userId: 'user-2' })
    wrapper.unmount()
  })

  it('fails closed and clears private data when session verification denies authentication', async () => {
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    expect(sessionEntry).toBeDefined()
    await queryCache.fetch(sessionEntry!)
    seedCharacterQuery(queryCache, 7)
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationCompliance(),
      query: async () => ({ state: 'compliant' }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationCompliance(), { state: 'compliant' })
    queryServer.use(
      http.get('http://localhost/auth/session', () =>
        HttpResponse.json({ code: 'AUTH_REQUIRED' }, { status: 401 }),
      ),
    )

    await expect(queryCache.fetch(sessionEntry!)).rejects.toThrow('EVE session is unavailable.')
    await flushPromises()
    await nextTick()

    expect(authState.authUnavailable.value).toBe(true)
    expect(authState.authSession.value).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationCompliance())).toBeUndefined()
    wrapper.unmount()
  })

  it('retains gated private data when session verification returns no verdict', async () => {
    let authState!: ReturnType<typeof useAuthSession>
    const Host = defineComponent({
      setup() {
        authState = useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())!
    await queryCache.fetch(sessionEntry)
    seedCharacterQuery(queryCache, 7)
    queryServer.use(
      http.get('http://localhost/auth/session', () =>
        HttpResponse.json({ code: 'RATE_LIMITED' }, { status: 429 }),
      ),
    )

    await expect(queryCache.fetch(sessionEntry)).rejects.toThrow('EVE session is unavailable.')
    await flushPromises()
    await nextTick()

    expect(authState.authUnavailable.value).toBe(true)
    expect(authState.authSession.value).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toEqual({
      characterId: 7,
    })

    queryServer.use(
      http.get('http://localhost/auth/session', () => HttpResponse.json(authenticatedSession())),
    )
    await queryCache.fetch(sessionEntry)
    await flushPromises()

    expect(authState.authUnavailable.value).toBe(false)
    expect(authState.authSession.value).toEqual(authenticatedSession())
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toEqual({
      characterId: 7,
    })
    wrapper.unmount()
  })

  it('cancels removed-character data and purges the broad roster', () => {
    const Host = defineComponent({
      setup() {
        useCharacterRoster(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), {
      characters: [character(7), character(8)],
    })
    seedCharacterQuery(queryCache, 7)
    seedCharacterQuery(queryCache, 8)

    queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), { characters: [character(8)] })

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(8))).toBeDefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.roster())).toBeUndefined()
    wrapper.unmount()
  })
})

function seedCharacterQuery(
  queryCache: ReturnType<typeof mountWithQueryPlugins>['queryCache'],
  characterId: number,
) {
  const key = PRIVATE_QUERY_KEYS.characterAssets(characterId)
  queryCache.ensure({ key, query: async () => ({ characterId }) })
  queryCache.setQueryData(key, { characterId })
}

function seedAdmissionBoundQueries(
  queryCache: ReturnType<typeof mountWithQueryPlugins>['queryCache'],
) {
  const characterKey = PRIVATE_QUERY_KEYS.characterAssets(7)
  queryCache.ensure({
    key: characterKey,
    query: async () => ({ characterId: 7 }),
    meta: { esiPersistence: { kind: 'character-esi', characterId: 7 } },
  })
  queryCache.setQueryData(characterKey, { characterId: 7 })

  const organizationKey = PRIVATE_QUERY_KEYS.organizationActivities()
  queryCache.ensure({
    key: organizationKey,
    query: async () => ({ activities: [] }),
    meta: {
      esiPersistence: { kind: 'organization-esi', admissionScope: ORGANIZATION_SCOPE },
    },
  })
  queryCache.setQueryData(organizationKey, { activities: [] })
}

function authenticatedSession(userId = 'user-1', characterId = 7) {
  return {
    authenticated: true as const,
    account: {
      userId,
      mainCharacter: { characterId, name: String(characterId) },
    },
  }
}

function sessionApiClient(
  sessionRequest: (
    input?: unknown,
    request?: { init?: { signal?: AbortSignal } },
  ) => Promise<Response>,
  admissionRequest: (
    input?: unknown,
    request?: { init?: { signal?: AbortSignal } },
  ) => Promise<Response> = async () => HttpResponse.json(cacheAdmission()),
) {
  return {
    auth: {
      config: {
        $get: async () => HttpResponse.json({ configured: false, loginUrl: '', attachUrl: '' }),
      },
      logout: { $post: async () => new Response(null, { status: 204 }) },
      session: { $get: sessionRequest },
    },
    api: {
      me: {
        'cache-admission': { $get: admissionRequest },
      },
    },
  } as unknown as ApiClient
}

function cacheAdmission(
  overrides: {
    readonly userId?: string
    readonly characterRevision?: string | null
    readonly organizationVersion?: number
    readonly organizationRevision?: string
    readonly admissionScopes?: readonly string[]
    readonly organization?: null
  } = {},
) {
  return {
    userId: overrides.userId ?? 'user-1',
    characters: [
      {
        characterId: 7,
        admissionRevision:
          overrides.characterRevision === undefined
            ? 'character-revision-1'
            : overrides.characterRevision,
      },
    ],
    organization:
      overrides.organization === null
        ? null
        : {
            organizationVersion: overrides.organizationVersion ?? 3,
            admissionRevision: overrides.organizationRevision ?? 'organization-revision-1',
            validUntil: null,
            admissionScopes: overrides.admissionScopes ?? [ORGANIZATION_SCOPE],
          },
  }
}

function character(characterId: number) {
  return {
    characterId,
    name: String(characterId),
    corporationId: 98_000_001,
    allianceId: null,
    isMain: characterId === 7,
    birthday: '2020-01-01T00:00:00.000Z',
    gender: 'Female',
    race: 'Caldari',
    bloodline: 'Deteis',
    securityStatus: 1,
    corporation: { id: 98_000_001, name: 'Corporation', ticker: 'CORP', memberCount: 1 },
    alliance: null,
    location: null,
    ship: null,
    skills: null,
  }
}
