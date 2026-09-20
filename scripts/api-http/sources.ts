import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { TypeScriptSource } from '../typescript-source-directory.js'

export async function loadApiHttpSources(root: string): Promise<TypeScriptSource[]> {
  return loadTypescriptSourceDirectory(root, join(root, 'api', 'src'))
}
