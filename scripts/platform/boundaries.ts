import { posix } from 'node:path'
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
  const sourceModules = new Set(sources.map(({ path }) => moduleName(path)))
  const dependencies = new Map(
    sources.map((source) => [
      moduleName(source.path),
      typescriptModuleSpecifiers(source.path, source.source)
        .map((specifier) => localModuleName(source.path, specifier))
        .filter((module): module is string => Boolean(module && sourceModules.has(module)))
        .toSorted((left, right) => left.localeCompare(right)),
    ]),
  )
  const visited = new Set<string>()
  const active = new Set<string>()
  const stack: string[] = []
  const cycles = new Set<string>()

  for (const module of [...sourceModules].toSorted((left, right) => left.localeCompare(right)))
    visitDependencies(module, dependencies, visited, active, stack, cycles)
  return [...cycles].map((cycle) => `Platform dependency cycle: ${cycle}`)
}

function visitDependencies(
  module: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
  visited: Set<string>,
  active: Set<string>,
  stack: string[],
  cycles: Set<string>,
) {
  if (visited.has(module)) return
  visited.add(module)
  active.add(module)
  stack.push(module)

  for (const dependency of dependencies.get(module) ?? []) {
    if (!visited.has(dependency))
      visitDependencies(dependency, dependencies, visited, active, stack, cycles)
    else if (active.has(dependency)) {
      const cycle = stack.slice(stack.indexOf(dependency))
      cycles.add(canonicalCycle(cycle))
    }
  }

  stack.pop()
  active.delete(module)
}

function canonicalCycle(cycle: readonly string[]) {
  const start = cycle.reduce(
    (lowest, module, index) => (module.localeCompare(cycle[lowest]!) < 0 ? index : lowest),
    0,
  )
  const ordered = [...cycle.slice(start), ...cycle.slice(0, start)]
  return [...ordered, ordered[0]].join(' -> ')
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
