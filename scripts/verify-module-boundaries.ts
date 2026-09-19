import { fileURLToPath } from 'node:url'
import {
  assertInstalledFeatureBoundaries,
  assertManifestCompositionBoundaries,
} from './module-registry/feature-boundaries.js'
import {
  loadPlatformHostSources,
  platformFeatureImportViolations,
} from './module-registry/host-boundaries.js'
import { moduleServerImportViolations } from './module-registry/server-boundaries.js'
import { loadFeatureServerSources } from './module-registry/server-sources.js'
import { resolveInstalledModuleReleases } from './module-registry/resolved-release.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const { releases } = resolveInstalledModuleReleases(root)
await assertInstalledFeatureBoundaries(root, releases)
await Promise.all(
  releases.map(async (release) => assertManifestCompositionBoundaries(root, release)),
)
const sources = await loadFeatureServerSources(root, releases)
const violations = [
  ...moduleServerImportViolations(sources),
  ...platformFeatureImportViolations(await loadPlatformHostSources(root)),
]

if (violations.length > 0)
  throw new Error(`Module server boundary verification failed:\n${violations.join('\n')}`)
