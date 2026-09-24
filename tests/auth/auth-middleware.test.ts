import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthLoginUrl } from '../../app/utils/auth-redirect'

const initialize = vi.hoisted(() => vi.fn())
vi.mock('../../app/composables/useAuthSessionInitialization', () => ({
  useAuthSessionInitialization: () => ({ initialize }),
}))

const navigateTo = vi.fn()
const onNuxtReady = vi.fn()
const nuxtApp = { isHydrating: false, payload: { serverRendered: true } }
const currentRoute = { value: { fullPath: '/' } }
let authMiddleware: (to: ReturnType<typeof route>) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: typeof authMiddleware) => middleware)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'http://localhost' } }))
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('onNuxtReady', onNuxtReady)
  vi.stubGlobal('useRouter', () => ({ currentRoute }))
  vi.stubGlobal('useNuxtApp', () => nuxtApp)
  authMiddleware = (await import('../../app/middleware/auth.global'))
    .default as typeof authMiddleware
})

beforeEach(() => {
  initialize.mockReset().mockResolvedValue({ authenticated: true })
  navigateTo.mockReset()
  onNuxtReady.mockReset()
  nuxtApp.isHydrating = false
  currentRoute.value = { fullPath: '/' }
})

afterAll(() => vi.unstubAllGlobals())

describe('authentication route middleware', () => {
  it('restores an authenticated deep link with its query and hash', async () => {
    await authMiddleware(
      route('/auth?redirect=/characters/7?tab=wallet%23activity', '/auth', {
        redirect: '/characters/7?tab=wallet#activity',
      }),
    )
    expect(navigateTo).toHaveBeenCalledWith('/characters/7?tab=wallet#activity', { replace: true })
  })

  it.each(['https://example.com/characters/7', '//example.com/characters/7', undefined])(
    'uses the character roster for invalid or missing login redirect %s',
    async (redirect) => {
      await authMiddleware(route('/auth', '/auth', { redirect }))
      expect(navigateTo).toHaveBeenCalledWith('/characters', { replace: true })
    },
  )

  it('preserves an anonymous protected deep link for login', async () => {
    initialize.mockResolvedValue({ authenticated: false })
    await authMiddleware(route('/characters/7?tab=wallet#activity', '/characters/7'))
    expect(navigateTo).toHaveBeenCalledWith({
      path: '/auth',
      query: { redirect: '/characters/7?tab=wallet#activity' },
    })
  })

  it.each(['https://example.com/characters/7', '//example.com/characters/7'])(
    'does not retain unsafe return path %s',
    async (fullPath) => {
      initialize.mockResolvedValue({ authenticated: false })
      await authMiddleware(route(fullPath, '/characters/7'))
      expect(navigateTo).toHaveBeenCalledWith({ path: '/auth' })
    },
  )

  it('allows anonymous users to remain on the authorization page', async () => {
    initialize.mockResolvedValue({ authenticated: false })
    await authMiddleware(route('/auth', '/auth'))
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('requests current verification through the shared initializer for protected navigation', async () => {
    await authMiddleware(route('/characters', '/characters'))
    expect(initialize).toHaveBeenCalledExactlyOnceWith(true)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('keeps the route when initialization has no accepted session verdict', async () => {
    initialize.mockResolvedValue(undefined)
    await authMiddleware(route('/characters', '/characters'))
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('reuses hydration initialization after Nuxt is ready', async () => {
    initialize.mockResolvedValue({ authenticated: false })
    nuxtApp.isHydrating = true
    await authMiddleware(route('/', '/'))
    expect(initialize).not.toHaveBeenCalled()
    expect(onNuxtReady).toHaveBeenCalledOnce()
    onNuxtReady.mock.calls[0]![0]()
    await vi.waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith({ path: '/auth', query: { redirect: '/' } }),
    )
    expect(initialize).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('discards deferred verification after navigation leaves the original route', async () => {
    nuxtApp.isHydrating = true
    await authMiddleware(route('/characters', '/characters'))
    currentRoute.value = { fullPath: '/settings/integrations' }
    onNuxtReady.mock.calls[0]![0]()
    expect(initialize).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it.each(['/admin', '/admin/login'])(
    'keeps deployment administration independent at %s',
    async (path) => {
      await authMiddleware(route(path, path))
      expect(initialize).not.toHaveBeenCalled()
    },
  )

  it.each(['/', '/settings/integrations'])(
    'does not initialize member authentication on public route %s',
    async (path) => {
      await authMiddleware(route(path, path, {}, { platformAudience: 'public' }))
      expect(initialize).not.toHaveBeenCalled()
    },
  )

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
  return { fullPath, meta, path, query }
}
