import { addComponent, addImports, addRouteMiddleware, createResolver } from '@nuxt/kit'

export function registerPlatformRuntime() {
  const resolver = createResolver(import.meta.url)
  addImports([
    {
      from: resolver.resolve('./runtime/confirm-dialog'),
      name: 'providePlatformConfirmDialog',
    },
    {
      from: resolver.resolve('./runtime/confirm-dialog'),
      name: 'usePlatformConfirmDialog',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformApi'),
      name: 'usePlatformApi',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformEveImages'),
      name: 'usePlatformEveImages',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformModuleRuntime'),
      name: 'usePlatformModuleRuntime',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformModuleRuntime'),
      name: 'usePlatformModulePersistenceLifecycle',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformMutationAnnouncement'),
      name: 'usePlatformMutationAnnouncement',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformNavigation'),
      name: 'usePlatformNavigation',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformProtectedQuery'),
      name: 'usePlatformProtectedQuery',
    },
    {
      from: resolver.resolve('./runtime/app/composables/usePlatformReviewerPanels'),
      name: 'usePlatformReviewerPanels',
    },
  ])
  for (const name of [
    'PlatformAuthorizationRequired',
    'PlatformEveImage',
    'PlatformPagination',
    'PlatformQueryPersistenceStatus',
    'PlatformResourceBoundary',
  ]) {
    addComponent({
      filePath: resolver.resolve(`./runtime/app/components/${name}.vue`),
      name,
    })
  }
  addRouteMiddleware({
    global: true,
    name: 'eve-space-platform-module-enablement',
    path: resolver.resolve('./runtime/app/middleware/platform-module-enablement.global'),
  })
}
