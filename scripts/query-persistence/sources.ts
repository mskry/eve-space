import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { QueryPersistenceSource } from './boundaries.js'

export function loadQueryPersistenceSources(root: string): Promise<QueryPersistenceSource[]> {
  return loadTypescriptSourceDirectory(root, join(root, 'app', 'query-persistence'))
}

export async function loadQueryPersistenceConsumerSources(
  root: string,
): Promise<QueryPersistenceSource[]> {
  const sources = await loadTypescriptSourceDirectory(root, join(root, 'app'), ['.ts', '.vue'])
  return sources.filter(({ path }) => !path.startsWith('app/query-persistence/'))
}
