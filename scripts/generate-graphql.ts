import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'oxfmt'
import { generateGraphQLArtifacts, graphqlArtifactPaths } from './graphql-generation.js'
import { generateFeatureGraphQL } from './graphql-feature-generation.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const [installedSDL, operationSource] = await Promise.all([
  readFile(resolve(root, 'api/src/generated/platform/installed-module-graphql.graphql'), 'utf8'),
  readFile(resolve(root, 'app/graphql/operations.graphql'), 'utf8'),
])
const artifacts = await generateGraphQLArtifacts(installedSDL, operationSource)
const marketDirectory = 'features/market/nuxt/src/runtime/app'
const marketSource = await readFile(
  resolve(root, marketDirectory, 'market-operations.graphql'),
  'utf8',
)
artifacts.set(
  `${marketDirectory}/market-graphql.ts`,
  await generateFeatureGraphQL(artifacts.get(graphqlArtifactPaths.sdl)!, marketSource),
)
const write = process.argv.includes('--write')
await Promise.all(
  [...artifacts].map(async ([path, source]) => {
    const output = path.endsWith('.graphql')
      ? source
      : (await format(path, source, { singleQuote: true, semi: false, printWidth: 100 })).code
    const destination = resolve(root, path)
    if (write) {
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, output)
    } else if ((await readFile(destination, 'utf8').catch(() => '')) !== output) {
      throw new Error(`GraphQL artifact drift: ${path}. Run pnpm graphql:generate.`)
    }
  }),
)
