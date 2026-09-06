import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { EsiResilienceSource } from './boundaries.js'

export async function loadEsiResilienceSources(root: string): Promise<EsiResilienceSource[]> {
  const directory = join(root, 'api', 'src', 'esi-resilience')
  return loadTypescriptSourceDirectory(root, directory)
}
