import { fileURLToPath } from 'node:url'
import { loadTypescriptSourceDirectory } from './typescript-source-directory.js'
import { mailCompositionImportViolations } from './mail-composition/boundaries.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = await loadTypescriptSourceDirectory(
  root,
  fileURLToPath(new URL('../app', import.meta.url)),
  ['.ts', '.vue'],
)
const violations = mailCompositionImportViolations(sources)

if (violations.length > 0)
  throw new Error(`Mail composition boundary verification failed:\n${violations.join('\n')}`)
