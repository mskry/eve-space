import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { CharacterSource } from './boundaries.js'

export async function loadCharacterSources(root: string): Promise<CharacterSource[]> {
  return loadTypescriptSourceDirectory(root, join(root, 'api', 'src', 'characters'))
}
