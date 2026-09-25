import { basename, extname } from 'node:path'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  adapter: [
    'activity-context',
    'authority',
    'character-detachment-guards',
    'compliance-access',
    'context',
    'corporation-membership',
    'corporation-role-demand',
    'corporation-role-diagnostics',
    'group-assignment-store',
    'managed-member-lifecycle',
    'managed-corporations',
    'member-block',
    'organization-lock',
    'permission-catalog-store',
    'reviewer-account-search',
    'reviewer-group-policy',
    'reviewer-organization-snapshot',
    'reviewer-target',
    'roster-collection',
    'roster-coverage',
    'source-role-evidence',
  ],
  application: [
    'activity',
    'block-store',
    'authority-convergence',
    'compliance',
    'compliance-details',
    'corporation-role-bootstrap',
    'corporation-role-convergence',
    'corporation-role-refresh',
    'corporation-sources',
    'exception-store',
    'group-store',
    'owner-claim',
    'owner-source-replacement',
    'policy-store',
    'reviewer-commands',
    'role-store',
  ],
  entry: ['compliance-repair'],
  observability: [
    'audit',
    'audit-history',
    'entitlement-transitions',
    'group-audit',
    'permission-bundle-audit',
    'sensitive-access-audit',
  ],
  policy: [
    'access-policy',
    'affiliation-freshness',
    'authority-policy',
    'compliance-evaluator',
    'freshness',
    'group-mutation-error',
    'managed-corporation-evidence',
    'owner-claim-policy',
    'permission-catalog-policy',
    'registration-policy',
  ],
  service: [
    'effective-authority',
    'group-assignment-expiry',
    'group-compliance',
    'group-permissions',
    'management-authority',
    'module-authorization',
  ],
  transport: [
    'route-middleware',
    'routes',
    'routes-governance',
    'routes-management',
    'routes-member',
    'routes-review',
  ],
} as const

type OrganizationTier = keyof typeof modulesByTier

const tierByModule = new Map<string, OrganizationTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as OrganizationTier]),
  ),
)

const allowedImportTiersBySourceTier: Record<OrganizationTier, readonly OrganizationTier[]> = {
  adapter: ['policy', 'adapter'],
  application: ['policy', 'adapter', 'observability', 'service', 'application'],
  entry: ['policy', 'adapter', 'observability', 'service', 'application', 'entry'],
  observability: ['policy', 'observability'],
  policy: ['policy'],
  service: ['policy', 'adapter', 'observability', 'service'],
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
  if (!sourceTier) {
    return [`${source.path}: Organization module ${module} has no declared tier`]
  }

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    if (sourceTier === 'policy' && !specifier.startsWith('./')) {
      return [
        `${source.path}: policy module ${module} cannot import outside organization: ${specifier}`,
      ]
    }
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
  if (!importedModule) {
    return []
  }

  const importedTier = tierByModule.get(importedModule)
  if (!importedTier || allowedImportTiersBySourceTier[sourceTier].includes(importedTier)) {
    return []
  }

  return [
    `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
  ]
}

function dependencyCycleViolations(sources: readonly OrganizationSource[]) {
  return findDependencyCycles(
    sources,
    ({ path }) => moduleName(path),
    ({ path, source }) => typescriptModuleSpecifiers(path, source).map(localModuleName),
  ).map((cycle) => `Organization dependency cycle: ${cycle}`)
}

function moduleName(path: string) {
  const filename = basename(path)
  return filename.slice(0, -extname(filename).length)
}

function localModuleName(specifier: string) {
  if (!specifier.startsWith('./')) {
    return
  }
  return moduleName(specifier)
}
