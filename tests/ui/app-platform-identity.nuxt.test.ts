import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidatePrivateQueryScope: vi.fn(),
  providePlatformIdentity: vi.fn(),
  providePlatformQueryPersistence: vi.fn(),
  readQueryPersistenceState: vi.fn(() => ({ value: { kind: 'fresh' } })),
  useHead: vi.fn(),
  usePlatformModulePersistenceLifecycle: vi.fn(),
}))

vi.mock('@eve-space/platform-module-nuxt/runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  providePlatformIdentity: mocks.providePlatformIdentity,
  providePlatformQueryPersistence: mocks.providePlatformQueryPersistence,
}))
vi.mock('../../app/query-persistence/runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  invalidatePrivateQueryScope: mocks.invalidatePrivateQueryScope,
  readQueryPersistenceState: mocks.readQueryPersistenceState,
}))
vi.mock('@pinia/colada-devtools', () => ({ PiniaColadaDevtools: { template: '<div />' } }))
mockNuxtImport(
  'usePlatformModulePersistenceLifecycle',
  () => mocks.usePlatformModulePersistenceLifecycle,
)
mockNuxtImport('useHead', () => mocks.useHead)

import App from '../../app/app.vue'

const wrappers: { unmount(): void }[] = []

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
})

test('registers platform identity and query persistence host seams', async () => {
  const wrapper = await mountSuspended(App, {
    global: {
      stubs: {
        NuxtAnnouncer: true,
        NuxtLayout: { template: '<main><slot /></main>' },
        NuxtPage: true,
        NuxtRouteAnnouncer: true,
        UiProvider: { template: '<div><slot /></div>' },
      },
    },
    route: false,
  })
  wrappers.push(wrapper)

  expect(mocks.providePlatformIdentity).toHaveBeenCalledWith(usePlatformHostIdentity)
  expect(mocks.providePlatformQueryPersistence).toHaveBeenCalledOnce()
  expect(mocks.usePlatformModulePersistenceLifecycle).toHaveBeenCalledOnce()

  const invalidate = mocks.usePlatformModulePersistenceLifecycle.mock.calls[0]?.[0]
  invalidate?.({
    moduleId: 'organization-activity',
    admissionScopes: ['organization:v1:organization-activity:member:organization-activity.view'],
  })

  expect(mocks.invalidatePrivateQueryScope).toHaveBeenCalledWith(expect.anything(), {
    kind: 'organization',
    admissionScope: 'organization:v1:organization-activity:member:organization-activity.view',
  })
})

test('preconnects to the configured API origin and EVE image host', async () => {
  const wrapper = await mountSuspended(App, {
    global: {
      stubs: {
        NuxtAnnouncer: true,
        NuxtLayout: { template: '<main><slot /></main>' },
        NuxtPage: true,
        NuxtRouteAnnouncer: true,
        UiProvider: { template: '<div><slot /></div>' },
      },
    },
    route: false,
  })
  wrappers.push(wrapper)

  const appHead = mocks.useHead.mock.calls.map(([head]) => head()).find((head) => head.link)

  expect(appHead?.link).toEqual(
    expect.arrayContaining([
      {
        rel: 'preconnect',
        href: 'http://localhost:8788',
        crossorigin: 'use-credentials',
      },
      { rel: 'preconnect', href: 'https://images.evetech.net' },
    ]),
  )
})
