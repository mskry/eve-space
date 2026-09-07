import { fileURLToPath } from 'node:url'
import { assertInstalledFeatureBoundaries } from './module-registry/feature-boundaries.js'
import { moduleServerImportViolations } from './module-registry/server-boundaries.js'
import { loadFeatureServerSources } from './module-registry/server-sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
await assertInstalledFeatureBoundaries(root)
const sources = await loadFeatureServerSources(root)
const violations = moduleServerImportViolations(sources)

if (violations.length > 0)
  throw new Error(`Module server boundary verification failed:\n${violations.join('\n')}`)
