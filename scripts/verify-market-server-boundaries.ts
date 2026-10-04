import { readFile, readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDependencyCycles } from './dependency-cycles.js'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const directory = new URL('../features/market/server/src/', import.meta.url)
type MarketTier =
  | 'route'
  | 'graphql'
  | 'read'
  | 'collection'
  | 'entry'
  | 'representation'
  | 'declaration'
  | 'resource'

const tiers = {
  'book-routes': 'route',
  'book-reads': 'read',
  'catalogue-routes': 'route',
  'catalogue-reads': 'read',
  'collect-orders': 'collection',
  'collect-structure-orders': 'collection',
  'history-resource': 'resource',
  'history-routes': 'route',
  'history-reads': 'read',
  graphql: 'graphql',
  'graphql-catalogue': 'graphql',
  'graphql-book': 'graphql',
  'graphql-statistics': 'graphql',
  'order-cursor': 'representation',
  'read-input': 'representation',
  index: 'entry',
  'market-bounds': 'representation',
  'intelligence-policy': 'representation',
  'intelligence-arithmetic': 'representation',
  'intelligence-metrics': 'representation',
  'intelligence-representation': 'representation',
  'intelligence-definitions': 'representation',
  'intelligence-report': 'representation',
  'intelligence-query': 'representation',
  'intelligence-cursor': 'representation',
  'intelligence-read-persistence': 'declaration',
  'intelligence-reads': 'read',
  'graphql-intelligence': 'graphql',
  'intelligence-persistence': 'declaration',
  'intelligence-generation-persistence': 'declaration',
  'intelligence-derivation': 'resource',
  'intelligence-reconciliation': 'resource',
  'market-derived': 'representation',
  'market-page-collection': 'collection',
  'market-page-batches': 'collection',
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
  'reference-price-reads': 'read',
  'reference-prices-resource': 'resource',
  'structure-resource': 'resource',
  'structure-routes': 'route',
} satisfies Record<string, MarketTier>
const tiersByModule = new Map<string, MarketTier>(Object.entries(tiers))
const allowed = {
  collection: ['representation', 'collection'],
  declaration: ['representation'],
  entry: ['representation', 'declaration', 'collection', 'resource', 'read', 'route', 'graphql'],
  graphql: ['representation', 'declaration', 'read', 'graphql'],
  representation: ['representation'],
  resource: ['representation', 'declaration', 'collection'],
  route: ['representation', 'declaration', 'collection', 'read'],
  read: ['representation', 'declaration', 'read'],
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
  const tier = tiersByModule.get(name)
  if (!tier) throw new Error(`Undeclared Market server module: ${name}`)
  for (const specifier of typescriptModuleSpecifiers(path, source)) {
    if (!specifier.startsWith('.')) continue
    const target = basename(specifier, '.js')
    const targetTier = tiersByModule.get(target)
    const resourceHelper =
      name === 'history-resource' &&
      ['intelligence-reconciliation', 'intelligence-derivation'].includes(target)
    if (!targetTier || (!resourceHelper && !allowed[tier].includes(targetTier))) {
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
