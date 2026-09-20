import { fileURLToPath } from 'node:url'
import { characterRouteOwnershipViolations } from './character-routes/ownership.js'
import { loadCharacterRouteSources } from './character-routes/sources.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = characterRouteOwnershipViolations(await loadCharacterRouteSources(root))

if (violations.length > 0)
  throw new Error(`Character route ownership verification failed:\n${violations.join('\n')}`)
