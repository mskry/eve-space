import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export interface TypeScriptSource {
  readonly path: string
  readonly source: string
}

export async function loadTypescriptSourceDirectory(
  root: string,
  directory: string,
  extensions: readonly string[] = ['.ts'],
): Promise<TypeScriptSource[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          return loadTypescriptSourceDirectory(root, path, extensions)
        }
        if (!entry.isFile() || !extensions.includes(extname(entry.name))) {
          return []
        }
        return { path: relative(root, path), source: await readFile(path, 'utf8') }
      }),
  )
  return sources.flat()
}
