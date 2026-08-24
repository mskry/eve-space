import { readdir, readFile } from 'node:fs/promises'
import { relative } from 'node:path'

const sourceRoot = new URL('../api/src/', import.meta.url)
const files = await sourceFiles(sourceRoot)
const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')]))
const failures = []

for (const [file, source] of sources) {
  const path = relative(new URL('..', sourceRoot).pathname, file.pathname)
  if (source.includes('@evespace/esi-client')) {
    for (const client of source.matchAll(/create[A-Za-z]+Client\(\{([\s\S]*?)\}\)/g)) {
      if (!/fetch:\s*createEsiTransport\(/.test(client[1]))
        failures.push(`${path}: ESI client bypasses createEsiTransport`)
    }
  }

  if (
    !path.includes('/esi-resilience/') &&
    /(?:esi.*(?:cache|cooldown)|(?:cache|cooldown).*esi)\w*\s*=\s*new Map/i.test(source)
  )
    failures.push(`${path}: legacy ESI cache or cooldown state is retained outside esi-resilience`)
}

if (failures.length) throw new Error(`ESI egress verification failed:\n${failures.join('\n')}`)

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = new URL(entry.name, directory)
      return entry.isDirectory()
        ? sourceFiles(new URL(`${entry.name}/`, directory))
        : entry.isFile() && entry.name.endsWith('.ts')
          ? [file]
          : []
    }),
  )
  return nested.flat()
}
