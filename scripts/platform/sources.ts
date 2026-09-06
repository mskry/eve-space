import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { PlatformSource } from './boundaries.js'

export async function loadPlatformSources(root: string): Promise<PlatformSource[]> {
  const directory = join(root, 'api', 'src', 'platform')
  return loadSourceDirectory(root, directory)
}

async function loadSourceDirectory(root: string, directory: string): Promise<PlatformSource[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return loadSourceDirectory(root, path)
        if (!entry.isFile() || extname(entry.name) !== '.ts') return []
        return [{ path: relative(root, path), source: await readFile(path, 'utf8') }]
      }),
  )
  return sources.flat()
}
