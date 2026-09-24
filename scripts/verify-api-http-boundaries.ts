import { fileURLToPath } from 'node:url'
import { apiHttpBoundaryViolations } from './api-http/boundaries.js'
import { loadApiHttpSources } from './api-http/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = apiHttpBoundaryViolations(await loadApiHttpSources(root))

if (violations.length > 0) {
  throw new Error(`API HTTP boundary verification failed:\n${violations.join('\n')}`)
}
