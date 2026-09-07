import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const directory = new URL('../features/organization-activity/server/src/', import.meta.url)
const tiers = {
  'activity-source': 'representation',
  'bounded-map': 'representation',
  'collection-types': 'representation',
  'collection-response': 'representation',
  'provider-activities': 'representation',
  snapshot: 'representation',
  'collection-store': 'adapter',
  'snapshot-reads': 'adapter',
  collection: 'service',
  provider: 'service',
  resources: 'entry',
  routes: 'entry',
  operations: 'entry',
  schema: 'entry',
  index: 'entry',
} as const
const allowed: Record<string, readonly string[]> = {
  representation: ['representation'],
  adapter: ['representation', 'adapter'],
  service: ['representation', 'adapter', 'service'],
  entry: ['representation', 'adapter', 'service', 'entry'],
}

const sources = await Promise.all(
  (await readdir(directory))
    .filter((file) => file.endsWith('.ts'))
    .map(async (file) => {
      const path = fileURLToPath(new URL(file, directory))
      return { file, path, source: await readFile(path, 'utf8') }
    }),
)
for (const { file, path, source } of sources) {
  const name = basename(file, '.ts')
  const tier = tiers[name as keyof typeof tiers]
  if (!tier) throw new Error(`Undeclared activity module: ${file}`)
  for (const specifier of typescriptModuleSpecifiers(path, source)) {
    if (!specifier.startsWith('.')) continue
    const target = basename(specifier, '.js')
    const targetTier = tiers[target as keyof typeof tiers]
    if (!targetTier || !allowed[tier]!.includes(targetTier))
      throw new Error(`Activity boundary violation: ${name} imports ${target}`)
  }
  if (tier !== 'adapter' && /\.(?:query|transaction)\s*\(/.test(source))
    throw new Error(`Activity storage must remain adapter-owned: ${name}`)
}
