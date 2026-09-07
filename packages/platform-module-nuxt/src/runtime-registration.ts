import { addComponent, addImports, addRouteMiddleware, createResolver } from '@nuxt/kit'

export function registerPlatformRuntime() {
  const resolver = createResolver(import.meta.url)
  addImports([
    {
      name: 'providePlatformConfirmDialog',
      from: resolver.resolve('./runtime/confirm-dialog'),
    },
    {
      name: 'usePlatformConfirmDialog',
      from: resolver.resolve('./runtime/confirm-dialog'),
    },
    {
      name: 'usePlatformApi',
      from: resolver.resolve('./runtime/app/composables/usePlatformApi'),
    },
    {
      name: 'usePlatformEveImages',
      from: resolver.resolve('./runtime/app/composables/usePlatformEveImages'),
    },
    {
      name: 'usePlatformModuleRuntime',
      from: resolver.resolve('./runtime/app/composables/usePlatformModuleRuntime'),
    },
    {
      name: 'usePlatformMutationAnnouncement',
      from: resolver.resolve('./runtime/app/composables/usePlatformMutationAnnouncement'),
    },
    {
      name: 'usePlatformNavigation',
      from: resolver.resolve('./runtime/app/composables/usePlatformNavigation'),
    },
    {
      name: 'usePlatformProtectedQuery',
      from: resolver.resolve('./runtime/app/composables/usePlatformProtectedQuery'),
    },
  ])
  for (const name of [
    'PlatformAuthorizationRequired',
    'PlatformEveImage',
    'PlatformPagination',
    'PlatformResourceBoundary',
  ]) {
    addComponent({
      name,
      filePath: resolver.resolve(`./runtime/app/components/${name}.vue`),
    })
  }
  addRouteMiddleware({
    name: 'eve-space-platform-module-enablement',
    path: resolver.resolve('./runtime/app/middleware/platform-module-enablement.global'),
    global: true,
  })
}
