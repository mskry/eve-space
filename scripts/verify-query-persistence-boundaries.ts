import { fileURLToPath } from 'node:url'
import {
  queryPersistenceConsumerImportViolations,
  queryPersistenceImportViolations,
} from './query-persistence/boundaries.js'
import {
  loadQueryPersistenceConsumerSources,
  loadQueryPersistenceSources,
} from './query-persistence/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const [internalSources, consumerSources] = await Promise.all([
  loadQueryPersistenceSources(root),
  loadQueryPersistenceConsumerSources(root),
])
const violations = [
  ...queryPersistenceImportViolations(internalSources),
  ...queryPersistenceConsumerImportViolations(consumerSources),
]

if (violations.length > 0)
  throw new Error(`Query persistence boundary verification failed:\n${violations.join('\n')}`)
