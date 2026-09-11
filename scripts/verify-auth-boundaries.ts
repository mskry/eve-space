import { fileURLToPath } from 'node:url'
import { authImportViolations } from './auth/boundaries.js'
import { loadAuthSources } from './auth/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = authImportViolations(await loadAuthSources(root))

if (violations.length > 0)
  throw new Error(`Authentication boundary verification failed:\n${violations.join('\n')}`)
