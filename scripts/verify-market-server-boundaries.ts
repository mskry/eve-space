import { readFile, readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDependencyCycles } from './dependency-cycles.js'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const directory = new URL('../features/market/server/src/', import.meta.url)
type MarketTier = 'route' | 'collection' | 'entry' | 'representation' | 'declaration' | 'resource'

const tiers: Readonly<Record<string, MarketTier>> = {
  'book-routes': 'route',
  'catalogue-routes': 'route',
  'collect-orders': 'collection',
  'collect-structure-orders': 'collection',
  'history-resource': 'resource',
  'history-routes': 'route',
  index: 'entry',
  'market-bounds': 'representation',
  'market-derived': 'representation',
  'market-page-collection': 'collection',
  'market-order-expiry': 'representation',
  'market-representation': 'representation',
  'order-depth': 'representation',
  operations: 'declaration',
  persistence: 'declaration',
  'profile-collection': 'resource',
  'profile-routes': 'route',
  'quote-market': 'collection',
  'quote-routes': 'route',
  profiles: 'representation',
  'reference-price-routes': 'route',
  'reference-prices-resource': 'resource',
  'structure-resource': 'resource',
  'structure-routes': 'route',
}
const allowed = {
  collection: ['representation', 'collection'],
  declaration: ['representation'],
  entry: ['representation', 'declaration', 'collection', 'resource', 'route'],
  representation: ['representation'],
  resource: ['representation', 'declaration', 'collection'],
  route: ['representation', 'declaration', 'collection'],
} satisfies Record<MarketTier, readonly string[]>

const sources = await Promise.all(
  (await readdir(directory))
    .filter((file) => file.endsWith('.ts'))
    .map(async (file) => {
      const path = fileURLToPath(new URL(file, directory))
      return { name: basename(file, '.ts'), path, source: await readFile(path, 'utf8') }
    }),
)

for (const { name, path, source } of sources) {
  const tier = tiers[name]
  if (!tier) throw new Error(`Undeclared Market server module: ${name}`)
  for (const specifier of typescriptModuleSpecifiers(path, source)) {
    if (!specifier.startsWith('.')) continue
    const target = basename(specifier, '.js')
    const targetTier = tiers[target]
    if (!targetTier || !allowed[tier].includes(targetTier)) {
      throw new Error(`Market server import direction: ${name} imports ${target}`)
    }
  }
}

const cycles = findDependencyCycles(
  sources,
  ({ name }) => name,
  ({ path, source }) =>
    typescriptModuleSpecifiers(path, source)
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => basename(specifier, '.js')),
)
if (cycles.length > 0) throw new Error(`Market server cycle: ${cycles.join('; ')}`)
