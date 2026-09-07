import { fileURLToPath } from 'node:url'
import { assertInstalledFeatureBoundaries } from './module-registry/feature-boundaries.js'
import {
  loadFeatureNuxtSources,
  moduleNuxtBoundaryViolations,
} from './module-registry/nuxt-boundaries.js'
import {
  loadPlatformNuxtSources,
  platformNuxtBoundaryViolations,
} from './platform-nuxt-boundaries.js'

const root = fileURLToPath(new URL('..', import.meta.url))
await assertInstalledFeatureBoundaries(root)
const sources = await loadFeatureNuxtSources(root)
const violations = [
  ...moduleNuxtBoundaryViolations(sources),
  ...platformNuxtBoundaryViolations(await loadPlatformNuxtSources(root)),
]

if (violations.length > 0)
  throw new Error(`Module Nuxt boundary verification failed:\n${violations.join('\n')}`)
