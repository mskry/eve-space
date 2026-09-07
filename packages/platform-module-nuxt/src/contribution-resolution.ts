import { dirname, resolve } from 'node:path'
import { resolvePath } from '@nuxt/kit'
import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract'
import type { ResolvedContributionPage } from './pages.js'
import { resolveFeaturePage } from './page-resolution.js'

export async function resolveContributionPackages(
  contributions: readonly PlatformNuxtContributionDescriptor[],
) {
  return new Map(
    await Promise.all(
      contributions.map(async ({ moduleId }) => {
        const entrypoint = await resolvePath(`@eve-space/${moduleId}-nuxt`)
        return [moduleId, resolve(dirname(entrypoint), '..')] as const
      }),
    ),
  )
}

export async function resolveContributionPages(
  contributions: readonly PlatformNuxtContributionDescriptor[],
  packageRoots: ReadonlyMap<string, string>,
): Promise<readonly ResolvedContributionPage[]> {
  return Promise.all(
    contributions.flatMap((contribution) =>
      contribution.pages.map(async (page) => {
        const packageRoot = packageRoots.get(contribution.moduleId)
        if (!packageRoot)
          throw new Error(`Nuxt package ${contribution.moduleId} could not be resolved`)
        const file = await resolveFeaturePage(
          packageRoot,
          page.file,
          `${contribution.moduleId}/${page.id}`,
        )
        return { moduleId: contribution.moduleId, page, file }
      }),
    ),
  )
}
