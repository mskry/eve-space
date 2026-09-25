import { fileURLToPath } from 'node:url'
import {
  characterBoundaryViolations,
  rawCorporationRoleContentViolations,
} from './characters/boundaries.js'
import { loadApiSources, loadCharacterSources } from './characters/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadCharacterSources(root)
const violations = [
  ...characterBoundaryViolations(sources),
  ...rawCorporationRoleContentViolations(await loadApiSources(root)),
]

if (violations.length > 0) {
  throw new Error(`Character boundary verification failed:\n${violations.join('\n')}`)
}
