import { addTemplate, addTypeTemplate, createResolver } from '@nuxt/kit'
import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract'
import { createPlatformNavigation } from './navigation.js'

const pageMetaTypes = `import type { PlatformNavigationAudience } from '@eve-space/platform-module-contract'

declare module '@nuxt/schema' {
  interface NuxtPageMeta {
    platformModuleId?: string
    platformAudience?: PlatformNavigationAudience
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    platformModuleId?: string
    platformAudience?: PlatformNavigationAudience
  }
}

export {}
`

export function registerPlatformTemplates(
  contributions: readonly PlatformNuxtContributionDescriptor[],
) {
  const resolver = createResolver(import.meta.url)
  const { navigation, pages } = createPlatformNavigation(contributions)
  addTemplate({
    filename: 'eve-space-platform/navigation.ts',
    write: true,
    getContents: () =>
      `import type { PlatformNavigationEntry, PlatformPageMetadata } from '@eve-space/platform-module-nuxt/runtime'\n\nexport const platformNavigation: readonly PlatformNavigationEntry[] = ${JSON.stringify(navigation)}\n\nexport const platformPageMetadata: readonly PlatformPageMetadata[] = ${JSON.stringify(pages)}\n`,
  })
  addTypeTemplate({
    filename: 'types/eve-space-platform-page-meta.d.ts',
    getContents: () => pageMetaTypes,
  })
  addTypeTemplate({
    filename: 'types/eve-space-platform-runtime-config.d.ts',
    getContents: () => `import ${JSON.stringify(resolver.resolve('./runtime/config'))}\n`,
  })
}
