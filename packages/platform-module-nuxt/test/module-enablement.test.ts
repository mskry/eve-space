import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, onScopeDispose, ref } from 'vue'
import middleware from '../src/runtime/app/middleware/platform-module-enablement.global.js'
import { usePlatformModuleRuntime } from '../src/runtime/app/composables/usePlatformModuleRuntime.js'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  getEntries: vi.fn(() => []),
  dispose: vi.fn(),
}))
const data = ref<{ enabledModuleIds: string[] }>()

vi.mock('#imports', async () => ({
  computed: (await import('vue')).computed,
  useRuntimeConfig: () => ({ public: { apiBase: 'http://localhost' } }),
  defineNuxtRouteMiddleware: (handler: unknown) => handler,
  createError: (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input),
  abortNavigation: (error: Error) => {
    throw error
  },
}))
vi.mock('@pinia/colada', () => ({
  useQueryCache: () => ({ getEntries: mocks.getEntries }),
  useQuery: () => {
    onScopeDispose(mocks.dispose)
    return { data, refresh: mocks.refresh }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {})
  data.value = undefined
  mocks.refresh.mockImplementation(async () => {
    data.value = { enabledModuleIds: ['alpha'] }
    await nextTick()
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('module enablement middleware scope', () => {
  it('does not retain module-disabling watchers across navigations', async () => {
    for (let navigation = 0; navigation < 5; navigation += 1) {
      await middleware({ meta: { platformModuleId: 'alpha' } } as never, {} as never)
    }
    expect(mocks.dispose).toHaveBeenCalledTimes(5)
    data.value = { enabledModuleIds: [] }
    await nextTick()
    expect(mocks.getEntries).not.toHaveBeenCalled()
  })

  it.each([404, 503])('disposes effects when navigation fails with %s', async (statusCode) => {
    if (statusCode === 503) mocks.refresh.mockRejectedValueOnce(new Error('Unavailable'))
    else
      mocks.refresh.mockImplementationOnce(async () => {
        data.value = { enabledModuleIds: [] }
      })

    await expect(
      middleware({ meta: { platformModuleId: 'alpha' } } as never, {} as never),
    ).rejects.toMatchObject({ statusCode })
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('keeps component-owned invalidation active until its scope is stopped', async () => {
    const scope = effectScope()
    try {
      const runtime = scope.run(usePlatformModuleRuntime)!
      await runtime.ensureRuntimeState()
      data.value = { enabledModuleIds: [] }
      await nextTick()
      expect(mocks.getEntries).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
    data.value = { enabledModuleIds: ['alpha'] }
    await nextTick()
    data.value = { enabledModuleIds: [] }
    await nextTick()
    expect(mocks.getEntries).toHaveBeenCalledOnce()
  })
})

describe('module enablement server navigation', () => {
  beforeEach(() => vi.stubGlobal('window', undefined))

  it('skips routes without a module identity', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await middleware({ meta: {} } as never, {} as never)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'checks server enablement before rendering (enabled: %s)',
    async (enabled) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ enabledModuleIds: enabled ? ['alpha'] : [] }))
      vi.stubGlobal('fetch', fetch)
      const navigation = middleware({ meta: { platformModuleId: 'alpha' } } as never, {} as never)
      const outcome = await Promise.resolve(navigation).then(
        () => 'allowed',
        (error: { statusCode: number }) => error.statusCode,
      )
      expect(outcome).toBe(enabled ? 'allowed' : 404)
      expect(fetch).toHaveBeenCalledWith('http://localhost/api/modules', {
        credentials: 'include',
        signal: undefined,
      })
      expect(mocks.refresh).not.toHaveBeenCalled()
    },
  )

  it.each(['network', 'http', 'json'])('fails closed on %s failures', async (failure) => {
    const fetch = vi.fn()
    if (failure === 'network') fetch.mockRejectedValue(new Error('Offline'))
    else
      fetch.mockResolvedValue(new Response('invalid', { status: failure === 'http' ? 503 : 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      middleware({ meta: { platformModuleId: 'alpha' } } as never, {} as never),
    ).rejects.toMatchObject({ statusCode: 503 })
  })
})
