import { fileURLToPath } from 'node:url'
import { universeCacheImportViolations } from './universe-cache/boundaries.js'
import { loadUniverseCacheSources } from './universe-cache/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadUniverseCacheSources(root)
const violations = universeCacheImportViolations(sources)

if (violations.length > 0)
  throw new Error(`Universe cache boundary verification failed:\n${violations.join('\n')}`)
