import { fileURLToPath } from 'node:url'
import {
  loadFeatureNuxtSources,
  moduleNuxtBoundaryViolations,
} from './module-registry/nuxt-boundaries.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadFeatureNuxtSources(root)
const violations = moduleNuxtBoundaryViolations(sources)

if (violations.length > 0)
  throw new Error(`Module Nuxt boundary verification failed:\n${violations.join('\n')}`)
