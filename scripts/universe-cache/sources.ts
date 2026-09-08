import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { UniverseCacheSource } from './boundaries.js'

const staticLocationModulePattern = /\/static-location(?:s|-[^/]+)\.ts$/

export async function loadUniverseCacheSources(root: string): Promise<UniverseCacheSource[]> {
  const directory = join(root, 'api', 'src', 'universe')
  return (await loadTypescriptSourceDirectory(root, directory)).filter(({ path }) =>
    staticLocationModulePattern.test(path),
  )
}
