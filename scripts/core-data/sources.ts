import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { CoreDataBoundarySource } from './boundaries.js'

export async function loadCoreDataBoundarySources(root: string): Promise<CoreDataBoundarySource[]> {
  const sourceGroups = await Promise.all([
    loadSourceDirectory(root, join(root, 'packages', 'core-data-contract', 'src')),
    loadSourceDirectory(root, join(root, 'api', 'src')),
  ])
  return sourceGroups.flat()
}

async function loadSourceDirectory(
  root: string,
  directory: string,
): Promise<CoreDataBoundarySource[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return loadSourceDirectory(root, path)
        if (!entry.isFile() || extname(entry.name) !== '.ts') return []
        return [
          {
            path: relative(root, path).replaceAll('\\', '/'),
            source: await readFile(path, 'utf8'),
          },
        ]
      }),
  )
  return sources.flat()
}
