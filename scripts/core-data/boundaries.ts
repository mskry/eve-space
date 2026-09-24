import { posix } from 'node:path'
import ts from 'typescript'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  adapter: [
    'published-skill-catalogue-adapter',
    'published-type-details-adapter',
    'published-type-groups-adapter',
    'static-location-labels-adapter',
  ],
  'adapter-support': ['sde-product-adapter'],
  capability: ['capabilities'],
  catalog: ['product-catalog'],
  declaration: ['coverage-manifest'],
  reporting: ['coverage-report'],
  validation: ['coverage-validation'],
} as const

type CoreDataTier = keyof typeof modulesByTier

const tierByModule = new Map<string, CoreDataTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as CoreDataTier]),
  ),
)

const allowedImportTiers: Record<CoreDataTier, readonly CoreDataTier[]> = {
  adapter: ['adapter-support'],
  'adapter-support': [],
  capability: ['catalog'],
  catalog: ['adapter'],
  declaration: [],
  reporting: ['declaration'],
  validation: ['declaration', 'catalog'],
}

const allowedPackages: Record<CoreDataTier, ReadonlySet<string>> = {
  adapter: new Set([
    '@eve-space/core-data-contract',
    '@eve-space/core-eve-projections/skill-training',
    'postgres',
  ]),
  'adapter-support': new Set(['@eve-space/core-data-contract', 'postgres']),
  capability: new Set(['@eve-space/core-data-contract']),
  catalog: new Set(['@eve-space/core-data-contract']),
  declaration: new Set(['@eve-space/core-data-contract']),
  reporting: new Set(),
  validation: new Set(['@eve-space/core-data-contract']),
}

const allowedAdapterSources = new Set(['api/src/db/client', 'api/src/universe/database-read'])

const allowedConsumers = new Map<string, ReadonlySet<string>>([
  ['api/src/server', new Set(['product-catalog', 'coverage-validation'])],
  ['api/src/worker', new Set(['product-catalog', 'coverage-validation'])],
  ['api/src/platform/module-activity-provider-capabilities', new Set(['capabilities'])],
  ['api/src/platform/module-route-capabilities', new Set(['capabilities'])],
  ['api/src/platform/resource-declarations', new Set(['capabilities'])],
])

const genericDispatcherNames = new Set([
  'dispatchCoreDataProduct',
  'executeCoreDataProduct',
  'loadCoreDataProduct',
  'readCoreDataProduct',
])

export interface CoreDataBoundarySource {
  readonly path: string
  readonly source: string
}

export function coreDataBoundaryViolations(sources: readonly CoreDataBoundarySource[]) {
  const implementationSources = sources.filter(({ path }) => isCoreDataImplementation(path))
  return [
    ...sources.flatMap(violationsForSource),
    ...dependencyCycleViolations(implementationSources),
  ].toSorted((left, right) => left.localeCompare(right))
}

function violationsForSource(source: CoreDataBoundarySource) {
  const dynamicImportViolations = nonLiteralDynamicImportViolations(source)
  if (isContractSource(source.path)) {
    return [...dynamicImportViolations, ...contractViolations(source)]
  }
  if (isCoreDataImplementation(source.path)) {
    return [...dynamicImportViolations, ...implementationViolations(source)]
  }
  return [...dynamicImportViolations, ...consumerViolations(source)]
}

function nonLiteralDynamicImportViolations(source: CoreDataBoundarySource) {
  const sourceFile = ts.createSourceFile(source.path, source.source, ts.ScriptTarget.Latest, true)
  const violations: string[] = []
  visit(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      (node.arguments.length !== 1 || !isLiteralModuleSpecifier(node.arguments[0]))
    ) {
      violations.push(`${source.path}: core-data dynamic imports must use string literals`)
    }
  })
  return violations
}

function contractViolations(source: CoreDataBoundarySource) {
  const violations = typescriptModuleSpecifiers(source.path, source.source).map(
    (specifier) => `${source.path}: pure core-data contract cannot import ${specifier}`,
  )
  return [...violations, ...genericDispatcherViolations(source)]
}

function implementationViolations(source: CoreDataBoundarySource) {
  const module = moduleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) {
    return [`${source.path}: core-data module ${module} has no declared tier`]
  }

  const violations = typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    const importedPath = relativeImportPath(source.path, specifier)
    if (importedPath?.startsWith('api/src/core-data/')) {
      const importedModule = moduleName(importedPath)
      const importedTier = tierByModule.get(importedModule)
      if (!importedTier) {
        return [
          `${source.path}: ${sourceTier} module ${module} imports undeclared core-data module ${importedModule}`,
        ]
      }
      if (allowedImportTiers[sourceTier].includes(importedTier)) {
        return []
      }
      return [
        `${source.path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
      ]
    }
    if (importedPath) {
      if (
        (sourceTier === 'adapter' || sourceTier === 'adapter-support') &&
        allowedAdapterSources.has(stripExtension(importedPath))
      ) {
        return []
      }
      return [
        `${source.path}: ${sourceTier} module ${module} cannot import source implementation ${specifier}`,
      ]
    }
    if (allowedPackages[sourceTier].has(specifier)) {
      return []
    }
    return [`${source.path}: ${sourceTier} module ${module} cannot import package ${specifier}`]
  })
  return [...violations, ...genericDispatcherViolations(source)]
}

function consumerViolations(source: CoreDataBoundarySource) {
  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    const importedPath = relativeImportPath(source.path, specifier)
    if (!importedPath?.startsWith('api/src/core-data/')) {
      return []
    }
    const consumer = stripExtension(source.path.replaceAll('\\', '/'))
    const importedModule = moduleName(importedPath)
    if (allowedConsumers.get(consumer)?.has(importedModule)) {
      return []
    }
    return [
      `${source.path}: only approved startup and platform capability integration may import core-data module ${importedModule}`,
    ]
  })
}

function genericDispatcherViolations(source: CoreDataBoundarySource) {
  const sourceFile = ts.createSourceFile(source.path, source.source, ts.ScriptTarget.Latest, true)
  const violations: string[] = []
  visit(sourceFile, (node) => {
    const name = declarationName(node)
    if (name && genericDispatcherNames.has(name)) {
      violations.push(`${source.path}: core-data must not expose generic dispatcher ${name}`)
    }
    if (
      ts.isIndexSignatureDeclaration(node) &&
      node.parent &&
      ts.isInterfaceDeclaration(node.parent) &&
      node.parent.name.text === 'CoreDataMethods'
    ) {
      violations.push(`${source.path}: CoreDataMethods must declare exact product methods`)
    }
  })
  return violations
}

function dependencyCycleViolations(sources: readonly CoreDataBoundarySource[]) {
  return findDependencyCycles(
    sources,
    ({ path }) => moduleName(path),
    ({ path, source }) =>
      typescriptModuleSpecifiers(path, source).map((specifier) => {
        const importedPath = relativeImportPath(path, specifier)
        return importedPath?.startsWith('api/src/core-data/') ? moduleName(importedPath) : undefined
      }),
  ).map((cycle) => `Core-data dependency cycle: ${cycle}`)
}

function declarationName(node: ts.Node) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodSignature(node)
  ) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text
  }
}

function isContractSource(path: string) {
  return path.replaceAll('\\', '/').startsWith('packages/core-data-contract/src/')
}

function isCoreDataImplementation(path: string) {
  return path.replaceAll('\\', '/').startsWith('api/src/core-data/') && path.endsWith('.ts')
}

function moduleName(path: string) {
  return posix.basename(stripExtension(path.replaceAll('\\', '/')))
}

function relativeImportPath(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) {
    return
  }
  return posix.normalize(posix.join(posix.dirname(sourcePath.replaceAll('\\', '/')), specifier))
}

function stripExtension(path: string) {
  const extension = posix.extname(path)
  return path.slice(0, extension ? -extension.length : undefined)
}

function isLiteralModuleSpecifier(node: ts.Expression | undefined) {
  return !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}
