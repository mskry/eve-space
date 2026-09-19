import { readFile, realpath } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'
import { resolvePath } from '@nuxt/kit'
import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract/nuxt'
import type { ResolvedContributionPage } from './pages.js'
import { resolveFeaturePage } from './page-resolution.js'

export async function resolveContributionPackages(
  contributions: readonly PlatformNuxtContributionDescriptor[],
) {
  return new Map(
    await Promise.all(
      contributions.map(async ({ moduleId, packageName }) => {
        const entrypoint = await resolvePath(packageName)
        return [moduleId, await findOwningPackageRoot(entrypoint, packageName)] as const
      }),
    ),
  )
}

async function findOwningPackageRoot(entrypoint: string, packageName: string) {
  return findPackageRoot(dirname(await realpath(entrypoint)), packageName)
}

async function findPackageRoot(directory: string, packageName: string): Promise<string> {
  if (directory === parse(directory).root)
    throw new Error(`Nuxt package ${packageName} could not be resolved`)
  try {
    const packageJson: unknown = JSON.parse(
      await readFile(resolve(directory, 'package.json'), 'utf8'),
    )
    if (isRecord(packageJson) && packageJson.name === packageName) return realpath(directory)
  } catch {
    // Continue to the owning package boundary.
  }
  return findPackageRoot(dirname(directory), packageName)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
