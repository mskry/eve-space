import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { AuthSource } from './boundaries.js'

export async function loadAuthSources(root: string): Promise<AuthSource[]> {
  return loadTypescriptSourceDirectory(root, join(root, 'api', 'src', 'auth'))
}
