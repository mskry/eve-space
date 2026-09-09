import { basename, extname } from 'node:path'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  support: ['numeric', 'timing'],
  representation: ['types', 'keys', 'identity', 'envelope', 'l1-cache', 'cache-redaction'],
  contract: [
    'operation-metadata',
    'catalog-validation',
    'contract-types',
    'catalog',
    'catalog-access',
    'policy',
    'representations',
    'representation-registry',
  ],
  infrastructure: ['cache-redis', 'coordination', 'transport'],
  execution: [
    'layer',
    'resource-revision',
    'cooldowns',
    'permits',
    'local-quota',
    'errors',
    'module-operation-dispatcher',
    'request-transport',
    'execute',
  ],
  observability: ['telemetry', 'telemetry-counters', 'rate-measurement', 'result-metadata'],
} as const

type EsiResilienceTier = keyof typeof modulesByTier

const tierByModule = new Map<string, EsiResilienceTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as EsiResilienceTier]),
  ),
)

const allowedImportTiersBySourceTier: Record<EsiResilienceTier, readonly EsiResilienceTier[]> = {
  support: [],
  representation: ['support', 'representation', 'contract', 'observability'],
  contract: ['support', 'representation', 'contract', 'observability'],
  infrastructure: ['support', 'representation', 'contract', 'infrastructure', 'observability'],
  execution: [
    'support',
    'representation',
    'contract',
    'infrastructure',
    'execution',
    'observability',
  ],
  observability: [
    'support',
    'representation',
    'contract',
    'infrastructure',
    'execution',
    'observability',
  ],
}

const allowedImportTiersByModule: Partial<Record<string, readonly EsiResilienceTier[]>> = {
  'telemetry-counters': [
    'support',
    'representation',
    'contract',
    'infrastructure',
    'observability',
  ],
}

export interface EsiResilienceSource {
  readonly path: string
  readonly source: string
}

export function esiResilienceImportViolations(sources: readonly EsiResilienceSource[]) {
  return sources.flatMap(violationsForSource).toSorted((left, right) => left.localeCompare(right))
}

function violationsForSource(source: EsiResilienceSource) {
  const module = moduleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) return [`${source.path}: ESI resilience module ${module} has no declared tier`]

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) =>
    violationsForImport(source.path, module, sourceTier, specifier),
  )
}

function violationsForImport(
  path: string,
  module: string,
  sourceTier: EsiResilienceTier,
  specifier: string,
) {
  const importedModule = localModuleName(specifier)
  if (!importedModule) return []

  const importedTier = tierByModule.get(importedModule)
  const allowedImportTiers =
    allowedImportTiersByModule[module] ?? allowedImportTiersBySourceTier[sourceTier]
  if (!importedTier || allowedImportTiers.includes(importedTier)) return []

  return [
    `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
  ]
}

function moduleName(path: string) {
  const filename = basename(path)
  return filename.slice(0, -extname(filename).length)
}

function localModuleName(specifier: string) {
  if (!specifier.startsWith('./')) return undefined
  return moduleName(specifier)
}
