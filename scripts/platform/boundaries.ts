import { posix } from 'node:path'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  representation: [
    'collection-state',
    'module-navigation',
    'resource-batch-contract',
    'resource-id-list',
    'resource-identity',
    'resource-subject',
  ],
  declaration: ['core-resources', 'resource-declarations', 'resources'],
  state: ['module-runtime-cache'],
  adapter: [
    'collection-state-store',
    'core-read-capabilities',
    'core-resource-materialization',
    'module-activity-provider-capabilities',
    'module-route-capabilities',
    'module-settings',
    'resource-eligibility',
  ],
  service: [
    'collection-status',
    'resource-execution-guard',
    'resource-failures',
    'resource-operation-executor',
  ],
  application: ['resource-batch', 'resource-refresh'],
  entry: ['collection-state-repair'],
  transport: ['module-route-composition', 'routes'],
} as const

type PlatformTier = keyof typeof modulesByTier

const tierByModule = new Map<string, PlatformTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as PlatformTier]),
  ),
)

const allowedImportTiersBySourceTier: Record<PlatformTier, readonly PlatformTier[]> = {
  representation: ['representation'],
  declaration: ['representation', 'declaration'],
  state: ['representation', 'state'],
  adapter: ['representation', 'declaration', 'state', 'adapter'],
  service: ['representation', 'declaration', 'state', 'adapter', 'service'],
  application: ['representation', 'declaration', 'state', 'adapter', 'service', 'application'],
  entry: ['representation', 'declaration', 'state', 'adapter', 'service', 'application', 'entry'],
  transport: [
    'representation',
    'declaration',
    'state',
    'adapter',
    'service',
    'application',
    'transport',
  ],
}

const allowedRepresentationPackages = new Set(['@eve-space/platform-module-contract', 'zod'])

export interface PlatformSource {
  readonly path: string
  readonly source: string
}

export function platformImportViolations(sources: readonly PlatformSource[]) {
  return [...sources.flatMap(violationsForSource), ...dependencyCycleViolations(sources)].toSorted(
    (left, right) => left.localeCompare(right),
  )
}

function violationsForSource(source: PlatformSource) {
  const module = moduleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) return [`${source.path}: Platform module ${module} has no declared tier`]

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    const importedPath = relativeImportPath(source.path, specifier)
    if (importedPath?.startsWith('api/src/queue/'))
      return [`${source.path}: Platform module ${module} cannot import queue module ${specifier}`]
    if (
      sourceTier === 'representation' &&
      !importedPath?.startsWith('api/src/platform/') &&
      !allowedRepresentationPackages.has(specifier)
    )
      return [
        `${source.path}: representation module ${module} cannot import runtime dependency ${specifier}`,
      ]
    return violationsForImport(source.path, module, sourceTier, specifier)
  })
}

function violationsForImport(
  path: string,
  module: string,
  sourceTier: PlatformTier,
  specifier: string,
) {
  const importedModule = localModuleName(path, specifier)
  if (!importedModule) return []

  const importedTier = tierByModule.get(importedModule)
  if (!importedTier || allowedImportTiersBySourceTier[sourceTier].includes(importedTier)) return []
  return [
    `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
  ]
}

function dependencyCycleViolations(sources: readonly PlatformSource[]) {
  return findDependencyCycles(
    sources,
    ({ path }) => moduleName(path),
    ({ path, source }) =>
      typescriptModuleSpecifiers(path, source).map((specifier) => localModuleName(path, specifier)),
  ).map((cycle) => `Platform dependency cycle: ${cycle}`)
}

function moduleName(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const marker = 'api/src/platform/'
  const relativePath = normalized.includes(marker)
    ? normalized.slice(normalized.lastIndexOf(marker) + marker.length)
    : normalized
  const extension = posix.extname(relativePath)
  return relativePath.slice(0, extension ? -extension.length : undefined)
}

function localModuleName(sourcePath: string, specifier: string) {
  const importedPath = relativeImportPath(sourcePath, specifier)
  return importedPath?.startsWith('api/src/platform/') ? moduleName(importedPath) : undefined
}

function relativeImportPath(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined
  const normalizedSource = sourcePath.replaceAll('\\', '/')
  return posix.normalize(posix.join(posix.dirname(normalizedSource), specifier))
}
