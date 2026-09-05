import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { EsiResilienceSource } from './boundaries.js'

export async function loadEsiResilienceSources(root: string): Promise<EsiResilienceSource[]> {
  const directory = join(root, 'api', 'src', 'esi-resilience')
  const entries = await readdir(directory, { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && extname(entry.name) === '.ts')
      .map(async (entry) => {
        const path = join(directory, entry.name)
        return { path: relative(root, path), source: await readFile(path, 'utf8') }
      }),
  )
}
