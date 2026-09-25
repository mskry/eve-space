import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const directory = new URL('../features/organization-activity/server/src/', import.meta.url)
const tiers = {
  'activity-protocol': 'representation',
  'activity-source': 'representation',
  'bounded-map': 'representation',
  collection: 'service',
  'collection-response': 'representation',
  'collection-store': 'adapter',
  'collection-types': 'representation',
  index: 'entry',
  operations: 'representation',
  persistence: 'representation',
  provider: 'service',
  'provider-activities': 'representation',
  resources: 'entry',
  routes: 'entry',
  schema: 'entry',
  snapshot: 'representation',
  'snapshot-reads': 'adapter',
} as const
const allowed = {
  adapter: ['representation', 'adapter'],
  entry: ['representation', 'adapter', 'service', 'entry'],
  representation: ['representation'],
  service: ['representation', 'adapter', 'service'],
} satisfies Record<(typeof tiers)[keyof typeof tiers], readonly string[]>

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
  if (!tier) {
    throw new Error(`Undeclared activity module: ${file}`)
  }
  for (const specifier of typescriptModuleSpecifiers(path, source)) {
    if (!specifier.startsWith('.')) {
      continue
    }
    const target = basename(specifier, '.js')
    const targetTier = tiers[target as keyof typeof tiers]
    if (!targetTier || !allowed[tier]!.includes(targetTier)) {
      throw new Error(`Activity boundary violation: ${name} imports ${target}`)
    }
  }
  if (tier !== 'adapter' && /\.(?:query|transaction)\s*\(/.test(source)) {
    throw new Error(`Activity storage must remain adapter-owned: ${name}`)
  }
}
