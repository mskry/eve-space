import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { QueueSource } from './boundaries.js'

export async function loadQueueSources(root: string): Promise<QueueSource[]> {
  const directory = join(root, 'api', 'src', 'queue')
  return loadTypescriptSourceDirectory(root, directory)
}
