import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { OrganizationSource } from './boundaries.js'

export async function loadOrganizationSources(root: string): Promise<OrganizationSource[]> {
  const directory = join(root, 'api', 'src', 'organization')
  return loadTypescriptSourceDirectory(root, directory)
}
