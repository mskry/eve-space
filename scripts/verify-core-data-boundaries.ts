import { fileURLToPath } from 'node:url'
import { coreDataBoundaryViolations } from './core-data/boundaries.js'
import { loadCoreDataBoundarySources } from './core-data/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadCoreDataBoundarySources(root)
const violations = coreDataBoundaryViolations(sources)

if (violations.length > 0)
  throw new Error(`Core-data boundary verification failed:\n${violations.join('\n')}`)
