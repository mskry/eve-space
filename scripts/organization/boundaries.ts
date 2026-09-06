import { basename, extname } from 'node:path'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  policy: [
    'access-policy',
    'affiliation-freshness',
    'authority-policy',
    'compliance-evaluator',
    'group-mutation-error',
    'owner-claim-policy',
    'registration-policy',
  ],
  adapter: [
    'activity-context',
    'authority',
    'compliance-access',
    'context',
    'corporation-membership',
    'group-assignment-store',
    'managed-corporations',
    'organization-lock',
    'roster-collection',
    'roster-coverage',
  ],
  observability: ['audit', 'entitlement-transitions', 'group-audit'],
  service: [
    'group-assignment-expiry',
    'group-compliance',
    'group-permissions',
    'management-authority',
    'module-authorization',
    'owner-evidence',
  ],
  application: [
    'activity',
    'block-store',
    'compliance',
    'compliance-details',
    'corporation-sources',
    'exception-store',
    'group-store',
    'owner-claim',
    'policy-store',
    'role-store',
  ],
  entry: ['compliance-repair'],
  transport: ['routes'],
} as const

type OrganizationTier = keyof typeof modulesByTier

const tierByModule = new Map<string, OrganizationTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as OrganizationTier]),
  ),
)

const allowedImportTiersBySourceTier: Record<OrganizationTier, readonly OrganizationTier[]> = {
  policy: ['policy'],
  adapter: ['policy', 'adapter'],
  observability: ['policy', 'observability'],
  service: ['policy', 'adapter', 'observability', 'service'],
  application: ['policy', 'adapter', 'observability', 'service', 'application'],
  entry: ['policy', 'adapter', 'observability', 'service', 'application', 'entry'],
  transport: ['policy', 'adapter', 'observability', 'service', 'application', 'transport'],
}

export interface OrganizationSource {
  readonly path: string
  readonly source: string
}

export function organizationImportViolations(sources: readonly OrganizationSource[]) {
  return [...sources.flatMap(violationsForSource), ...dependencyCycleViolations(sources)].toSorted(
    (left, right) => left.localeCompare(right),
  )
}

function violationsForSource(source: OrganizationSource) {
  const module = moduleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) return [`${source.path}: Organization module ${module} has no declared tier`]

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    if (sourceTier === 'policy' && !specifier.startsWith('./'))
      return [
        `${source.path}: policy module ${module} cannot import outside organization: ${specifier}`,
      ]
    return violationsForImport(source.path, module, sourceTier, specifier)
  })
}

function violationsForImport(
  path: string,
  module: string,
  sourceTier: OrganizationTier,
  specifier: string,
) {
  const importedModule = localModuleName(specifier)
  if (!importedModule) return []

  const importedTier = tierByModule.get(importedModule)
  if (!importedTier || allowedImportTiersBySourceTier[sourceTier].includes(importedTier)) return []

  return [
    `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
  ]
}

function dependencyCycleViolations(sources: readonly OrganizationSource[]) {
  const sourceModules = new Set(sources.map(({ path }) => moduleName(path)))
  const dependencies = new Map(
    sources.map((source) => [
      moduleName(source.path),
      typescriptModuleSpecifiers(source.path, source.source)
        .map(localModuleName)
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
  return [...cycles].map((cycle) => `Organization dependency cycle: ${cycle}`)
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
  const filename = basename(path)
  return filename.slice(0, -extname(filename).length)
}

function localModuleName(specifier: string) {
  if (!specifier.startsWith('./')) return undefined
  return moduleName(specifier)
}
