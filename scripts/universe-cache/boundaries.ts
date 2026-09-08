import { basename, extname } from 'node:path'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  representation: ['static-location-types'],
  state: ['static-location-cache-state'],
  adapter: ['static-location-store'],
  orchestration: ['static-locations'],
} as const

type UniverseCacheTier = keyof typeof modulesByTier

const tierByModule = new Map<string, UniverseCacheTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as UniverseCacheTier]),
  ),
)

const allowedImportTiers: Record<UniverseCacheTier, readonly UniverseCacheTier[]> = {
  representation: [],
  state: ['representation'],
  adapter: ['representation'],
  orchestration: ['representation', 'state', 'adapter'],
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
    if (!importedTier || allowedImportTiers[sourceTier].includes(importedTier)) return []
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
