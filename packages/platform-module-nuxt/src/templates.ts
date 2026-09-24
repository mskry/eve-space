import { addTemplate, addTypeTemplate, createResolver } from '@nuxt/kit'
import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract/nuxt'
import { createPlatformNavigation } from './navigation.js'
import type { ResolvedReviewerPanel } from './reviewer-panel-resolution.js'

const pageMetaTypes = `import type { PlatformNavigationAudience } from '@eve-space/platform-module-contract/nuxt'

declare module '@nuxt/schema' {
  interface NuxtPageMeta {
    platformModuleId?: string
    platformModuleSectionId?: string
    platformAudience?: PlatformNavigationAudience
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    platformModuleId?: string
    platformModuleSectionId?: string
    platformAudience?: PlatformNavigationAudience
  }
}

export {}
`

export function registerPlatformTemplates(
  contributions: readonly PlatformNuxtContributionDescriptor[],
  reviewerPanels: readonly ResolvedReviewerPanel[],
) {
  const resolver = createResolver(import.meta.url)
  const { navigation, pages } = createPlatformNavigation(contributions)
  addTemplate({
    filename: 'eve-space-platform/navigation.ts',
    getContents: () =>
      `import type { PlatformNavigationEntry, PlatformPageMetadata } from '@eve-space/platform-module-nuxt/runtime'\n\nexport const platformNavigation: readonly PlatformNavigationEntry[] = ${JSON.stringify(navigation)}\n\nexport const platformPageMetadata: readonly PlatformPageMetadata[] = ${JSON.stringify(pages)}\n`,
    write: true,
  })
  addTemplate({
    filename: 'eve-space-platform/reviewer-panels.ts',
    getContents: () => renderReviewerPanelCatalog(reviewerPanels),
    write: true,
  })
  addTemplate({
    filename: 'eve-space-platform/query-admission-scopes.ts',
    getContents: () =>
      `import type { PlatformQueryAdmissionScopeDescriptor } from '@eve-space/platform-module-contract/nuxt'\n\nexport const platformQueryAdmissionScopes: readonly (PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string })[] = ${JSON.stringify(
        contributions.flatMap((contribution) =>
          contribution.queryAdmissionScopes.map((scope) => ({
            moduleId: contribution.moduleId,
            ...scope,
          })),
        ),
      )}\n`,
    write: true,
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

function renderReviewerPanelCatalog(panels: readonly ResolvedReviewerPanel[]) {
  const entries = panels.map(({ moduleId, contribution, importSpecifier }) => {
    const metadata = JSON.stringify({ moduleId, ...contribution })
    return `  { ...${metadata}, load: () => import(${JSON.stringify(importSpecifier)}) },`
  })
  return `import type { PlatformReviewerPanelCatalogEntry } from '@eve-space/platform-module-nuxt/runtime'\n\nexport const platformReviewerPanels: readonly PlatformReviewerPanelCatalogEntry[] = [\n${entries.join('\n')}\n]\n`
}
