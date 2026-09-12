import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  esiGatewayConsumerImportViolations,
  esiGatewayExternalInternalViolations,
  esiGatewayImportViolations,
} from './esi-gateway/boundaries.js'
import { loadEsiGatewaySources } from './esi-gateway/sources.js'
import { loadFeatureServerSources } from './module-registry/server-sources.js'
import { loadTypescriptSourceDirectory } from './typescript-source-directory.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const [gatewaySources, apiSources, moduleSources, testSources, scriptSources] = await Promise.all([
  loadEsiGatewaySources(root),
  loadTypescriptSourceDirectory(root, join(root, 'api', 'src')),
  loadFeatureServerSources(root),
  loadTypescriptSourceDirectory(root, join(root, 'api', 'tests')),
  loadTypescriptSourceDirectory(root, join(root, 'scripts')),
])
const violations = [
  ...esiGatewayImportViolations(gatewaySources),
  ...esiGatewayConsumerImportViolations(
    apiSources.filter(({ path }) => !path.startsWith('api/src/esi-gateway/')),
    'core',
  ),
  ...esiGatewayConsumerImportViolations(moduleSources, 'installed-module'),
  ...esiGatewayExternalInternalViolations(testSources),
  ...esiGatewayExternalInternalViolations(scriptSources),
].toSorted((left, right) => left.localeCompare(right))

if (violations.length > 0)
  throw new Error(`ESI gateway boundary verification failed:\n${violations.join('\n')}`)
