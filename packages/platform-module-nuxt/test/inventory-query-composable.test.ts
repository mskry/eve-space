// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp, ref, type App } from 'vue'
import { usePlatformInventoryQuery } from '../src/runtime/app/composables/usePlatformInventoryQuery.js'

const mocks = vi.hoisted(() => ({
  ensureRuntimeState: vi.fn(),
  usePlatformIdentity: vi.fn(),
  usePlatformModuleRuntime: vi.fn(),
}))
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ public: { apiBase: 'https://api.example.test' } }),
}))
vi.mock('../src/runtime/identity.js', () => ({
  usePlatformIdentity: mocks.usePlatformIdentity,
}))
vi.mock('../src/runtime/app/composables/usePlatformModuleRuntime.js', () => ({
  usePlatformModuleRuntime: mocks.usePlatformModuleRuntime,
}))

const admission = () =>
  Response.json({ ownerId: 'owner-a', fingerprint: 'a'.repeat(64), validForMilliseconds: 60_000 })
let app: App | undefined

beforeEach(() => {
  vi.useFakeTimers()
  mocks.ensureRuntimeState.mockResolvedValue(undefined)
  mocks.usePlatformIdentity.mockReturnValue({
    privateIdentity: ref({ ownerId: 'owner-a', status: 'verified', revision: 1 }),
  })
  mocks.usePlatformModuleRuntime.mockReturnValue({
    enabledModuleIds: ref(new Set(['trading'])),
    ensureRuntimeState: mocks.ensureRuntimeState,
  })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

test.each(['timer', 'focus', 'online'])(
  '%s renewal keeps holdings visible through runtime and inventory admission checks',
  async (trigger) => {
    const fetch = vi.fn().mockResolvedValue(admission())
    vi.stubGlobal('fetch', fetch)
    const load = vi.fn().mockResolvedValue('private holdings')
    let query!: ReturnType<typeof usePlatformInventoryQuery<string>>
    app = createApp({
      setup: () => {
        query = usePlatformInventoryQuery({ selection: { scope: 'personal' }, load })
        return () => null
      },
    })
    app.mount(document.createElement('div'))
    await vi.advanceTimersByTimeAsync(0)
    expect(query.data.value).toBe('private holdings')

    const runtime = Promise.withResolvers<void>()
    const renewal = Promise.withResolvers<Response>()
    mocks.ensureRuntimeState.mockReturnValueOnce(runtime.promise)
    fetch.mockReturnValueOnce(renewal.promise)
    load.mockResolvedValueOnce('renewed holdings')
    if (trigger === 'timer') await vi.advanceTimersByTimeAsync(45_000)
    else {
      await vi.advanceTimersByTimeAsync(30_000)
      globalThis.dispatchEvent(new Event(trigger))
    }
    expect(query.data.value).toBe('private holdings')
    runtime.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(query.data.value).toBe('private holdings')
    renewal.resolve(admission())
    await vi.advanceTimersByTimeAsync(0)
    expect(query.data.value).toBe('renewed holdings')
  },
)
