import { readdir, readFile } from 'node:fs/promises'
import { graphQLImportViolations } from './graphql-boundaries.js'

const directory = new URL('../api/src/graphql/', import.meta.url)
const files = (await readdir(directory)).filter((name) => name.endsWith('.ts'))
const sources = await Promise.all(
  files.map(async (name) => ({
    path: `api/src/graphql/${name}`,
    source: await readFile(new URL(name, directory), 'utf8'),
  })),
)
const violations = graphQLImportViolations(sources)
if (violations.length) throw new Error(violations.join('\n'))
