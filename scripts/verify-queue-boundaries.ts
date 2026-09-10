import { fileURLToPath } from 'node:url'
import { queueBoundaryViolations } from './queue/boundaries.js'
import { loadQueueSources } from './queue/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadQueueSources(root)
const violations = queueBoundaryViolations(sources)

if (violations.length > 0)
  throw new Error(`Queue boundary verification failed:\n${violations.join('\n')}`)
