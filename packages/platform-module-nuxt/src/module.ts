import { defineNuxtModule, extendPages } from '@nuxt/kit'
import {
  compareStable,
  type PlatformNuxtContributionDescriptor,
} from '@eve-space/platform-module-contract'
import { resolveContributionPackages, resolveContributionPages } from './contribution-resolution.js'
import { composePlatformPages } from './pages.js'
import { validateResolvedExposures } from './resolved-exposures.js'
import { registerPlatformRuntime } from './runtime-registration.js'
import { registerPlatformTemplates } from './templates.js'

export interface PlatformNuxtModuleOptions {
  readonly contributions?: readonly PlatformNuxtContributionDescriptor[]
}

export default defineNuxtModule<PlatformNuxtModuleOptions>({
  meta: {
    name: '@eve-space/platform-module-nuxt',
    compatibility: {
      nuxt: '>=4.5.2 <5',
    },
  },
  moduleDependencies: {
    '@pinia/nuxt': {
      version: '>=1.0.2 <2',
    },
    '@pinia/colada-nuxt': {
      version: '>=1.0.2 <2',
    },
  },
  defaults: {
    contributions: [],
  },
  async setup(options, nuxt) {
    const contributions = [...(options.contributions ?? [])].toSorted((left, right) =>
      compareStable(left.moduleId, right.moduleId),
    )
    registerPlatformTemplates(contributions)
    registerPlatformRuntime()
    const packageRoots = await resolveContributionPackages(contributions)
    const contributionPages = await resolveContributionPages(contributions, packageRoots)
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
