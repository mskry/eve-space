import { posix } from 'node:path'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  policy: ['sso-errors', 'token-errors'],
  primitive: ['security'],
  persistence: [
    'character-lock',
    'character-token-store',
    'character-transfer-store',
    'oauth-state-store',
    'session-store',
  ],
  provider: ['sso'],
  application: [
    'character-lifecycle',
    'character-transfer',
    'character-transfer-approvals',
    'tokens',
  ],
  transport: ['routes'],
} as const

type AuthTier = keyof typeof modulesByTier

export interface AuthModuleDeclaration {
  readonly module: string
  readonly tier: AuthTier
}

export const authModuleDeclarations: readonly AuthModuleDeclaration[] = Object.freeze(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => ({ module, tier: tier as AuthTier })),
  ),
)

const allowedImportTiersBySourceTier: Record<AuthTier, readonly AuthTier[]> = {
  policy: ['policy'],
  primitive: ['policy', 'primitive'],
  persistence: ['primitive', 'persistence'],
  provider: ['policy', 'primitive', 'provider'],
  application: ['policy', 'primitive', 'persistence', 'provider', 'application'],
  transport: ['policy', 'primitive', 'persistence', 'provider', 'application', 'transport'],
}

const allowedExternalImportsByTier: Partial<Record<AuthTier, ReadonlySet<string>>> = {
  policy: new Set(),
  primitive: new Set(['node:crypto', 'node:util', 'api/src/env.js']),
  provider: new Set(['jose', 'zod', 'api/src/env.js']),
}

const persistenceImports: Record<string, ReadonlySet<string>> = {
  'character-lock': new Set([
    'drizzle-orm',
    'api/src/db/client.js',
    'api/src/db/locks.js',
    'api/src/env.js',
  ]),
  'character-token-store': new Set([
    'drizzle-orm',
    'api/src/db/client.js',
    'api/src/db/schema.js',
    'api/src/env.js',
    'api/src/scopes.js',
    'api/src/auth/character-lock.js',
  ]),
  'character-transfer-store': new Set([
    'drizzle-orm',
    'api/src/db/client.js',
    'api/src/db/schema.js',
  ]),
  'oauth-state-store': new Set([
    'drizzle-orm',
    'api/src/db/client.js',
    'api/src/db/schema.js',
    'api/src/auth/security.js',
  ]),
  'session-store': new Set([
    'drizzle-orm',
    'api/src/db/client.js',
    'api/src/db/schema.js',
    'api/src/auth/security.js',
  ]),
}

export const declaredAuthModules = Object.freeze(
  authModuleDeclarations
    .map(({ module }) => module)
    .toSorted((left, right) => left.localeCompare(right)),
)

export interface AuthSource {
  readonly path: string
  readonly source: string
}

interface AuthBoundaryModel {
  readonly declarationsByModule: ReadonlyMap<string, readonly AuthModuleDeclaration[]>
  readonly sourcesByModule: ReadonlyMap<string, readonly AuthSource[]>
}

export function authImportViolations(
  sources: readonly AuthSource[],
  declarations: readonly AuthModuleDeclaration[] = authModuleDeclarations,
) {
  const model = createBoundaryModel(sources, declarations)
  return [
    ...declarationViolations(model),
    ...sources.flatMap((source) => violationsForSource(source, model)),
    ...dependencyCycleViolations(sources, model),
  ].toSorted((left, right) => left.localeCompare(right))
}

function createBoundaryModel(
  sources: readonly AuthSource[],
  declarations: readonly AuthModuleDeclaration[],
): AuthBoundaryModel {
  return {
    declarationsByModule: groupBy(declarations, ({ module }) => module),
    sourcesByModule: groupBy(sources, ({ path }) => moduleName(path)),
  }
}

function declarationViolations(model: AuthBoundaryModel) {
  const violations: string[] = []
  for (const [module, declarations] of model.declarationsByModule) {
    if (!model.sourcesByModule.has(module))
      violations.push(`Declared auth module ${module} has no source file`)
    if (declarations.length > 1)
      violations.push(
        `Auth module ${module} has duplicate tier declarations: ${declarations.map(({ tier }) => tier).join(', ')}`,
      )
  }
  for (const [module, sources] of model.sourcesByModule) {
    if (!model.declarationsByModule.has(module))
      violations.push(`${sources[0]!.path}: Auth module ${module} has no declared tier`)
    if (sources.length > 1)
      violations.push(
        `Auth module ${module} has duplicate source ownership: ${sources.map(({ path }) => path).join(', ')}`,
      )
  }
  return violations
}

function violationsForSource(source: AuthSource, model: AuthBoundaryModel) {
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
  sourceTier: AuthTier,
  specifier: string,
  model: AuthBoundaryModel,
) {
  const dependency = dependencyIdentity(path, specifier)
  const importedModule = authModuleName(dependency)
  if (importedModule) {
    const importedTier = declaredTier(model, importedModule)
    if (!importedTier)
      return [
        `${path}: ${sourceTier} module ${module} cannot import undeclared auth module ${importedModule}`,
      ]
    if (!allowedImportTiersBySourceTier[sourceTier].includes(importedTier))
      return [
        `${path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
      ]
    if (sourceTier !== 'persistence') return []
  }

  const allowedImports =
    sourceTier === 'persistence'
      ? persistenceImports[module]
      : allowedExternalImportsByTier[sourceTier]
  if (allowedImports && !allowedImports.has(dependency))
    return [
      sourceTier === 'persistence'
        ? `${path}: persistence module ${module} cannot import ${specifier}`
        : `${path}: ${sourceTier} module ${module} cannot import external dependency ${specifier}`,
    ]
  return []
}

function dependencyCycleViolations(sources: readonly AuthSource[], model: AuthBoundaryModel) {
  const uniquelyOwnedSources = sources.filter(({ path }) => {
    const module = moduleName(path)
    return model.sourcesByModule.get(module)?.length === 1 && declaredTier(model, module)
  })
  return findDependencyCycles(
    uniquelyOwnedSources,
    ({ path }) => moduleName(path),
    ({ path, source }) =>
      typescriptModuleSpecifiers(path, source).map((specifier) =>
        authModuleName(dependencyIdentity(path, specifier)),
      ),
  ).map((cycle) => `Authentication dependency cycle: ${cycle}`)
}

function declaredTier(model: AuthBoundaryModel, module: string) {
  const declarations = model.declarationsByModule.get(module)
  return declarations?.length === 1 ? declarations[0]!.tier : undefined
}

function moduleName(path: string) {
  const relativePath = authRelativePath(path)
  const extension = posix.extname(relativePath)
  return relativePath.slice(0, extension ? -extension.length : undefined)
}

function authModuleName(path: string) {
  const marker = 'api/src/auth/'
  return path.startsWith(marker) ? moduleName(path) : undefined
}

function authRelativePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const marker = 'api/src/auth/'
  const markerIndex = normalized.lastIndexOf(marker)
  return markerIndex === -1 ? normalized : normalized.slice(markerIndex + marker.length)
}

function dependencyIdentity(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) return specifier
  const normalizedSource = sourcePath.replaceAll('\\', '/')
  const marker = 'api/src/auth/'
  const markerIndex = normalizedSource.lastIndexOf(marker)
  const workspaceSource =
    markerIndex === -1 ? normalizedSource : normalizedSource.slice(markerIndex)
  return posix.normalize(posix.join(posix.dirname(workspaceSource), specifier))
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
