import {
  loadInstalledFeaturePackageSources,
  nuxtSourceBoundaryViolations,
  type FeatureBoundarySource,
} from './feature-boundaries.js'
import type { ResolvedInstalledModuleRelease } from './resolved-release.js'

export type ModuleNuxtSource = FeatureBoundarySource

export async function loadFeatureNuxtSources(
  root: string,
  releases: readonly ResolvedInstalledModuleRelease[],
): Promise<readonly ModuleNuxtSource[]> {
  const sources = await Promise.all(
    releases.map((release) => loadInstalledFeaturePackageSources(root, release, 'nuxt')),
  )
  return sources.flat()
}

export function moduleNuxtBoundaryViolations(sources: readonly ModuleNuxtSource[]) {
  return sources
    .flatMap((source) => nuxtSourceBoundaryViolations(source))
    .toSorted((left, right) => left.localeCompare(right))
}
