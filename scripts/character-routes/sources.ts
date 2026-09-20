import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { TypeScriptSource } from '../typescript-source-directory.js'

export async function loadCharacterRouteSources(root: string): Promise<TypeScriptSource[]> {
  const sources = await loadTypescriptSourceDirectory(root, join(root, 'api', 'src'))

  return sources.filter((source) => source.path.includes('routes'))
}
