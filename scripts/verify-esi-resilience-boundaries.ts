import { fileURLToPath } from 'node:url'
import { esiResilienceImportViolations } from './esi-resilience/boundaries.js'
import { loadEsiResilienceSources } from './esi-resilience/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadEsiResilienceSources(root)
const violations = esiResilienceImportViolations(sources)

if (violations.length > 0)
  throw new Error(`ESI resilience boundary verification failed:\n${violations.join('\n')}`)
