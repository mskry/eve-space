import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthLoginUrl } from '../../app/utils/auth-redirect'

const fetchSession = vi.fn()
const navigateTo = vi.fn()
const onNuxtReady = vi.fn()
const nuxtApp = { isHydrating: false, payload: { serverRendered: true } }
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
  vi.stubGlobal('useNuxtApp', () => nuxtApp)
  authMiddleware = (await import('../../app/middleware/auth.global'))
    .default as typeof authMiddleware
})

beforeEach(() => {
  fetchSession.mockReset()
  navigateTo.mockReset()
  onNuxtReady.mockReset()
  nuxtApp.isHydrating = false
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('authentication route middleware', () => {
  it('restores an authenticated deep link with its query and hash', async () => {
    fetchSession.mockResolvedValue({ authenticated: true })

    await authMiddleware(
      route('/auth?redirect=/characters/7?tab=wallet%23activity', '/auth', {
        redirect: '/characters/7?tab=wallet#activity',
      }),
    )

    expect(navigateTo).toHaveBeenCalledWith('/characters/7?tab=wallet#activity', { replace: true })
  })

  it('sends a newly authenticated capsuleer to the character roster', async () => {
    fetchSession.mockResolvedValue({ authenticated: true })

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
    fetchSession.mockResolvedValue({ authenticated: true })

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

  it('defers an unauthenticated redirect until server-rendered hydration finishes', async () => {
    fetchSession.mockResolvedValue({ authenticated: false })
    nuxtApp.isHydrating = true

    await authMiddleware(route('/', '/'))

    expect(navigateTo).not.toHaveBeenCalled()
    expect(onNuxtReady).toHaveBeenCalledOnce()

    const redirect = onNuxtReady.mock.calls[0]?.[0]
    await redirect()
    expect(navigateTo).toHaveBeenCalledWith({ path: '/auth', query: { redirect: '/' } })
  })

  it('does not require an EVE session for the deployment administrator login', async () => {
    await authMiddleware(route('/admin/login', '/admin/login'))

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

function route(fullPath: string, path: string, query: Record<string, unknown> = {}) {
  return { path, fullPath, query, meta: {} }
}
