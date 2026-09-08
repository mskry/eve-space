import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { UniverseCacheSource } from './boundaries.js'

const universeCacheModulePattern =
  /\/(?:static-location(?:s|-[^/]+)|route-(?:calculator|types)|topology(?:-[^/]+)?)\.ts$/

export async function loadUniverseCacheSources(root: string): Promise<UniverseCacheSource[]> {
  const directory = join(root, 'api', 'src', 'universe')
  return (await loadTypescriptSourceDirectory(root, directory)).filter(({ path }) =>
    universeCacheModulePattern.test(path),
  )
}
