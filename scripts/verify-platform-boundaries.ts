import { fileURLToPath } from 'node:url'
import { platformImportViolations } from './platform/boundaries.js'
import { loadPlatformSources } from './platform/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadPlatformSources(root)
const violations = platformImportViolations(sources)

if (violations.length > 0)
  throw new Error(`Platform boundary verification failed:\n${violations.join('\n')}`)
