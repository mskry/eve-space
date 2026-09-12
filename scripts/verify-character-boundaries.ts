import { fileURLToPath } from 'node:url'
import { characterBoundaryViolations } from './characters/boundaries.js'
import { loadCharacterSources } from './characters/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadCharacterSources(root)
const violations = characterBoundaryViolations(sources)

if (violations.length > 0)
  throw new Error(`Character boundary verification failed:\n${violations.join('\n')}`)
