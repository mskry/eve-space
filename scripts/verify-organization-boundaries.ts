import { fileURLToPath } from 'node:url'
import { organizationImportViolations } from './organization/boundaries.js'
import { loadOrganizationSources } from './organization/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadOrganizationSources(root)
const violations = organizationImportViolations(sources)

if (violations.length > 0)
  throw new Error(`Organization boundary verification failed:\n${violations.join('\n')}`)
