import { fileURLToPath } from 'node:url'
import { assertInstalledFeatureBoundaries } from './module-registry/feature-boundaries.js'
import {
  loadFeatureNuxtSources,
  moduleNuxtBoundaryViolations,
} from './module-registry/nuxt-boundaries.js'
import {
  loadPlatformHostSources,
  platformFeatureImportViolations,
} from './module-registry/host-boundaries.js'
import {
  loadPlatformNuxtSources,
  platformNuxtBoundaryViolations,
} from './platform-nuxt-boundaries.js'
import { resolveInstalledModuleReleases } from './module-registry/resolved-release.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const { releases } = resolveInstalledModuleReleases(root)
await assertInstalledFeatureBoundaries(root, releases)
const sources = await loadFeatureNuxtSources(root, releases)
const violations = [
  ...moduleNuxtBoundaryViolations(sources),
  ...platformFeatureImportViolations(await loadPlatformHostSources(root)),
  ...platformNuxtBoundaryViolations(await loadPlatformNuxtSources(root)),
]

if (violations.length > 0) {
  throw new Error(`Module Nuxt boundary verification failed:\n${violations.join('\n')}`)
}
