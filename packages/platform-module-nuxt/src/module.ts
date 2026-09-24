import { defineNuxtModule, extendPages } from '@nuxt/kit'
import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract/nuxt'
import { resolveContributionPackages, resolveContributionPages } from './contribution-resolution.js'
import { composePlatformPages } from './pages.js'
import { resolveContributionReviewerPanels } from './reviewer-panel-resolution.js'
import { validateResolvedExposures } from './resolved-exposures.js'
import { registerPlatformRuntime } from './runtime-registration.js'
import { registerPlatformTemplates } from './templates.js'
import { compareStable } from './stable-order.js'

export interface PlatformNuxtModuleOptions {
  readonly contributions?: readonly PlatformNuxtContributionDescriptor[]
}

export default defineNuxtModule<PlatformNuxtModuleOptions>({
  defaults: {
    contributions: [],
  },
  meta: {
    compatibility: {
      nuxt: '>=4.5.2 <5',
    },
    name: '@eve-space/platform-module-nuxt',
  },
  moduleDependencies: {
    '@pinia/colada-nuxt': {
      version: '>=1.0.2 <2',
    },
    '@pinia/nuxt': {
      version: '>=1.0.2 <2',
    },
  },
  async setup(options, nuxt) {
    const contributions = [...(options.contributions ?? [])].toSorted((left, right) =>
      compareStable(left.moduleId, right.moduleId),
    )
    const packageRoots = await resolveContributionPackages(contributions)
    const [contributionPages, reviewerPanels] = await Promise.all([
      resolveContributionPages(contributions, packageRoots),
      resolveContributionReviewerPanels(contributions, packageRoots),
    ])
    registerPlatformTemplates(contributions, reviewerPanels)
    registerPlatformRuntime()
    extendPages((pages) => composePlatformPages(pages, contributionPages))
    nuxt.hook('components:extend', (components) => {
      validateResolvedExposures(
        contributions,
        packageRoots,
        components.map((component) => ({
          name: component.pascalName,
          from: component.filePath,
        })),
        'components',
      )
    })
    nuxt.hook('imports:extend', (imports) => {
      validateResolvedExposures(
        contributions,
        packageRoots,
        imports.map((entry) => ({ name: entry.as ?? entry.name, from: entry.from })),
        'composables',
      )
    })
  },
})
