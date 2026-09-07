import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract'
import { isPathInside } from './path-containment.js'

export function validateResolvedExposures(
  contributions: readonly PlatformNuxtContributionDescriptor[],
  packageRoots: ReadonlyMap<string, string>,
  registrations: readonly { name: string; from: string }[],
  category: 'components' | 'composables',
) {
  for (const contribution of contributions) {
    const packageRoot = packageRoots.get(contribution.moduleId)
    if (!packageRoot) throw new Error(`Nuxt package ${contribution.moduleId} could not be resolved`)
    for (const name of contribution.exposed?.[category] ?? []) {
      const matches = registrations.filter((registration) => registration.name === name)
      if (matches.length !== 1 || !isPathInside(packageRoot, matches[0]!.from))
        throw new Error(
          `Nuxt ${category.slice(0, -1)} ${name} from ${contribution.moduleId} must resolve exactly once`,
        )
    }
  }
}
