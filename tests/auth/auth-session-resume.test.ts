import { flushPromises } from '@vue/test-utils'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const initializeAuth = vi.fn()
const replace = vi.fn()
const authLoading = ref(false)
const authSession = ref({ authenticated: true })
const authUnavailable = ref(false)
const route = { path: '/characters/7', fullPath: '/characters/7?tab=wallet', meta: {} }

beforeAll(async () => {
  vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'http://localhost' } }))
  vi.stubGlobal('createApiClient', () => ({}))
  vi.stubGlobal('useAuthSession', () => ({
    authLoading,
    authSession,
    authUnavailable,
    initializeAuth,
  }))
  const plugin = (await import('../../app/plugins/auth-session-resume.client')).default as unknown
  ;(plugin as { setup: () => void }).setup()
})

beforeEach(() => {
  initializeAuth.mockReset().mockResolvedValue(true)
  replace.mockReset()
  authLoading.value = false
  authSession.value = { authenticated: true }
  authUnavailable.value = false
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
      authUnavailable.value = true
      return false
    })

    globalThis.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(initializeAuth).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
  })
})
