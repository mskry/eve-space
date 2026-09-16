import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthLoginUrl } from '../../app/utils/auth-redirect'
import { queryServer } from '../support/query-server'

const persistenceMocks = vi.hoisted(() => ({
  applyVerifiedQueryIdentity: vi.fn(),
  installQueryPersistence: vi.fn(() => () => undefined),
  invalidatePrivateQueryScope: vi.fn().mockResolvedValue(true),
  suspendPrivateQueryAdmission: vi.fn(),
}))

vi.mock('../../app/query-persistence/runtime', () => persistenceMocks)

const fetchSession = vi.fn()
let admissionRequests = 0
const navigateTo = vi.fn()
const onNuxtReady = vi.fn()
const nuxtApp = { isHydrating: false, payload: { serverRendered: true } }
const currentRoute = { value: { fullPath: '/' } }
const nuxtState = new Map<string, { value: unknown }>()
const sessionEntry = { ext: retryExtensions(), key: ['private', 'session'] }
const privateEntry = { ext: retryExtensions(), key: ['private', 'characters', 7, 'wallet'] }
const queryCache = {
  cancelQueries: vi.fn(),
  extend: vi.fn(),
  get: vi.fn(),
  getEntries: vi.fn(),
  getQueryData: vi.fn(),
  remove: vi.fn(),
  setQueryData: vi.fn(),
}
let authMiddleware: (to: {
  path: string
  fullPath: string
  query: Record<string, unknown>
  meta: Record<string, unknown>
}) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: typeof authMiddleware) => middleware)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'http://localhost' } }))
  vi.stubGlobal('$fetch', fetchSession)
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('onNuxtReady', onNuxtReady)
  vi.stubGlobal('useRouter', () => ({ currentRoute }))
  vi.stubGlobal('readonly', (value: unknown) => value)
  vi.stubGlobal('useNuxtApp', () => nuxtApp)
  vi.stubGlobal('useQueryCache', () => queryCache)
  vi.stubGlobal('useState', (key: string, initialize: () => unknown) => {
    const existing = nuxtState.get(key)
    if (existing) return existing
    const state = { value: initialize() }
    nuxtState.set(key, state)
    return state
  })
  authMiddleware = (await import('../../app/middleware/auth.global'))
    .default as typeof authMiddleware
})

beforeEach(() => {
  fetchSession.mockReset()
  navigateTo.mockReset()
  onNuxtReady.mockReset()
  nuxtApp.isHydrating = false
  currentRoute.value = { fullPath: '/' }
  nuxtState.clear()
  persistenceMocks.applyVerifiedQueryIdentity
    .mockReset()
    .mockImplementation(
      async (
        cache: typeof queryCache,
        session: ReturnType<typeof authenticatedSession> | { authenticated: false },
        loadAdmission?: () => Promise<unknown>,
      ) => {
        const previous = cache.getQueryData() as ReturnType<typeof authenticatedSession> | undefined
        const previousOwner = previous?.authenticated ? previous.account.userId : null
        const nextOwner = session.authenticated ? session.account.userId : null
        if (nextOwner === null || (previousOwner !== null && previousOwner !== nextOwner)) {
          for (const entry of cache.getEntries()) {
            if (entry === sessionEntry) continue
            cache.cancelQueries({ exact: true, key: entry.key }, new Error('Identity changed.'))
            cache.remove(entry)
          }
        }
        cache.setQueryData(['private', 'session'], session)
        if (session.authenticated) {
          try {
            await loadAdmission?.()
          } catch {
            return false
          }
        }
        return true
      },
    )
  persistenceMocks.invalidatePrivateQueryScope.mockClear()
  persistenceMocks.suspendPrivateQueryAdmission.mockClear()
  queryCache.cancelQueries.mockReset()
  queryCache.get.mockReset().mockReturnValue(sessionEntry)
  queryCache.getEntries.mockReset().mockReturnValue([sessionEntry])
  queryCache.getQueryData.mockReset().mockReturnValue(undefined)
  queryCache.remove.mockReset()
  queryCache.setQueryData.mockReset()
  admissionRequests = 0
  queryServer.use(
    http.get('http://localhost/api/me/cache-admission', () => {
      admissionRequests += 1
      return HttpResponse.json(cacheAdmission())
    }),
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('authentication route middleware', () => {
  it('restores an authenticated deep link with its query and hash', async () => {
    fetchSession.mockResolvedValue(authenticatedSession())

    await authMiddleware(
      route('/auth?redirect=/characters/7?tab=wallet%23activity', '/auth', {
        redirect: '/characters/7?tab=wallet#activity',
      }),
    )

    expect(navigateTo).toHaveBeenCalledWith('/characters/7?tab=wallet#activity', { replace: true })
  })

  it('sends a newly authenticated capsuleer to the character roster', async () => {
    fetchSession.mockResolvedValue(authenticatedSession())

    await authMiddleware(route('/auth?auth=success', '/auth', { auth: 'success' }))

    expect(navigateTo).toHaveBeenCalledWith('/characters', { replace: true })
  })

  it.each([
    ['an external URL', 'https://example.com/characters/7'],
    ['a protocol-relative URL', '//example.com/characters/7'],
    ['an encoded authorization route', '/%61uth'],
    ['a repeated redirect parameter', ['/characters/7', '/corporations/8']],
    ['the authorization route', '/auth'],
  ])('falls back to the character roster for %s', async (_label, redirect) => {
    fetchSession.mockResolvedValue(authenticatedSession())

    await authMiddleware(route('/auth', '/auth', { redirect }))

    expect(navigateTo).toHaveBeenCalledWith('/characters', { replace: true })
  })

  it('captures the requested deep link when authentication is required', async () => {
    fetchSession.mockResolvedValue({ authenticated: false })

    await authMiddleware(route('/characters/7?tab=wallet', '/characters/7'))

    expect(navigateTo).toHaveBeenCalledWith({
      path: '/auth',
      query: { redirect: '/characters/7?tab=wallet' },
    })
  })

  it.each(['/', '/settings/integrations'])(
    'allows anonymous navigation to canonical public route %s',
    async (path) => {
      nuxtApp.isHydrating = true

      await authMiddleware(route(path, path, {}, { platformAudience: 'public' }))

      expect(fetchSession).not.toHaveBeenCalled()
      expect(navigateTo).not.toHaveBeenCalled()
      expect(onNuxtReady).not.toHaveBeenCalled()
    },
  )

  it('allows authenticated navigation to a protected route', async () => {
    fetchSession.mockResolvedValue(authenticatedSession())

    await authMiddleware(route('/characters', '/characters'))

    expect(fetchSession).toHaveBeenCalledOnce()
    expect(fetchSession).toHaveBeenCalledWith(
      'http://localhost/auth/session',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    )
    expect(admissionRequests).toBe(1)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('keeps the verified identity visible while a protected navigation rechecks the session', async () => {
    const verification = Promise.withResolvers<ReturnType<typeof authenticatedSession>>()
    queryCache.getQueryData.mockReturnValue(authenticatedSession())
    nuxtState.set('auth-verification-state', {
      value: { generation: 1, status: 'verified' },
    })
    fetchSession.mockReturnValue(verification.promise)

    const navigation = authMiddleware(route('/characters/7/skills', '/characters/7/skills'))

    expect(nuxtState.get('auth-verification-state')?.value).toEqual({
      generation: 2,
      status: 'refreshing',
    })
    verification.resolve(authenticatedSession())
    await navigation

    expect(nuxtState.get('auth-verification-state')?.value).toEqual({
      generation: 2,
      status: 'verified',
    })
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('applies the verified identity through query persistence', async () => {
    fetchSession.mockResolvedValue(authenticatedSession())

    await authMiddleware(route('/characters', '/characters'))

    expect(persistenceMocks.applyVerifiedQueryIdentity).toHaveBeenCalledWith(
      queryCache,
      authenticatedSession(),
      expect.any(Function),
      undefined,
    )
  })

  it('keeps a verified session valid when cache admission is unavailable', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/cache-admission', () => {
        admissionRequests += 1
        return HttpResponse.json({ code: 'CACHE_ADMISSION_UNAVAILABLE' }, { status: 503 })
      }),
    )
    fetchSession.mockResolvedValue(authenticatedSession())

    await authMiddleware(route('/characters', '/characters'))

    expect(admissionRequests).toBe(1)
    expect(navigateTo).not.toHaveBeenCalled()
    expect(nuxtState.get('auth-verification-state')?.value).toEqual({
      generation: 1,
      status: 'verified',
    })
    expect(queryCache.setQueryData).toHaveBeenCalledWith(
      ['private', 'session'],
      authenticatedSession(),
    )
  })

  it('keeps the protected shell mounted and retains gated private state when verification is unreachable', async () => {
    queryCache.getQueryData.mockReturnValue(authenticatedSession())
    queryCache.getEntries.mockReturnValue([sessionEntry, privateEntry])
    fetchSession.mockRejectedValue(new TypeError('fetch failed'))

    await authMiddleware(route('/characters', '/characters'))

    expect(navigateTo).not.toHaveBeenCalled()
    expect(onNuxtReady).not.toHaveBeenCalled()
    expect(persistenceMocks.suspendPrivateQueryAdmission).toHaveBeenCalledWith(queryCache)
    expect(persistenceMocks.invalidatePrivateQueryScope).not.toHaveBeenCalled()
    expect(queryCache.cancelQueries).not.toHaveBeenCalled()
    expect(queryCache.remove).not.toHaveBeenCalled()
    expect(queryCache.setQueryData).not.toHaveBeenCalled()
    expect(nuxtState.get('auth-verification-state')?.value).toEqual({
      generation: 1,
      status: 'unavailable',
    })
  })

  it('clears private state before accepting a different session owner', async () => {
    queryCache.getQueryData.mockReturnValue(authenticatedSession('user-1'))
    queryCache.getEntries.mockReturnValue([sessionEntry, privateEntry])
    fetchSession.mockResolvedValue(authenticatedSession('user-2'))

    await authMiddleware(route('/characters', '/characters'))

    expect(queryCache.remove).toHaveBeenCalledWith(privateEntry)
    expect(queryCache.setQueryData).toHaveBeenCalledWith(
      ['private', 'session'],
      authenticatedSession('user-2'),
    )
    expect(nuxtState.get('auth-verification-state')?.value).toEqual({
      generation: 1,
      status: 'verified',
    })
  })

  it('retains restored character data after verifying the same session owner', async () => {
    queryCache.getQueryData.mockReturnValue(authenticatedSession('user-1'))
    queryCache.getEntries.mockReturnValue([privateEntry])
    fetchSession.mockResolvedValue(authenticatedSession('user-1'))

    await authMiddleware(route('/characters/7', '/characters/7'))

    expect(queryCache.remove).not.toHaveBeenCalled()
    expect(queryCache.setQueryData).toHaveBeenCalledWith(
      ['private', 'session'],
      authenticatedSession('user-1'),
    )
  })

  it('ignores a session response superseded by a newer route verification', async () => {
    let releaseSession!: (session: ReturnType<typeof authenticatedSession>) => void
    const delayedSession = new Promise<ReturnType<typeof authenticatedSession>>((resolve) => {
      releaseSession = resolve
    })
    fetchSession
      .mockImplementationOnce(() => delayedSession)
      .mockResolvedValueOnce({ authenticated: false })

    const staleVerification = authMiddleware(route('/characters', '/characters'))
    await vi.waitFor(() => expect(fetchSession).toHaveBeenCalledOnce())
    await authMiddleware(route('/characters', '/characters'))
    releaseSession(authenticatedSession())
    await staleVerification

    expect(persistenceMocks.applyVerifiedQueryIdentity).toHaveBeenCalledOnce()
    expect(persistenceMocks.applyVerifiedQueryIdentity).toHaveBeenCalledWith(
      queryCache,
      { authenticated: false },
      expect.any(Function),
      undefined,
    )
    expect(queryCache.setQueryData).not.toHaveBeenCalledWith(
      ['private', 'session'],
      authenticatedSession(),
    )
  })

  it.each(['https://example.com/characters/7', '//example.com/characters/7'])(
    'does not retain unsafe return path %s',
    async (fullPath) => {
      fetchSession.mockResolvedValue({ authenticated: false })

      await authMiddleware(route(fullPath, '/characters/7'))

      expect(navigateTo).toHaveBeenCalledWith({ path: '/auth' })
    },
  )

  it('defers session verification and redirects until server-rendered hydration finishes', async () => {
    fetchSession.mockResolvedValue({ authenticated: false })
    nuxtApp.isHydrating = true

    await authMiddleware(route('/', '/'))

    expect(fetchSession).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
    expect(queryCache.setQueryData).not.toHaveBeenCalled()
    expect(onNuxtReady).toHaveBeenCalledOnce()

    const redirect = onNuxtReady.mock.calls[0]?.[0]
    redirect()
    await vi.waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith({ path: '/auth', query: { redirect: '/' } })
    })
  })

  it('discards deferred verification after navigation leaves the original route', async () => {
    nuxtApp.isHydrating = true

    await authMiddleware(route('/characters', '/characters'))
    currentRoute.value = { fullPath: '/settings/integrations' }
    const verify = onNuxtReady.mock.calls[0]?.[0]
    verify()

    expect(fetchSession).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('does not require an EVE session for the deployment administrator login', async () => {
    await authMiddleware(route('/admin/login', '/admin/login'))

    expect(fetchSession).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('keeps deployment administration independent from the EVE member session', async () => {
    await authMiddleware(route('/admin', '/admin'))

    expect(fetchSession).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('adds the deep link to the EVE login URL', () => {
    expect(
      getAuthLoginUrl('http://localhost:8788/auth/eve/start', '/characters/7?tab=wallet#activity'),
    ).toBe(
      'http://localhost:8788/auth/eve/start?returnTo=%2Fcharacters%2F7%3Ftab%3Dwallet%23activity',
    )
  })
})

function route(
  fullPath: string,
  path: string,
  query: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
) {
  return { path, fullPath, query, meta }
}

function authenticatedSession(userId = 'user-1') {
  return {
    authenticated: true as const,
    account: {
      userId,
      mainCharacter: { characterId: 7, name: 'Test Pilot' },
    },
  }
}

function cacheAdmission() {
  return {
    userId: 'user-1',
    characters: [{ characterId: 7, admissionRevision: 'character-revision-1' }],
    organization: null,
  }
}

function retryExtensions() {
  return {
    isRetrying: { value: false },
    retryCount: { value: 0 },
    retryError: { value: null },
  }
}
