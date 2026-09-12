import { join } from 'node:path'
import { loadTypescriptSourceDirectory } from '../typescript-source-directory.js'
import type { EsiGatewaySource } from './boundaries.js'

export async function loadEsiGatewaySources(root: string): Promise<EsiGatewaySource[]> {
  return loadTypescriptSourceDirectory(root, join(root, 'api', 'src', 'esi-gateway'))
}
