import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export async function loadTypescriptSourceDirectory(root: string, directory: string) {
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
