import { basename, extname } from 'node:path'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  revision: ['sde-revision'],
  database: ['database-read'],
  representation: ['static-location-types', 'route-types'],
  state: ['static-location-cache-state', 'topology-state'],
  adapter: ['static-location-store', 'topology-store'],
  orchestration: ['static-locations', 'topology'],
  service: ['route-calculator'],
} as const

type UniverseCacheTier = keyof typeof modulesByTier

const tierByModule = new Map<string, UniverseCacheTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as UniverseCacheTier]),
  ),
)

const allowedImportTiers: Record<UniverseCacheTier, readonly UniverseCacheTier[]> = {
  revision: [],
  database: [],
  representation: ['revision'],
  state: ['representation'],
  adapter: ['database', 'representation'],
  orchestration: ['revision', 'representation', 'state', 'adapter'],
  service: ['representation', 'orchestration'],
}

export interface UniverseCacheSource {
  readonly path: string
  readonly source: string
}

export function universeCacheImportViolations(sources: readonly UniverseCacheSource[]) {
  return sources.flatMap(violationsForSource).toSorted((left, right) => left.localeCompare(right))
}

function violationsForSource(source: UniverseCacheSource) {
  const module = moduleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) return [`${source.path}: universe cache module ${module} has no declared tier`]

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    const importedModule = localModuleName(specifier)
    if (!importedModule) return []
    const importedTier = tierByModule.get(importedModule)
    if (!importedTier)
      return [
        `${source.path}: ${sourceTier} module ${module} imports undeclared universe module ${importedModule}`,
      ]
    if (allowedImportTiers[sourceTier].includes(importedTier)) return []
    return [
      `${source.path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
    ]
  })
}

function moduleName(path: string) {
  const filename = basename(path)
  return filename.slice(0, -extname(filename).length)
}

function localModuleName(specifier: string) {
  if (!specifier.startsWith('./')) return undefined
  return moduleName(specifier)
}
