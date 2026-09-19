import { realpath, stat } from 'node:fs/promises'
import { resolvePath } from '@nuxt/kit'
import type {
  PlatformNuxtContributionDescriptor,
  PlatformReviewerNuxtContribution,
} from '@eve-space/platform-module-contract/nuxt'
import { isPathInside } from './path-containment.js'
import { compareStable } from './stable-order.js'

export interface ResolvedReviewerPanel {
  readonly moduleId: string
  readonly contribution: PlatformReviewerNuxtContribution
  readonly importSpecifier: string
}

export async function resolveContributionReviewerPanels(
  contributions: readonly PlatformNuxtContributionDescriptor[],
  packageRoots: ReadonlyMap<string, string>,
): Promise<readonly ResolvedReviewerPanel[]> {
  const panels = await Promise.all(
    contributions.flatMap((descriptor) =>
      descriptor.reviewerContributions.map(async (contribution) => {
        const packageRoot = packageRoots.get(descriptor.moduleId)
        if (!packageRoot)
          throw new Error(`Nuxt package ${descriptor.moduleId} could not be resolved`)
        const importSpecifier = `${descriptor.packageName}/${contribution.panelExport.slice(2)}`
        await resolveReviewerPanelFile(
          packageRoot,
          importSpecifier,
          `${descriptor.moduleId}/${contribution.contributionId}`,
        )
        return { moduleId: descriptor.moduleId, contribution, importSpecifier }
      }),
    ),
  )
  return panels.toSorted(
    (left, right) =>
      left.contribution.order - right.contribution.order ||
      compareStable(left.moduleId, right.moduleId) ||
      compareStable(left.contribution.contributionId, right.contribution.contributionId),
  )
}

export async function resolveReviewerPanelFile(
  packageRoot: string,
  importSpecifier: string,
  identity: string,
) {
  let owningPackageRoot: string
  try {
    owningPackageRoot = await realpath(packageRoot)
  } catch {
    throw new Error(`Reviewer panel ${identity} has an unresolved owning Nuxt package`)
  }
  let file: string
  try {
    const resolved = await resolvePath(importSpecifier, { extensions: [] })
    file = await realpath(resolved)
  } catch {
    throw new Error(`Reviewer panel ${identity} is missing its package export`)
  }
  if (!isPathInside(owningPackageRoot, file))
    throw new Error(`Reviewer panel ${identity} must resolve within its owning Nuxt package`)
  let regularFile = false
  try {
    regularFile = (await stat(file)).isFile()
  } catch {}
  if (!regularFile) throw new Error(`Reviewer panel ${identity} must resolve to a regular file`)
  return file
}
