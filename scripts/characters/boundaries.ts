import { posix } from 'node:path'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  'pure-leaf': ['finance-pagination', 'resource-failure'],
  'read-projection': [
    'assets',
    'attributes',
    'clones',
    'contracts',
    'corporation-roles',
    'finance-location-names',
    'finance-type-names',
    'history',
    'market',
    'overview',
    'profile',
    'skill-catalogue',
    'skill-queue',
    'skills',
    'wallet',
  ],
  'affiliation-use-case': ['affiliation-planning', 'affiliation-sync'],
  'route-adapter': [
    'assets-routes',
    'clones-routes',
    'core-routes',
    'finance-routes',
    'history-routes',
    'progression-routes',
    'public-routes',
    'route-responses',
    'routes',
  ],
} as const

type CharacterTier = keyof typeof modulesByTier

export interface CharacterModuleDeclaration {
  readonly module: string
  readonly tier: CharacterTier
}

export const characterModuleDeclarations: readonly CharacterModuleDeclaration[] = Object.freeze(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => ({ module, tier: tier as CharacterTier })),
  ),
)

export const declaredCharacterModules = Object.freeze(
  characterModuleDeclarations
    .map(({ module }) => module)
    .toSorted((left, right) => left.localeCompare(right)),
)

const allowedImportTiersBySourceTier: Record<CharacterTier, readonly CharacterTier[]> = {
  'pure-leaf': ['pure-leaf'],
  'read-projection': ['pure-leaf', 'read-projection'],
  'affiliation-use-case': ['pure-leaf', 'read-projection', 'affiliation-use-case'],
  'route-adapter': ['pure-leaf', 'read-projection', 'affiliation-use-case', 'route-adapter'],
}

const allowedPackagesByTier: Record<CharacterTier, ReadonlySet<string>> = {
  'pure-leaf': new Set(),
  'read-projection': new Set(['drizzle-orm']),
  'affiliation-use-case': new Set(['drizzle-orm']),
  'route-adapter': new Set(['hono', 'zod']),
}

const allowedCrossSubsystemImportsByModule: Readonly<Record<string, readonly string[]>> = {
  'affiliation-planning': ['api/src/esi-gateway/failures'],
  'affiliation-sync': [
    'api/src/db/client',
    'api/src/db/schema',
    'api/src/domain-events/store',
    'api/src/env',
    'api/src/esi-gateway/feature-execution',
  ],
  assets: [
    'api/src/db/client',
    'api/src/db/schema',
    'api/src/esi-gateway/feature-execution',
    'api/src/type-guards',
    'api/src/universe/names',
    'api/src/universe/static-locations',
  ],
  'assets-routes': [
    'api/src/http/private-response',
    'api/src/http/validation',
    'api/src/middleware/auth-session',
    'api/src/middleware/owned-character',
  ],
  attributes: ['api/src/esi-gateway/feature-execution'],
  clones: [
    'api/src/db/client',
    'api/src/db/schema',
    'api/src/esi-gateway/feature-execution',
    'api/src/type-guards',
    'api/src/universe/implant-attributes',
    'api/src/universe/names',
  ],
  'clones-routes': [
    'api/src/http/private-response',
    'api/src/http/validation',
    'api/src/middleware/auth-session',
    'api/src/middleware/owned-character',
  ],
  contracts: ['api/src/esi-gateway/feature-execution'],
  'core-routes': [
    'api/src/auth/character-lifecycle',
    'api/src/esi-gateway/feature-execution',
    'api/src/http/private-response',
    'api/src/http/validation',
    'api/src/middleware/auth-session',
    'api/src/middleware/owned-character',
  ],
  'corporation-roles': ['api/src/esi-gateway/feature-execution'],
  'finance-location-names': ['api/src/type-guards', 'api/src/universe/names'],
  'finance-pagination': ['api/src/type-guards'],
  'finance-routes': [
    'api/src/http/private-response',
    'api/src/http/validation',
    'api/src/middleware/auth-session',
    'api/src/middleware/owned-character',
  ],
  'finance-type-names': ['api/src/db/client', 'api/src/db/schema', 'api/src/type-guards'],
  history: ['api/src/esi-gateway/feature-execution', 'api/src/universe/names'],
  'history-routes': [
    'api/src/esi-gateway/failures',
    'api/src/http/private-response',
    'api/src/http/validation',
    'api/src/middleware/auth-session',
    'api/src/middleware/owned-character',
  ],
  market: ['api/src/esi-gateway/feature-execution'],
  overview: ['api/src/esi-gateway/feature-execution', 'api/src/universe/locations'],
  profile: [
    'api/src/alliances/public-data',
    'api/src/corporations/public-data',
    'api/src/esi-gateway/feature-execution',
    'api/src/text/eve-description',
  ],
  'progression-routes': [
    'api/src/http/private-response',
    'api/src/http/validation',
    'api/src/middleware/auth-session',
    'api/src/middleware/owned-character',
  ],
  'public-routes': [
    'api/src/esi-gateway/failures',
    'api/src/http/private-response',
    'api/src/http/public-rate-limit',
    'api/src/http/validation',
  ],
  'resource-failure': ['api/src/auth/token-errors', 'api/src/esi-gateway/failures'],
  'route-responses': ['api/src/env', 'api/src/esi-gateway/feature-execution'],
  routes: ['api/src/middleware/owned-character'],
  'skill-catalogue': ['api/src/db/client', 'api/src/db/schema', 'api/src/skills/training'],
  'skill-queue': [
    'api/src/db/client',
    'api/src/db/schema',
    'api/src/esi-gateway/feature-execution',
    'api/src/skills/training',
  ],
  skills: ['api/src/esi-gateway/feature-execution'],
  wallet: ['api/src/esi-gateway/feature-execution', 'api/src/type-guards'],
}

const restrictedReadPrefixes = ['api/src/alliances/', 'api/src/corporations/', 'api/src/universe/']
const esiGatewayPrefix = 'api/src/esi-gateway/'

export interface CharacterSource {
  readonly path: string
  readonly source: string
}

interface CharacterBoundaryModel {
  readonly declarationsByModule: ReadonlyMap<string, readonly CharacterModuleDeclaration[]>
  readonly sourcesByModule: ReadonlyMap<string, readonly CharacterSource[]>
}

export function characterBoundaryViolations(
  sources: readonly CharacterSource[],
  declarations: readonly CharacterModuleDeclaration[] = characterModuleDeclarations,
) {
  const model = createBoundaryModel(sources, declarations)
  return [
    ...membershipViolations(model),
    ...sources.flatMap((source) => violationsForSource(source, model)),
    ...dependencyCycleViolations(sources, model),
  ].toSorted((left, right) => left.localeCompare(right))
}

function createBoundaryModel(
  sources: readonly CharacterSource[],
  declarations: readonly CharacterModuleDeclaration[],
): CharacterBoundaryModel {
  return {
    declarationsByModule: groupBy(declarations, ({ module }) => module),
    sourcesByModule: groupBy(sources, ({ path }) => moduleName(path)),
  }
}

function membershipViolations(model: CharacterBoundaryModel) {
  const violations: string[] = []
  for (const [module, declarations] of model.declarationsByModule) {
    if (!model.sourcesByModule.has(module))
      violations.push(`Declared character module ${module} has no source file`)
    if (declarations.length > 1)
      violations.push(
        `Character module ${module} has duplicate tier declarations: ${declarations.map(({ tier }) => tier).join(', ')}`,
      )
  }
  for (const [module, sources] of model.sourcesByModule) {
    if (!model.declarationsByModule.has(module))
      violations.push(`${sources[0]!.path}: Character module ${module} has no declared tier`)
    if (sources.length > 1)
      violations.push(
        `Character module ${module} has duplicate source ownership: ${sources.map(({ path }) => path).join(', ')}`,
      )
  }
  return violations
}

function violationsForSource(source: CharacterSource, model: CharacterBoundaryModel) {
  const module = moduleName(source.path)
  const sourceTier = declaredTier(model, module)
  if (!sourceTier || model.sourcesByModule.get(module)?.length !== 1) return []

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) =>
    violationsForImport(source.path, module, sourceTier, specifier, model),
  )
}

function violationsForImport(
  path: string,
  module: string,
  sourceTier: CharacterTier,
  specifier: string,
  model: CharacterBoundaryModel,
) {
  const dependency = dependencyIdentity(path, specifier)
  const importedModule = characterModuleName(dependency)
  if (importedModule)
    return violationsForCharacterModuleImport(path, module, sourceTier, importedModule, model)

  if (isPackageOrSubpath(dependency, 'hono') && sourceTier !== 'route-adapter')
    return [`${path}: ${sourceTier} module ${module} cannot import Hono`]
  if (isPackageOrSubpath(dependency, 'bullmq'))
    return [`${path}: Character module ${module} cannot import BullMQ`]
  if (dependency.startsWith('api/src/queue/'))
    return [`${path}: Character module ${module} cannot import queue module ${specifier}`]
  if (dependency.startsWith(`${esiGatewayPrefix}internal/`))
    return [`${path}: Character module ${module} cannot import ESI gateway internals`]
  if (isPackageOrSubpath(dependency, '@evespace/esi-client')) {
    if (
      (sourceTier === 'read-projection' || sourceTier === 'affiliation-use-case') &&
      (dependency === '@evespace/esi-client/operations' ||
        dependency === '@evespace/esi-client/types')
    )
      return []
    return [
      `${path}: Character module ${module} cannot import ESI SDK runtime surface ${specifier}`,
    ]
  }

  const allowedImports = new Set(allowedCrossSubsystemImportsByModule[module] ?? [])
  const isRestrictedRead = restrictedReadPrefixes.some((prefix) => dependency.startsWith(prefix))
  if (isRestrictedRead && !allowedImports.has(dependency))
    return [
      `${path}: Character module ${module} cannot import unapproved cross-subsystem read ${specifier}`,
    ]
  if (allowedImports.has(dependency) || allowedPackagesByTier[sourceTier].has(dependency)) return []
  return [
    `${path}: ${sourceTier} module ${module} cannot import unapproved dependency ${specifier}`,
  ]
}

function violationsForCharacterModuleImport(
  path: string,
  module: string,
  sourceTier: CharacterTier,
  importedModule: string,
  model: CharacterBoundaryModel,
) {
  const importedTier = declaredTier(model, importedModule)
  if (!importedTier)
    return [
      `${path}: ${sourceTier} module ${module} cannot import undeclared character module ${importedModule}`,
    ]
  if (!allowedImportTiersBySourceTier[sourceTier].includes(importedTier))
    return [
      `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
    ]
  return []
}

function dependencyCycleViolations(
  sources: readonly CharacterSource[],
  model: CharacterBoundaryModel,
) {
  const uniquelyOwnedSources = sources.filter(({ path }) => {
    const module = moduleName(path)
    return model.sourcesByModule.get(module)?.length === 1 && declaredTier(model, module)
  })
  return findDependencyCycles(
    uniquelyOwnedSources,
    ({ path }) => moduleName(path),
    ({ path, source }) =>
      typescriptModuleSpecifiers(path, source).map((specifier) =>
        characterModuleName(dependencyIdentity(path, specifier)),
      ),
  ).map((cycle) => `Character dependency cycle: ${cycle}`)
}

function declaredTier(model: CharacterBoundaryModel, module: string) {
  const declarations = model.declarationsByModule.get(module)
  return declarations?.length === 1 ? declarations[0]!.tier : undefined
}

function moduleName(path: string) {
  const relativePath = characterRelativePath(path)
  const extension = posix.extname(relativePath)
  return relativePath.slice(0, extension ? -extension.length : undefined)
}

function characterModuleName(path: string) {
  const marker = 'api/src/characters/'
  return path.startsWith(marker) ? moduleName(path) : undefined
}

function characterRelativePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const marker = 'api/src/characters/'
  const markerIndex = normalized.lastIndexOf(marker)
  return markerIndex === -1 ? normalized : normalized.slice(markerIndex + marker.length)
}

function dependencyIdentity(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) return specifier
  const normalizedSource = sourcePath.replaceAll('\\', '/')
  const marker = 'api/src/characters/'
  const markerIndex = normalizedSource.lastIndexOf(marker)
  const workspaceSource =
    markerIndex === -1 ? normalizedSource : normalizedSource.slice(markerIndex)
  return posix
    .normalize(posix.join(posix.dirname(workspaceSource), specifier))
    .replace(/\.(?:[cm]?js|ts)$/, '')
}

function isPackageOrSubpath(dependency: string, packageName: string) {
  return dependency === packageName || dependency.startsWith(`${packageName}/`)
}

function groupBy<Value>(values: readonly Value[], keyForValue: (value: Value) => string) {
  const grouped = new Map<string, Value[]>()
  for (const value of values) {
    const key = keyForValue(value)
    const group = grouped.get(key)
    if (group) group.push(value)
    else grouped.set(key, [value])
  }
  return grouped
}
