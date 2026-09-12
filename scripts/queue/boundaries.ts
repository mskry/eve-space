import { posix } from 'node:path'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  representation: ['job-contracts', 'namespaces', 'outcomes', 'policy', 'producer'],
  adapter: ['bullmq-producer', 'operations-queue', 'redis', 'worker-identity'],
  application: [
    'affiliation-planner',
    'outbox-relay',
    'owner-evidence-planner',
    'planning-context',
    'resource-batch-processor',
    'resource-planner',
  ],
  orchestration: ['planner'],
  execution: ['failures', 'job-handlers', 'platform', 'scheduler', 'worker-lifecycle'],
  observability: ['domain-event-inspection', 'outcome-recorder', 'status', 'worker-liveness'],
} as const

type QueueTier = keyof typeof modulesByTier

const tierByModule = new Map<string, QueueTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as QueueTier]),
  ),
)

const allowedImportTiersBySourceTier: Record<QueueTier, readonly QueueTier[]> = {
  representation: ['representation'],
  adapter: ['representation', 'adapter'],
  application: ['representation', 'application', 'observability'],
  orchestration: ['representation', 'application', 'orchestration'],
  execution: [
    'representation',
    'adapter',
    'application',
    'orchestration',
    'execution',
    'observability',
  ],
  observability: ['representation', 'adapter', 'observability'],
}

const allowedJobContractImports = new Set([
  'node:crypto',
  'zod',
  '../env.js',
  '../platform/collection-state.js',
  '../platform/resource-batch-contract.js',
])

export const declaredQueueModules = Object.freeze(
  Object.values(modulesByTier)
    .flat()
    .toSorted((left, right) => left.localeCompare(right)),
)

export interface QueueSource {
  readonly path: string
  readonly source: string
}

export function queueBoundaryViolations(sources: readonly QueueSource[]) {
  return [
    ...membershipViolations(sources),
    ...sources.flatMap(violationsForSource),
    ...dependencyCycleViolations(sources),
  ].toSorted((left, right) => left.localeCompare(right))
}

function membershipViolations(sources: readonly QueueSource[]) {
  const violations: string[] = []
  const declaredCounts = new Map<string, number>()
  for (const modules of Object.values(modulesByTier))
    for (const module of modules) declaredCounts.set(module, (declaredCounts.get(module) ?? 0) + 1)

  for (const [module, count] of declaredCounts)
    if (count > 1) violations.push(`Queue module ${module} has multiple declared tiers`)

  const sourceCounts = new Map<string, number>()
  for (const source of sources) {
    const module = moduleName(source.path)
    sourceCounts.set(module, (sourceCounts.get(module) ?? 0) + 1)
  }
  for (const [module, count] of sourceCounts)
    if (count > 1) violations.push(`Queue module ${module} has ${count} source files`)
  for (const module of declaredQueueModules)
    if (!sourceCounts.has(module))
      violations.push(`Declared queue module ${module} has no source file`)

  return violations
}

function violationsForSource(source: QueueSource) {
  const module = moduleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) return [`${source.path}: Queue module ${module} has no declared tier`]

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) =>
    violationsForImport(source.path, module, sourceTier, specifier),
  )
}

function violationsForImport(
  path: string,
  module: string,
  sourceTier: QueueTier,
  specifier: string,
) {
  const importedPath = relativeImportPath(path, specifier)
  if (importedPath?.startsWith('api/src/esi-gateway/'))
    return [`${path}: Queue module ${module} cannot import ESI gateway module ${specifier}`]
  if (module === 'job-contracts' && !allowedJobContractImports.has(specifier))
    return [`${path}: Job contract module cannot import non-contract dependency ${specifier}`]

  const importedModule = localModuleName(path, specifier)
  if (!importedModule) return []
  const importedTier = tierByModule.get(importedModule)
  if (!importedTier || allowedImportTiersBySourceTier[sourceTier].includes(importedTier)) return []
  return [
    `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
  ]
}

function dependencyCycleViolations(sources: readonly QueueSource[]) {
  return findDependencyCycles(
    sources,
    ({ path }) => moduleName(path),
    ({ path, source }) =>
      typescriptModuleSpecifiers(path, source).map((specifier) => localModuleName(path, specifier)),
  ).map((cycle) => `Queue dependency cycle: ${cycle}`)
}

function moduleName(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const marker = 'api/src/queue/'
  const relativePath = normalized.includes(marker)
    ? normalized.slice(normalized.lastIndexOf(marker) + marker.length)
    : normalized
  const extension = posix.extname(relativePath)
  return relativePath.slice(0, extension ? -extension.length : undefined)
}

function localModuleName(sourcePath: string, specifier: string) {
  const importedPath = relativeImportPath(sourcePath, specifier)
  return importedPath?.startsWith('api/src/queue/') ? moduleName(importedPath) : undefined
}

function relativeImportPath(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined
  const normalizedSource = sourcePath.replaceAll('\\', '/')
  return posix.normalize(posix.join(posix.dirname(normalizedSource), specifier))
}
