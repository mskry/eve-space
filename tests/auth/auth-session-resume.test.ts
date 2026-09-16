import { flushPromises } from '@vue/test-utils'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const initializeAuth = vi.fn()
const replace = vi.fn()
const authSession = ref({ authenticated: true })
const authVerificationInFlight = ref(false)
const authVerificationStatus = ref<
  'idle' | 'verifying' | 'refreshing' | 'verified' | 'unavailable'
>('verified')
const route: { fullPath: string; meta: Record<string, unknown>; path: string } = {
  path: '/characters/7',
  fullPath: '/characters/7?tab=wallet',
  meta: {},
}

beforeAll(async () => {
  vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'http://localhost' } }))
  vi.stubGlobal('createApiClient', () => ({}))
  vi.stubGlobal('useAuthSession', () => ({
    authSession,
    authVerificationInFlight,
    authVerificationStatus,
    initializeAuth,
  }))
  const plugin = (await import('../../app/plugins/auth-session-resume.client')).default as unknown
  ;(plugin as { setup: () => void }).setup()
})

beforeEach(() => {
  initializeAuth.mockReset().mockResolvedValue(true)
  replace.mockReset()
  authSession.value = { authenticated: true }
  authVerificationInFlight.value = false
  authVerificationStatus.value = 'verified'
  route.path = '/characters/7'
  route.fullPath = '/characters/7?tab=wallet'
  route.meta = {}
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('auth session resume plugin', () => {
  it('reuses a fresh session verification when the tab regains focus', async () => {
    globalThis.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(initializeAuth).toHaveBeenCalledOnce()
    expect(initializeAuth).toHaveBeenCalledWith()
    expect(replace).not.toHaveBeenCalled()
  })

  it('redirects to login when the resumed session is no longer authenticated', async () => {
    initializeAuth.mockImplementation(async () => {
      authSession.value = { authenticated: false }
      authVerificationStatus.value = 'verified'
      return false
    })

    globalThis.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(replace).toHaveBeenCalledWith({
      path: '/auth',
      query: { redirect: '/characters/7?tab=wallet' },
    })
  })

  it('keeps the current page when session verification has no verdict', async () => {
    initializeAuth.mockImplementation(async () => {
      authSession.value = { authenticated: false }
      authVerificationStatus.value = 'unavailable'
      return false
    })

    globalThis.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(initializeAuth).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not overlap a verification already in flight', async () => {
    authVerificationInFlight.value = true
    authVerificationStatus.value = 'verifying'

    globalThis.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(initializeAuth).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('retries after an orphaned verification has settled as unavailable', async () => {
    authSession.value = { authenticated: false }
    authVerificationStatus.value = 'unavailable'
    initializeAuth.mockImplementation(async () => {
      authSession.value = { authenticated: true }
      authVerificationStatus.value = 'verified'
      return true
    })

    globalThis.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(initializeAuth).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not redirect after navigation leaves the protected route during verification', async () => {
    const verification = Promise.withResolvers<boolean>()
    initializeAuth.mockImplementation(async () => {
      const authenticated = await verification.promise
      authSession.value = { authenticated }
      authVerificationStatus.value = 'verified'
      return authenticated
    })

    globalThis.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(initializeAuth).toHaveBeenCalledOnce())
    route.path = '/settings/integrations'
    route.fullPath = '/settings/integrations'
    route.meta = { platformAudience: 'public' }
    verification.resolve(false)
    await flushPromises()

    expect(replace).not.toHaveBeenCalled()
  })
})
