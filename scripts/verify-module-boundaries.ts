import { fileURLToPath } from 'node:url'
import { moduleServerImportViolations } from './module-registry/server-boundaries.js'
import { loadFeatureServerSources } from './module-registry/server-sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadFeatureServerSources(root)
const violations = moduleServerImportViolations(sources)

if (violations.length > 0)
  throw new Error(`Module server boundary verification failed:\n${violations.join('\n')}`)
