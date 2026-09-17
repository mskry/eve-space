import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, onScopeDispose, ref } from 'vue'
import middleware from '../src/runtime/app/middleware/platform-module-enablement.global.js'
import {
  usePlatformModulePersistenceLifecycle,
  usePlatformModuleRuntime,
} from '../src/runtime/app/composables/usePlatformModuleRuntime.js'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  getEntries: vi.fn(() => [] as { key: (number | string)[] }[]),
  cancel: vi.fn(),
  remove: vi.fn(),
  invalidateQueryPersistence: vi.fn(),
  dispose: vi.fn(),
}))
const data = ref<{
  enabledModuleIds: string[]
  enabledSections: {
    moduleId: string
    sectionId: string
    kind: 'workspace' | 'sensitive-evidence' | 'access-management'
    disclosureVersion: number
    activationVersion: number
  }[]
}>()

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
  useQueryCache: () => ({
    getEntries: mocks.getEntries,
    cancel: mocks.cancel,
    remove: mocks.remove,
  }),
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
    data.value = { enabledModuleIds: ['alpha'], enabledSections: [] }
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
    data.value = { enabledModuleIds: [], enabledSections: [] }
    await nextTick()
    expect(mocks.getEntries).not.toHaveBeenCalled()
  })

  it.each([404, 503])('disposes effects when navigation fails with %s', async (statusCode) => {
    if (statusCode === 503) mocks.refresh.mockRejectedValueOnce(new Error('Unavailable'))
    else
      mocks.refresh.mockImplementationOnce(async () => {
        data.value = { enabledModuleIds: [], enabledSections: [] }
      })

    await expect(
      middleware({ meta: { platformModuleId: 'alpha' } } as never, {} as never),
    ).rejects.toMatchObject({ statusCode })
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('requires the route section without exposing sibling sections', async () => {
    mocks.refresh.mockImplementation(async () => {
      data.value = {
        enabledModuleIds: ['alpha'],
        enabledSections: [enabledSection('assets')],
      }
    })

    await expect(
      middleware(
        { meta: { platformModuleId: 'alpha', platformModuleSectionId: 'skills' } } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 404 })

    mocks.refresh.mockImplementation(async () => {
      data.value = {
        enabledModuleIds: ['alpha'],
        enabledSections: [enabledSection('skills')],
      }
    })
    await expect(
      middleware(
        { meta: { platformModuleId: 'alpha', platformModuleSectionId: 'skills' } } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined()
  })

  it('keeps the app-owned persistence lifecycle active until its scope is stopped', async () => {
    const scope = effectScope()
    try {
      const runtime = scope.run(() => {
        const value = usePlatformModuleRuntime()
        usePlatformModulePersistenceLifecycle(mocks.invalidateQueryPersistence)
        return value
      })!
      await runtime.ensureRuntimeState()
      data.value = { enabledModuleIds: [], enabledSections: [] }
      await nextTick()
      expect(mocks.getEntries).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
    data.value = { enabledModuleIds: ['alpha'], enabledSections: [] }
    await nextTick()
    data.value = { enabledModuleIds: [], enabledSections: [] }
    await nextTick()
    expect(mocks.getEntries).toHaveBeenCalledOnce()
  })

  it('synchronously invalidates each generated scope once before removing disabled module entries', () => {
    const alphaEntry = {
      key: ['private', 'organization', 3, 'modules', 'alpha', 'summary'],
    }
    const unrelatedEntry = {
      key: ['private', 'organization', 3, 'modules', 'beta', 'summary'],
    }
    mocks.getEntries.mockReturnValue([alphaEntry, unrelatedEntry])
    const scope = effectScope()
    try {
      scope.run(() => usePlatformModulePersistenceLifecycle(mocks.invalidateQueryPersistence))
      data.value = { enabledModuleIds: ['alpha'], enabledSections: [] }

      data.value = { enabledModuleIds: [], enabledSections: [] }

      expect(mocks.invalidateQueryPersistence).toHaveBeenCalledOnce()
      expect(mocks.invalidateQueryPersistence).toHaveBeenCalledWith({
        admissionScopes: ['organization:v1:alpha:member:alpha.view'],
        moduleId: 'alpha',
      })
      expect(mocks.invalidateQueryPersistence.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.getEntries.mock.invocationCallOrder[0]!,
      )
      expect(mocks.cancel).toHaveBeenCalledWith(
        alphaEntry,
        expect.objectContaining({ message: 'Protected query state cleared.' }),
      )
      expect(mocks.remove).toHaveBeenCalledWith(alphaEntry)
      expect(mocks.remove).not.toHaveBeenCalledWith(unrelatedEntry)
    } finally {
      scope.stop()
    }
  })

  it('invalidates a module that was enabled before the lifecycle watcher was installed', () => {
    data.value = { enabledModuleIds: ['alpha'], enabledSections: [] }
    const scope = effectScope()
    try {
      scope.run(() => usePlatformModulePersistenceLifecycle(mocks.invalidateQueryPersistence))

      data.value = { enabledModuleIds: [], enabledSections: [] }

      expect(mocks.invalidateQueryPersistence).toHaveBeenCalledWith({
        admissionScopes: ['organization:v1:alpha:member:alpha.view'],
        moduleId: 'alpha',
      })
      expect(mocks.getEntries).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
  })

  it('invalidates only disabled section scopes and section-keyed queries', () => {
    const skillsEntry = {
      key: ['private', 'organization', 3, 'modules', 'alpha', 'sections', 'skills', 'detail'],
    }
    const assetsEntry = {
      key: ['private', 'organization', 3, 'modules', 'alpha', 'sections', 'assets', 'detail'],
    }
    mocks.getEntries.mockReturnValue([skillsEntry, assetsEntry])
    data.value = {
      enabledModuleIds: ['alpha'],
      enabledSections: [enabledSection('skills'), enabledSection('assets')],
    }
    const scope = effectScope()
    try {
      scope.run(() => usePlatformModulePersistenceLifecycle(mocks.invalidateQueryPersistence))

      data.value = {
        enabledModuleIds: ['alpha'],
        enabledSections: [enabledSection('assets')],
      }

      expect(mocks.invalidateQueryPersistence).toHaveBeenCalledOnce()
      expect(mocks.invalidateQueryPersistence).toHaveBeenCalledWith({
        admissionScopes: ['organization:v1:alpha:member:alpha.view'],
        moduleId: 'alpha',
      })
      expect(mocks.remove).toHaveBeenCalledWith(skillsEntry)
      expect(mocks.remove).not.toHaveBeenCalledWith(assetsEntry)
    } finally {
      scope.stop()
    }
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
        .mockResolvedValue(
          Response.json({ enabledModuleIds: enabled ? ['alpha'] : [], enabledSections: [] }),
        )
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

function enabledSection(sectionId: string) {
  return {
    moduleId: 'alpha',
    sectionId,
    kind: 'sensitive-evidence' as const,
    disclosureVersion: 1,
    activationVersion: 1,
  }
}
