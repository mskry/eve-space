import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ providePlatformIdentity: vi.fn() }))

vi.mock('@eve-space/platform-module-nuxt/runtime', () => ({
  providePlatformIdentity: mocks.providePlatformIdentity,
}))
vi.mock('@pinia/colada-devtools', () => ({ PiniaColadaDevtools: { template: '<div />' } }))

import App from '../../app/app.vue'

const wrappers: { unmount(): void }[] = []

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
})

test('registers the host identity factory for platform modules', async () => {
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
})
