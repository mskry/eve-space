import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { parse as parseVue } from 'vue/compiler-sfc'
import { CORE_DATA_PRODUCT_CONTRACTS } from '../../packages/core-data-contract/src/index.js'
import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'
import {
  platformModulePackageManifestIssues,
  platformModuleSourceIssues,
} from '@eve-space/platform-module-conformance/policy'
import type { ResolvedInstalledModuleRelease, ResolvedModulePackage } from './resolved-release.js'
import { forbiddenGlobalReferences } from './forbidden-global-references.js'
import { unwrapExpression } from './typescript-expressions.js'

const sourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
])
const symbolicLinkSource = '/* symbolic links are not valid feature package source */'
const forbiddenServerGlobals = new Set([
  'Function',
  'EventSource',
  'SharedWorker',
  'WebSocket',
  'Worker',
  'eval',
  'fetch',
  'module',
  'navigator',
  'process',
  'queueMicrotask',
  'require',
  'setImmediate',
  'setInterval',
  'setTimeout',
])

const forbiddenNuxtGlobals = new Set([
  'Function',
  'EventSource',
  'SharedWorker',
  'WebSocket',
  'Worker',
  'XMLHttpRequest',
  'eval',
  'fetch',
  'module',
  'navigator',
  'process',
  'require',
])

const definitionCalls = new Set([
  'defineNuxtModule',
  'definePlatformExecutableEsiOperation',
  'definePlatformBoundedCollectionResource',
  'definePlatformPersistenceOperation',
  'definePlatformSingleRequestResource',
])

const routeCompositionMethods = new Set([
  'basePath',
  'delete',
  'get',
  'head',
  'notFound',
  'on',
  'onError',
  'options',
  'patch',
  'post',
  'put',
  'route',
  'use',
])

const forbiddenCompositionCalls = new Set([
  '$fetch',
  'addDevServerHandler',
  'addServerHandler',
  'addServerImports',
  'addServerPlugin',
  'connect',
  'createConnection',
  'fetch',
  'installModule',
  'listen',
  'queueMicrotask',
  'requestAnimationFrame',
  'setImmediate',
  'setInterval',
  'setTimeout',
])

const forbiddenSdeIdentifiers = new Set([
  'sdebuilds',
  'sdedataset',
  'sdedatasetrows',
  'sdegroups',
  'sdetypes',
])

const sqlStatementPrefixes = [
  'alter function ',
  'alter procedure ',
  'alter role ',
  'alter schema ',
  'alter sequence ',
  'alter table ',
  'call ',
  'create extension ',
  'create function ',
  'create index ',
  'create procedure ',
  'create role ',
  'create schema ',
  'create sequence ',
  'create table ',
  'create type ',
  'delete from ',
  'drop extension ',
  'drop function ',
  'drop index ',
  'drop procedure ',
  'drop role ',
  'drop schema ',
  'drop sequence ',
  'drop table ',
  'drop type ',
  'grant ',
  'insert into ',
  'reset role',
  'reset session authorization',
  'revoke ',
  'set role ',
  'set session authorization ',
  'truncate ',
  'update ',
  'with ',
] as const

const genericPersistenceMethods = new Set([
  'call',
  'dispatch',
  'execute',
  'invoke',
  'query',
  'run',
  'transaction',
  'unsafe',
])

const coreDataProductReferences = new Set<string>([
  'coreData',
  ...Object.entries(CORE_DATA_PRODUCT_CONTRACTS).flatMap(([productId, contract]) => [
    productId,
    contract.method,
  ]),
])

export type FeaturePackageEnvironment = 'server' | 'nuxt'

export interface FeatureBoundarySource {
  readonly moduleId: string
  readonly path: string
  readonly source: string
  readonly boundaryRoot?: string
  readonly layout?: 'source' | 'artifact'
  readonly entry?: boolean
}

interface FeaturePackageManifest {
  readonly name?: unknown
  readonly type?: unknown
  readonly sideEffects?: unknown
  readonly dependencies?: unknown
  readonly devDependencies?: unknown
  readonly optionalDependencies?: unknown
  readonly peerDependencies?: unknown
  readonly exports?: unknown
}

export async function assertInstalledFeatureBoundaries(
  root: string,
  releases: readonly ResolvedInstalledModuleRelease[],
) {
  const violations = await installedFeatureBoundaryViolations(root, releases)
  if (violations.length > 0)
    throw new Error(`Feature module boundary verification failed:\n${violations.join('\n')}`)
}

export async function assertManifestCompositionBoundaries(
  root: string,
  release: ResolvedInstalledModuleRelease,
) {
  if (!release.packages.server.workspace) return
  const violations = await manifestCompositionBoundaryViolations(
    root,
    release.manifest,
    release.packages.server.root,
  )
  if (violations.length > 0)
    throw new Error(`Feature module composition verification failed:\n${violations.join('\n')}`)
}

export function featurePackageManifestViolations(
  moduleId: string,
  environment: FeaturePackageEnvironment,
  path: string,
  manifest: FeaturePackageManifest,
  expectedPackageName = `@eve-space/${moduleId}-${environment}`,
  requireWorkspaceSpecifiers = true,
) {
  return platformModulePackageManifestIssues({
    moduleId,
    environment,
    path,
    manifest,
    expectedPackageName,
    scope: 'source',
    requireWorkspaceSpecifiers,
  }).map(({ path: issuePath, message }) => `${issuePath}: ${lowercaseFirst(message)}`)
}

export function descriptorBoundaryViolations(source: FeatureBoundarySource) {
  const violations: string[] = []
  const sourceFile = parseTypescript(source.path, source.source, violations)
  let defaultExpression: ts.Expression | undefined
  const constants = new Map<string, ts.Expression>()

  for (const statement of sourceFile.statements)
    defaultExpression = validateDescriptorStatement(
      source.path,
      statement,
      constants,
      defaultExpression,
      violations,
    )

  if (!defaultExpression)
    violations.push(`${source.path}: module descriptor must default-export a static object`)
  else if (!isSerializableDescriptorExpression(defaultExpression, constants, new Set()))
    violations.push(`${source.path}: module descriptor must be a static serializable object`)
  return violations
}

export function serverSourceBoundaryViolations(source: FeatureBoundarySource) {
  const violations: string[] = []
  if (source.path.endsWith('.cjs') || source.path.endsWith('.cts'))
    violations.push(`${source.path}: feature packages must use ESM source files`)
  const packageRoot = source.boundaryRoot ?? `features/${source.moduleId}/server/src`
  violations.push(...portableImportViolations(source, packageRoot, 'server'))
  const sourceFiles = parseSourceFiles(source, violations)
  for (const sourceFile of sourceFiles) {
    validateServerRuntimeBoundaries(source.path, sourceFile, violations)
    validateCoreDataBypasses(source.path, sourceFile, violations)
    validateCompositionTopLevel(source.path, sourceFile, 'server', violations)
  }
  return violations
}

export function nuxtSourceBoundaryViolations(source: FeatureBoundarySource) {
  const violations: string[] = []
  if (source.path.endsWith('.cjs') || source.path.endsWith('.cts'))
    violations.push(`${source.path}: feature packages must use ESM source files`)
  const packageRoot = source.boundaryRoot ?? `features/${source.moduleId}/nuxt/src`
  const runtimePath = `/nuxt/src/runtime/app/`
  const sourceLayout = source.layout !== 'artifact'
  const isModuleSetup = sourceLayout
    ? /\/nuxt\/src\/module\.(?:[cm]?[jt]s)$/.test(source.path)
    : source.entry === true
  if (sourceLayout && !source.path.includes(runtimePath) && !isModuleSetup)
    violations.push(`${source.path}: Nuxt source must live under src/runtime/app`)

  violations.push(...portableImportViolations(source, packageRoot, 'nuxt'))
  const sourceFiles = parseSourceFiles(source, violations)
  for (const sourceFile of sourceFiles) {
    validateNuxtRuntimeBoundaries(source, sourceFile, violations)
    if (isModuleSetup) validateCompositionTopLevel(source.path, sourceFile, 'nuxt', violations)
  }
  return violations
}

function portableImportViolations(
  source: FeatureBoundarySource,
  boundaryRoot: string,
  environment: FeaturePackageEnvironment,
) {
  const importCodes = new Set([
    'ABSOLUTE_IMPORT_FORBIDDEN',
    'DYNAMIC_IMPORT_INVALID',
    'HOST_CONTRACT_IMPORT_FORBIDDEN',
    'IMPORT_EQUALS_FORBIDDEN',
    'IMPORT_ESCAPE',
    'IMPORT_NOT_ALLOWED',
    'NUXT_IMPORT_NOT_ALLOWED',
    'PUBLIC_CONTRACT_IMPORT_REQUIRED',
    'SIDE_EFFECT_IMPORT_FORBIDDEN',
  ])
  return platformModuleSourceIssues(
    {
      moduleId: source.moduleId,
      path: source.path,
      source: source.source,
      boundaryRoot,
      environment,
      scope: source.layout === 'artifact' ? 'artifact' : 'source',
    },
    new Set(),
  )
    .filter(({ code }) => importCodes.has(code))
    .map(({ path, message }) => `${path}: ${lowercaseFirst(message)}`)
}

export function serverFactoryBoundaryViolations(
  sources: readonly FeatureBoundarySource[],
  exportName: string,
  kind: 'route' | 'provider',
) {
  const matches = sources.flatMap((source) => {
    const violations: string[] = []
    return parseSourceFiles(source, violations).flatMap((sourceFile) => {
      const functions = findNamedFunctions(sourceFile, exportName)
      return functions.map((functionNode) => ({
        source,
        functionNode,
        parseViolations: violations,
      }))
    })
  })
  const violations = matches.flatMap(({ parseViolations }) => parseViolations)
  if (matches.length !== 1) {
    violations.push(
      `features/${sources[0]?.moduleId ?? 'unknown'}/server: ${kind} export ${exportName} must resolve to one local function declaration`,
    )
    return violations
  }
  const match = matches[0]!
  if (!isPackageRootExport(sources, match.source, exportName))
    violations.push(
      `features/${match.source.moduleId}/server: ${kind} export ${exportName} must be exported from the package root`,
    )
  validateFactory(match.source.path, match.functionNode, kind, violations)
  return violations
}

async function installedFeatureBoundaryViolations(
  root: string,
  releases: readonly ResolvedInstalledModuleRelease[],
) {
  const violations = await Promise.all(
    releases.map((release) => installedModuleBoundaryViolations(root, release)),
  )
  return violations.flat().toSorted((left, right) => left.localeCompare(right))
}

export async function manifestCompositionBoundaryViolations(
  root: string,
  manifest: PlatformModuleManifest,
  serverRoot = join(root, 'features', manifest.id, 'server'),
) {
  const sources = await loadSources(root, manifest.id, join(serverRoot, 'src'))
  const violations = [
    ...manifest.server.routes.flatMap(({ exportName }) =>
      serverFactoryBoundaryViolations(sources, exportName, 'route'),
    ),
    ...manifest.server.activityProviders.flatMap(({ exportName }) =>
      serverFactoryBoundaryViolations(sources, exportName, 'provider'),
    ),
  ]
  for (const contribution of [...manifest.server.resources, ...manifest.server.esiOperations]) {
    const matches = sources.flatMap((source) =>
      parseSourceFiles(source, violations).flatMap((sourceFile) =>
        findNamedDeclarations(sourceFile, contribution.exportName).map((declaration) => ({
          source,
          declaration,
        })),
      ),
    )
    if (matches.length !== 1)
      violations.push(
        `features/${manifest.id}/server: definition export ${contribution.exportName} must resolve to one local declaration`,
      )
    else if (!isPackageRootExport(sources, matches[0]!.source, contribution.exportName))
      violations.push(
        `features/${manifest.id}/server: definition export ${contribution.exportName} must be exported from the package root`,
      )
  }
  for (const operation of manifest.server.persistenceOperations)
    validatePersistenceDefinitionExport(sources, manifest.id, operation.exportName, violations)
  const declaredPersistenceDefinitions = new Set(
    manifest.server.persistenceOperations.map(({ exportName }) => exportName),
  )
  for (const definition of findPersistenceDefinitionExports(sources))
    if (!declaredPersistenceDefinitions.has(definition.exportName))
      violations.push(
        `${definition.path}: persistence definition export ${definition.exportName} is not declared by module ${manifest.id}`,
      )
  return violations.toSorted((left, right) => left.localeCompare(right))
}

function findPersistenceDefinitionExports(sources: readonly FeatureBoundarySource[]) {
  return sources.flatMap((source) =>
    parseSourceFiles(source, []).flatMap((sourceFile) =>
      sourceFile.statements.flatMap((statement) => {
        if (!ts.isVariableStatement(statement)) return []
        return statement.declarationList.declarations.flatMap((declaration) => {
          if (
            !ts.isIdentifier(declaration.name) ||
            !isPersistenceDefinitionDeclaration(declaration)
          )
            return []
          return [{ exportName: declaration.name.text, path: source.path }]
        })
      }),
    ),
  )
}

function validatePersistenceDefinitionExport(
  sources: readonly FeatureBoundarySource[],
  moduleId: string,
  exportName: string,
  violations: string[],
) {
  const matches = sources.flatMap((source) =>
    parseSourceFiles(source, violations).flatMap((sourceFile) =>
      findNamedDeclarations(sourceFile, exportName).map((declaration) => ({
        declaration,
        source,
      })),
    ),
  )
  if (matches.length !== 1) {
    violations.push(
      `features/${moduleId}/server: persistence definition export ${exportName} must resolve to one local declaration`,
    )
    return
  }
  const match = matches[0]!
  if (!isPersistenceDefinitionDeclaration(match.declaration))
    violations.push(
      `${match.source.path}: persistence definition export ${exportName} must directly call definePlatformPersistenceOperation`,
    )
  if (!isPackageRootExport(sources, match.source, exportName))
    violations.push(
      `features/${moduleId}/server: persistence definition export ${exportName} must be exported from the package root`,
    )
}

function isPersistenceDefinitionDeclaration(declaration: ts.Node) {
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false
  const initializer = unwrapExpression(declaration.initializer)
  return (
    ts.isCallExpression(initializer) &&
    identifierText(initializer.expression) === 'definePlatformPersistenceOperation'
  )
}

function isPackageRootExport(
  sources: readonly FeatureBoundarySource[],
  definitionSource: FeatureBoundarySource,
  exportName: string,
) {
  const locallyExported = parseSourceFiles(definitionSource, []).some((sourceFile) =>
    findNamedDeclarations(sourceFile, exportName).some(isExportedDeclaration),
  )
  if (!locallyExported) return false
  if (/\/server\/src\/index\.[cm]?[jt]sx?$/.test(definitionSource.path)) return true

  const entry = sources.find((source) => /\/server\/src\/index\.[cm]?[jt]sx?$/.test(source.path))
  if (!entry) return false
  return parseSourceFiles(entry, []).some((sourceFile) =>
    sourceFile.statements.some(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        exportDeclarationMatchesSource(statement, entry.path, definitionSource.path, exportName),
    ),
  )
}

function isExportedDeclaration(declaration: ts.Node) {
  const statement = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword)
}

function exportDeclarationMatchesSource(
  declaration: ts.ExportDeclaration,
  entryPath: string,
  definitionPath: string,
  exportName: string,
) {
  const specifier = (declaration.moduleSpecifier as ts.StringLiteral).text
  const target = resolve('/', dirname(entryPath), specifier)
  if (sourceModuleIdentity(target) !== sourceModuleIdentity(resolve('/', definitionPath)))
    return false
  if (!declaration.exportClause) return true
  if (!ts.isNamedExports(declaration.exportClause)) return false
  return declaration.exportClause.elements.some(
    (element) => (element.propertyName?.text ?? element.name.text) === exportName,
  )
}

function sourceModuleIdentity(path: string) {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/, '')
}

function validateDescriptorStatement(
  path: string,
  statement: ts.Statement,
  constants: Map<string, ts.Expression>,
  defaultExpression: ts.Expression | undefined,
  violations: string[],
): ts.Expression | undefined {
  if (ts.isImportDeclaration(statement)) {
    const specifier = stringModuleSpecifier(statement.moduleSpecifier)
    if (
      specifier !== '@eve-space/platform-module-contract/manifest' ||
      !isTypeOnlyImport(statement.importClause)
    )
      violations.push(
        `${path}: module descriptor may only type-import @eve-space/platform-module-contract/manifest`,
      )
    return defaultExpression
  }
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
    return defaultExpression
  if (ts.isVariableStatement(statement)) {
    collectDescriptorConstants(path, statement, constants, violations)
    return defaultExpression
  }
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    if (defaultExpression)
      violations.push(`${path}: module descriptor must have one default export`)
    return statement.expression
  }
  if (isEmptyExport(statement)) return defaultExpression
  violations.push(`${path}: module descriptor contains executable top-level code`)
  return defaultExpression
}

function collectDescriptorConstants(
  path: string,
  statement: ts.VariableStatement,
  constants: Map<string, ts.Expression>,
  violations: string[],
) {
  // NodeFlags is a bitmask; logical AND would change this test.
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
    // NOSONAR
    violations.push(`${path}: module descriptor declarations must be const`)
    return
  }
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      violations.push(`${path}: module descriptor declarations must be initialized names`)
      continue
    }
    constants.set(declaration.name.text, declaration.initializer)
  }
}

async function installedModuleBoundaryViolations(
  root: string,
  release: ResolvedInstalledModuleRelease,
) {
  const violations: string[] = []
  const packageViolations = await Promise.all(
    (['server', 'nuxt'] as const).map((environment) =>
      installedPackageBoundaryViolations(root, release, environment),
    ),
  )
  violations.push(...packageViolations.flat())
  return violations
}

async function installedPackageBoundaryViolations(
  root: string,
  release: ResolvedInstalledModuleRelease,
  environment: FeaturePackageEnvironment,
) {
  const moduleId = release.moduleId
  const packageArtifact = release.packages[environment]
  const packageRoot = packageArtifact.root
  const violations: string[] = []
  const packagePath = join(packageRoot, 'package.json')
  const manifest = await readJson(packagePath)
  const relativePackagePath = packageArtifact.workspace
    ? relative(root, packagePath).replaceAll('\\', '/')
    : `${packageArtifact.name}/package.json`
  if (!manifest)
    violations.push(`${relativePackagePath}: feature package manifest is missing or invalid`)
  else
    violations.push(
      ...featurePackageManifestViolations(
        moduleId,
        environment,
        relativePackagePath,
        manifest,
        packageArtifact.name,
        packageArtifact.workspace,
      ),
    )

  const sources = await loadInstalledFeaturePackageSources(root, release, environment)
  if (sources.length === 0)
    violations.push(
      packageArtifact.workspace
        ? `features/${moduleId}/${environment}/src: feature package source is missing`
        : `${packageArtifact.name}: feature package artifacts are missing`,
    )
  const packageSourceBoundaryViolations =
    environment === 'server' ? serverSourceBoundaryViolations : nuxtSourceBoundaryViolations
  violations.push(
    ...installedSourceBoundaryViolations(sources, manifest, packageSourceBoundaryViolations),
  )
  if (environment === 'nuxt')
    await validateNuxtPackageLayout(packageRoot, moduleId, packageArtifact.workspace, violations)

  return violations
}

function installedSourceBoundaryViolations(
  sources: readonly FeatureBoundarySource[],
  manifest: FeaturePackageManifest | undefined,
  sourceBoundaryViolations: (source: FeatureBoundarySource) => readonly string[],
) {
  const dependencyViolations = manifest
    ? sources.flatMap((source) => undeclaredSourceDependencyViolations(source, manifest))
    : []
  const symbolicLinkViolations = sources
    .filter(({ source }) => source === symbolicLinkSource)
    .map(({ path }) => `${path}: symbolic links are not allowed in feature package source`)
  return [
    ...sources.flatMap(sourceBoundaryViolations),
    ...dependencyViolations,
    ...symbolicLinkViolations,
  ]
}

async function validateNuxtPackageLayout(
  packageRoot: string,
  moduleId: string,
  requireSourceLayout: boolean,
  violations: string[],
) {
  const [hasRuntimeApp, hasServerDirectory] = await Promise.all([
    isDirectory(join(packageRoot, 'src', 'runtime', 'app')),
    isDirectory(join(packageRoot, 'server')),
  ])
  if (requireSourceLayout && !hasRuntimeApp)
    violations.push(`features/${moduleId}/nuxt: installed Nuxt module is missing src/runtime/app`)
  if (hasServerDirectory)
    violations.push(
      `features/${moduleId}/nuxt: installed Nuxt module must not define Nitro server handlers`,
    )
}

export async function loadInstalledFeaturePackageSources(
  root: string,
  release: ResolvedInstalledModuleRelease,
  environment: FeaturePackageEnvironment,
): Promise<FeatureBoundarySource[]> {
  const packageArtifact = release.packages[environment]
  if (packageArtifact.workspace)
    return loadSources(root, release.moduleId, join(packageArtifact.root, 'src'), {
      boundaryRoot: `features/${release.moduleId}/${environment}/src`,
      entryPath: packageArtifact.entryPath,
      layout: 'source',
    })
  const packageJson = await readJson(join(packageArtifact.root, 'package.json'))
  const exportPaths = packageJson
    ? exportTargets(packageJson.exports)
        .filter(
          (target) =>
            target.startsWith('./') &&
            !target.includes('*') &&
            !target.replaceAll('\\', '/').split('/').includes('..'),
        )
        .map((target) => resolve(packageArtifact.root, target))
    : []
  const artifactPaths = [
    join(packageArtifact.root, 'dist'),
    packageArtifact.entryPath,
    ...exportPaths,
    ...(environment === 'nuxt' ? Object.values(release.nuxtPages) : []),
  ]
  const options = {
    artifact: packageArtifact,
    boundaryRoot: packageArtifact.name,
    entryPath: packageArtifact.entryPath,
    layout: 'artifact',
  } as const
  const sources = await Promise.all(
    artifactPaths.map((path) => loadSourcePath(root, release.moduleId, path, options)),
  )
  return [...new Map(sources.flat().map((source) => [source.path, source])).values()]
}

interface SourceLoadOptions {
  readonly artifact?: ResolvedModulePackage
  readonly boundaryRoot?: string
  readonly entryPath?: string
  readonly layout?: 'source' | 'artifact'
}

async function loadSourcePath(
  root: string,
  moduleId: string,
  path: string,
  options: SourceLoadOptions,
): Promise<FeatureBoundarySource[]> {
  let stats
  try {
    stats = await lstat(path)
  } catch {
    return []
  }
  if (stats.isDirectory()) return loadSources(root, moduleId, path, options)
  if (!stats.isFile() && !stats.isSymbolicLink()) return []
  if (!stats.isSymbolicLink() && !sourceExtensions.has(extname(path))) return []
  return [
    {
      moduleId,
      path: sourceDisplayPath(root, path, options.artifact),
      source: stats.isSymbolicLink() ? symbolicLinkSource : await readFile(path, 'utf8'),
      boundaryRoot: options.boundaryRoot,
      layout: options.layout,
      entry: options.entryPath === path,
    },
  ]
}

async function loadSources(
  root: string,
  moduleId: string,
  directory: string,
  options: SourceLoadOptions = {},
): Promise<FeatureBoundarySource[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const nested: FeatureBoundarySource[][] = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (options.layout === 'artifact' && entry.name === 'node_modules') return []
      if (entry.isSymbolicLink())
        return [
          {
            moduleId,
            path: sourceDisplayPath(root, path, options.artifact),
            source: symbolicLinkSource,
            boundaryRoot: options.boundaryRoot,
            layout: options.layout,
            entry: options.entryPath === path,
          },
        ]
      if (entry.isDirectory()) return loadSources(root, moduleId, path, options)
      if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return []
      return [
        {
          moduleId,
          path: sourceDisplayPath(root, path, options.artifact),
          source: await readFile(path, 'utf8'),
          boundaryRoot: options.boundaryRoot,
          layout: options.layout,
          entry: options.entryPath === path,
        },
      ]
    }),
  )
  return nested.flat()
}

function sourceDisplayPath(root: string, path: string, artifact?: ResolvedModulePackage) {
  return artifact
    ? `${artifact.name}/${relative(artifact.root, path).replaceAll('\\', '/')}`
    : relative(root, path).replaceAll('\\', '/')
}

function undeclaredSourceDependencyViolations(
  source: FeatureBoundarySource,
  manifest: FeaturePackageManifest,
) {
  const declared = new Set(
    ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) => {
      const dependencies = manifest[field as keyof FeaturePackageManifest]
      return isRecord(dependencies) ? Object.keys(dependencies) : []
    }),
  )
  const imported = new Set<string>()
  const parseViolations: string[] = []
  for (const sourceFile of parseSourceFiles(source, parseViolations))
    visit(sourceFile, (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        registerBarePackage(node.moduleSpecifier.text, imported)
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      )
        registerBarePackage(node.moduleReference.expression.text, imported)
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        registerBarePackage(node.arguments[0].text, imported)
    })
  return [
    ...parseViolations,
    ...[...imported]
      .filter((dependency) => !declared.has(dependency))
      .map(
        (dependency) =>
          `${source.path}: runtime dependency ${dependency} must be declared by its feature package`,
      ),
  ]
}

function registerBarePackage(specifier: string, packages: Set<string>) {
  const normalized = specifier.replaceAll('\\', '/')
  if (normalized.startsWith('.') || normalized.startsWith('/') || normalized.startsWith('#')) return
  packages.add(packageNameFromSpecifier(normalized))
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(exportTargets)
}

function validateServerRuntimeBoundaries(
  path: string,
  sourceFile: ts.SourceFile,
  violations: string[],
) {
  for (const name of forbiddenGlobalReferences(sourceFile, forbiddenServerGlobals))
    violations.push(`${path}: feature server code must not reference ${name}`)
  visit(sourceFile, (node) => {
    if (isEnvironmentReference(node))
      violations.push(`${path}: feature server code must not read process environment`)
    if (ts.isNewExpression(node)) {
      const name = identifierText(node.expression)
      if (name && ['EventSource', 'SharedWorker', 'WebSocket', 'Worker'].includes(name))
        violations.push(`${path}: feature server code must not construct network or worker clients`)
    }
  })
  validateModulePersistenceBoundaries(path, sourceFile, violations)
}

function validateModulePersistenceBoundaries(
  path: string,
  sourceFile: ts.SourceFile,
  violations: string[],
) {
  const persistenceNames = persistenceCapabilityNames(sourceFile)
  let containsSql = false
  let containsGenericDispatch = false
  visit(sourceFile, (node) => {
    if (isRuntimeSqlLiteral(node)) containsSql = true
    if (ts.isCallExpression(node) && isGenericPersistenceCall(node.expression, persistenceNames))
      containsGenericDispatch = true
  })
  if (containsSql)
    violations.push(`${path}: feature server code must not contain runtime SQL statements`)
  if (containsGenericDispatch)
    violations.push(`${path}: feature server code must not use generic persistence dispatch`)
}

function persistenceCapabilityNames(sourceFile: ts.SourceFile) {
  const names = new Set(['persistence'])
  let changed = true
  while (changed) {
    changed = false
    visit(sourceFile, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer)
        return
      const initializer = unwrapExpression(node.initializer)
      const aliasesPersistence =
        (ts.isIdentifier(initializer) && names.has(initializer.text)) ||
        (ts.isPropertyAccessExpression(initializer) && initializer.name.text === 'persistence')
      if (aliasesPersistence && !names.has(node.name.text)) {
        names.add(node.name.text)
        changed = true
      }
    })
  }
  return names
}

function isGenericPersistenceCall(
  expression: ts.LeftHandSideExpression,
  persistenceNames: ReadonlySet<string>,
) {
  const target = unwrapExpression(expression)
  if (ts.isPropertyAccessExpression(target))
    return (
      genericPersistenceMethods.has(target.name.text) &&
      expressionReferencesPersistence(target.expression, persistenceNames)
    )
  if (!ts.isElementAccessExpression(target)) return false
  return expressionReferencesPersistence(target.expression, persistenceNames)
}

function expressionReferencesPersistence(
  expression: ts.Expression,
  persistenceNames: ReadonlySet<string>,
) {
  const target = unwrapExpression(expression)
  if (ts.isIdentifier(target)) return persistenceNames.has(target.text)
  if (ts.isPropertyAccessExpression(target))
    return (
      target.name.text === 'persistence' ||
      expressionReferencesPersistence(target.expression, persistenceNames)
    )
  if (ts.isElementAccessExpression(target))
    return expressionReferencesPersistence(target.expression, persistenceNames)
  return false
}

function isRuntimeSqlLiteral(node: ts.Node) {
  if (ts.isTaggedTemplateExpression(node)) {
    const tag = identifierText(node.tag)
    if (tag === 'sql' || tag === 'query') return true
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return hasSqlStatementPrefix(node.text)
  if (ts.isTemplateExpression(node)) return hasSqlStatementPrefix(node.head.text)
  return false
}

function hasSqlStatementPrefix(value: string) {
  const normalized = value.trimStart().toLowerCase()
  if (normalized.startsWith('select ') && normalized.includes(' from ')) return true
  return sqlStatementPrefixes.some((prefix) => normalized.startsWith(prefix))
}

function validateCoreDataBypasses(path: string, sourceFile: ts.SourceFile, violations: string[]) {
  let referencesSdeSource = false
  visit(sourceFile, (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /\bsde_[a-z0-9_]+\b/i.test(node.text)
    )
      referencesSdeSource = true

    if (ts.isIdentifier(node) && forbiddenSdeIdentifiers.has(normalizeIdentifier(node.text)))
      referencesSdeSource = true
  })
  if (referencesSdeSource)
    violations.push(`${path}: feature server code must not reference unrestricted SDE datasets`)
  if (referencesSdeSource || hasCompetingCoreDataCache(sourceFile))
    violations.push(
      `${path}: feature server code must use declared core-data products instead of alternate adapters or caches`,
    )
}

function hasCompetingCoreDataCache(sourceFile: ts.SourceFile) {
  const stateNames = moduleLevelMutableStateNames(sourceFile)
  if (stateNames.size === 0) return false
  let found = false
  visit(sourceFile, (node) => {
    if (
      !found &&
      ts.isFunctionLike(node) &&
      containsCoreDataProductReference(node) &&
      containsIdentifier(node, stateNames)
    )
      found = true
  })
  return found
}

function moduleLevelMutableStateNames(sourceFile: ts.SourceFile) {
  const stateNames = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          (!isConst ||
            (!!declaration.initializer && isMutableModuleStateInitializer(declaration.initializer)))
        )
          stateNames.add(declaration.name.text)
      continue
    }
    if (
      ts.isClassDeclaration(statement) &&
      statement.name &&
      statement.members.some(
        (member) =>
          ts.isPropertyDeclaration(member) &&
          hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
          (!hasModifier(member, ts.SyntaxKind.ReadonlyKeyword) ||
            (!!member.initializer && isMutableModuleStateInitializer(member.initializer))),
      )
    )
      stateNames.add(statement.name.text)
  }
  return stateNames
}

function isMutableModuleStateInitializer(expression: ts.Expression): boolean {
  if (containsEagerConstruction(expression)) return true
  const value = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(value) && !ts.isArrayLiteralExpression(value)) return false
  return !hasConstAssertion(expression) && !isResourceDefinition(expression, value)
}

function containsEagerConstruction(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return false
  if (ts.isNewExpression(node)) return true
  let found = false
  ts.forEachChild(node, (child) => {
    if (!found && containsEagerConstruction(child)) found = true
  })
  return found
}

function hasConstAssertion(expression: ts.Expression): boolean {
  if (ts.isAsExpression(expression))
    return isConstAssertionType(expression.type) || hasConstAssertion(expression.expression)
  if (ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression))
    return hasConstAssertion(expression.expression)
  return false
}

function isConstAssertionType(type: ts.TypeNode) {
  return (
    ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const'
  )
}

function containsCoreDataProductReference(node: ts.Node) {
  let found = false
  visit(node, (child) => {
    if (found) return
    if (
      (ts.isIdentifier(child) ||
        ts.isStringLiteral(child) ||
        ts.isNoSubstitutionTemplateLiteral(child)) &&
      coreDataProductReferences.has(child.text)
    )
      found = true
  })
  return found
}

function containsIdentifier(node: ts.Node, names: ReadonlySet<string>) {
  let found = false
  visit(node, (child) => {
    if (!found && ts.isIdentifier(child) && names.has(child.text)) found = true
  })
  return found
}

function isResourceDefinition(expression: ts.Expression, value: ts.ObjectLiteralExpression) {
  if (!containsSatisfiesExpression(expression)) return false
  const properties = new Set(value.properties.map((property) => propertyName(property.name)))
  return ['operation', 'request', 'map'].every((property) => properties.has(property))
}

function containsSatisfiesExpression(expression: ts.Expression): boolean {
  if (ts.isSatisfiesExpression(expression)) return true
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression))
    return containsSatisfiesExpression(expression.expression)
  return false
}

function validateNuxtRuntimeBoundaries(
  source: FeatureBoundarySource,
  sourceFile: ts.SourceFile,
  violations: string[],
) {
  const path = source.path
  for (const name of forbiddenGlobalReferences(sourceFile, forbiddenNuxtGlobals))
    violations.push(`${path}: feature Nuxt code must not reference ${name}`)
  validatePlatformApiAccess(source, sourceFile, violations)
  visit(sourceFile, (node) => {
    if (ts.isNewExpression(node)) {
      const name = identifierText(node.expression)
      if (name && ['EventSource', 'SharedWorker', 'WebSocket', 'Worker'].includes(name))
        violations.push(`${path}: feature Nuxt code must use the platform client surface`)
    }
    if (!ts.isCallExpression(node)) return
    const name = calledName(node.expression)
    if (name === 'fetch' || name === '$fetch')
      violations.push(`${path}: feature Nuxt code must use the platform client surface`)
    if (
      name &&
      ['addDevServerHandler', 'addServerHandler', 'addServerImports', 'addServerPlugin'].includes(
        name,
      )
    )
      violations.push(`${path}: Nuxt module setup must not call ${name}`)
  })
}

function validatePlatformApiAccess(
  source: FeatureBoundarySource,
  sourceFile: ts.SourceFile,
  violations: string[],
) {
  const path = source.path
  const clientNames = new Set<string>()
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isNamedCall(node.initializer, 'usePlatformApi')
    ) {
      if (ts.isIdentifier(node.name)) clientNames.add(node.name.text)
      else
        violations.push(`${path}: usePlatformApi must remain an opaque module-scoped client value`)
    }
  })
  visit(sourceFile, (node) => {
    if (ts.isIdentifier(node) && node.text === 'usePlatformApi' && !isDirectCallTarget(node))
      violations.push(`${path}: usePlatformApi must be invoked directly`)
    if (ts.isIdentifier(node) && clientNames.has(node.text) && !isPermittedClientReference(node))
      violations.push(`${path}: platform API clients must not be aliased or exposed`)
    if (
      ts.isCallExpression(node) &&
      isNamedCall(node, 'usePlatformApi') &&
      !isPermittedClientCall(node)
    )
      violations.push(`${path}: usePlatformApi must remain an opaque module-scoped client value`)
    if (!isOutermostAccess(node)) return
    const access = platformApiAccess(node, clientNames)
    if (!access) return
    const moduleRoute =
      access[0] === 'api' && access[1] === 'modules' && access[2] === source.moduleId
    const ownedCharacterReauthorization =
      access[0] === 'auth' && access[1] === 'eve' && access[2] === 'reauthorize'
    if (!moduleRoute && !ownedCharacterReauthorization)
      violations.push(
        `${path}: feature Nuxt API access must remain under api.modules[${JSON.stringify(source.moduleId)}]`,
      )
  })
}

function isPermittedClientReference(node: ts.Identifier) {
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  )
}

function isPermittedClientCall(node: ts.CallExpression) {
  const parent = node.parent
  return (
    (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) ||
    ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node)
  )
}

function isNamedCall(expression: ts.Expression, name: string) {
  expression = unwrapExpression(expression)
  return ts.isCallExpression(expression) && identifierText(expression.expression) === name
}

function isDirectCallTarget(node: ts.Identifier) {
  const parent = node.parent
  return ts.isCallExpression(parent) && unwrapExpression(parent.expression) === node
}

function isOutermostAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false
  const parent = node.parent
  return !(
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  )
}

function platformApiAccess(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  clientNames: ReadonlySet<string>,
) {
  const segments: string[] = []
  let current: ts.Expression = expression
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) segments.unshift(current.name.text)
    else if (current.argumentExpression && ts.isStringLiteralLike(current.argumentExpression))
      segments.unshift(current.argumentExpression.text)
    else return undefined
    current = unwrapExpression(current.expression)
  }
  if (ts.isIdentifier(current) && clientNames.has(current.text)) return segments
  if (isNamedCall(current, 'usePlatformApi')) return segments
  return undefined
}

function validateCompositionTopLevel(
  path: string,
  sourceFile: ts.SourceFile,
  environment: FeaturePackageEnvironment,
  violations: string[],
) {
  for (const statement of sourceFile.statements)
    validateCompositionStatement(path, statement, environment, violations)
}

function validateCompositionStatement(
  path: string,
  statement: ts.Statement,
  environment: FeaturePackageEnvironment,
  violations: string[],
) {
  if (
    ts.isImportDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    isEmptyExport(statement)
  )
    return
  if (ts.isClassDeclaration(statement)) {
    validateClassInitialization(path, statement, violations)
    return
  }
  if (ts.isVariableStatement(statement)) {
    validateCompositionInitializers(path, statement, violations)
    return
  }
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    validateCompositionDefaultExport(path, statement.expression, environment, violations)
    return
  }
  if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) return
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    const name = calledName(statement.expression.expression)
    if (environment === 'nuxt' && name && forbiddenCompositionCalls.has(name)) {
      violations.push(`${path}: Nuxt module setup must not call ${name}`)
      return
    }
  }
  violations.push(`${path}: feature package entry contains executable top-level code`)
}

function validateCompositionInitializers(
  path: string,
  statement: ts.VariableStatement,
  violations: string[],
) {
  for (const declaration of statement.declarationList.declarations)
    if (declaration.initializer && !isPureCompositionExpression(declaration.initializer))
      violations.push(
        `${path}: feature package entry or definition ${declaration.name.getText()} has an executable initializer`,
      )
}

function validateCompositionDefaultExport(
  path: string,
  expression: ts.Expression,
  environment: FeaturePackageEnvironment,
  violations: string[],
) {
  if (!isPureCompositionExpression(expression))
    violations.push(`${path}: feature package default export has an executable initializer`)
  if (environment === 'nuxt') validateNuxtModuleDefinition(path, expression, violations)
}

function validateClassInitialization(
  path: string,
  declaration: ts.ClassDeclaration,
  violations: string[],
) {
  for (const member of declaration.members) {
    if (ts.isClassStaticBlockDeclaration(member))
      violations.push(
        `${path}: feature package class must not contain static initialization blocks`,
      )
    if (
      ts.isPropertyDeclaration(member) &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
      member.initializer &&
      !isPureCompositionExpression(member.initializer)
    )
      violations.push(`${path}: feature package class has an executable static initializer`)
    if (member.name && ts.isComputedPropertyName(member.name))
      violations.push(`${path}: feature package class must not use computed member names`)
  }
}

function validateNuxtModuleDefinition(
  path: string,
  expression: ts.Expression,
  violations: string[],
) {
  const value = unwrapExpression(expression)
  if (!ts.isCallExpression(value) || identifierText(value.expression) !== 'defineNuxtModule') {
    violations.push(`${path}: feature Nuxt entry must directly default-export defineNuxtModule`)
    return
  }
  const definition = value.arguments[0] && unwrapExpression(value.arguments[0])
  if (!definition || !ts.isObjectLiteralExpression(definition)) return
  for (const property of definition.properties) {
    const name = propertyName(property.name)
    if (name === 'hooks' || name === 'onInstall' || name === 'onUpgrade')
      violations.push(`${path}: feature Nuxt modules must not register startup or deployment hooks`)
    if (name === 'setup')
      violations.push(
        `${path}: feature Nuxt modules must not define setup; runtime contributions use generated registries`,
      )
  }
}

function validateFactory(
  path: string,
  factory: ts.FunctionLikeDeclaration,
  kind: 'route' | 'provider',
  violations: string[],
) {
  if (!factory.body) {
    violations.push(`${path}: ${kind} factory must have a local body`)
    return
  }
  if (isFunctionLike(factory.body)) return
  const sourceFile = factory.getSourceFile()
  visitImmediate(factory.body, (node) =>
    validateFactoryNode(path, sourceFile, node, kind, violations),
  )
}

function validateFactoryNode(
  path: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: 'route' | 'provider',
  violations: string[],
) {
  if (isEnvironmentReference(node))
    violations.push(`${path}: ${kind} factory must not read environment-derived configuration`)
  if (ts.isNewExpression(node)) {
    if (kind !== 'route' || !isImportedHonoConstructor(node.expression, sourceFile))
      violations.push(`${path}: ${kind} factory must not construct runtime clients`)
    return
  }
  if (!ts.isCallExpression(node)) return
  const name = calledName(node.expression)
  if (name && forbiddenCompositionCalls.has(name)) {
    violations.push(`${path}: ${kind} factory must not call ${name}`)
    return
  }
  if (
    kind === 'route' &&
    name &&
    routeCompositionMethods.has(name) &&
    isHonoCompositionCall(node, sourceFile)
  )
    return
  if (kind === 'route' && name === 'zValidator') return
  if (isZodCall(node)) return
  violations.push(`${path}: ${kind} factory must not perform work during composition`)
}

function isHonoCompositionCall(call: ts.CallExpression, sourceFile: ts.SourceFile) {
  let expression: ts.Expression = call
  while (true) {
    if (ts.isCallExpression(expression)) {
      expression = unwrapExpression(expression.expression)
      continue
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      expression = unwrapExpression(expression.expression)
      continue
    }
    break
  }
  return (
    ts.isNewExpression(expression) && isImportedHonoConstructor(expression.expression, sourceFile)
  )
}

function isImportedHonoConstructor(expression: ts.Expression, sourceFile: ts.SourceFile) {
  if (identifierText(expression) !== 'Hono') return false
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'hono' &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) =>
          (element.propertyName?.text ?? element.name.text) === 'Hono' &&
          element.name.text === 'Hono',
      ),
  )
}

function isPureCompositionExpression(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression)
  if (
    ts.isStringLiteral(value) ||
    ts.isNumericLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    ts.isIdentifier(value) ||
    ts.isArrowFunction(value) ||
    ts.isFunctionExpression(value) ||
    ts.isRegularExpressionLiteral(value)
  )
    return true
  if (ts.isPrefixUnaryExpression(value)) return isPureCompositionExpression(value.operand)
  if (ts.isPropertyAccessExpression(value)) return !isEnvironmentReference(value)
  if (ts.isArrayLiteralExpression(value))
    return value.elements.every(
      (element) => !ts.isSpreadElement(element) && isPureCompositionExpression(element),
    )
  if (ts.isObjectLiteralExpression(value)) return value.properties.every(isPureCompositionProperty)
  if (ts.isCallExpression(value)) {
    const name = identifierText(value.expression)
    return (
      (!!name && definitionCalls.has(name) && value.arguments.every(isPureCompositionExpression)) ||
      (isZodCall(value) && value.arguments.every(isPureCompositionExpression)) ||
      isDrizzleSchemaCall(value)
    )
  }
  return false
}

function isPureCompositionProperty(property: ts.ObjectLiteralElementLike): boolean {
  if (ts.isMethodDeclaration(property)) return !ts.isComputedPropertyName(property.name)
  if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return false
  return isPureCompositionExpression(property.initializer)
}

function isSerializableDescriptorExpression(
  expression: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
  resolving: Set<string>,
): boolean {
  const value = unwrapExpression(expression)
  if (
    ts.isStringLiteral(value) ||
    ts.isNumericLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  )
    return true
  if (ts.isPrefixUnaryExpression(value))
    return (
      (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken) &&
      ts.isNumericLiteral(value.operand)
    )
  if (ts.isIdentifier(value)) {
    if (resolving.has(value.text)) return false
    const initializer = constants.get(value.text)
    if (!initializer) return false
    resolving.add(value.text)
    const valid = isSerializableDescriptorExpression(initializer, constants, resolving)
    resolving.delete(value.text)
    return valid
  }
  if (ts.isArrayLiteralExpression(value))
    return value.elements.every(
      (element) =>
        !ts.isSpreadElement(element) &&
        isSerializableDescriptorExpression(element, constants, resolving),
    )
  if (ts.isObjectLiteralExpression(value))
    return value.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        isSerializableDescriptorExpression(property.initializer, constants, resolving),
    )
  return false
}

function parseSourceFiles(source: FeatureBoundarySource, violations: string[]) {
  if (!source.path.endsWith('.vue'))
    return [parseTypescript(source.path, source.source, violations)]
  const { descriptor, errors } = parseVue(source.source, { filename: source.path })
  for (const error of errors)
    violations.push(`${source.path}: Vue source must parse without errors: ${error.message}`)
  return [descriptor.script, descriptor.scriptSetup].flatMap((script, index) => {
    if (!script) return []
    if (script.src !== undefined)
      violations.push(`${source.path}: Vue script blocks must be inline for boundary verification`)
    const language = script.lang ?? 'js'
    if (!['js', 'jsx', 'ts', 'tsx'].includes(language)) {
      violations.push(`${source.path}: unsupported Vue script language ${language}`)
      return []
    }
    return [
      parseTypescript(`${source.path}#script-${index}.${language}`, script.content, violations),
    ]
  })
}

function parseTypescript(path: string, source: string, violations: string[]) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  if (
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] })
      .parseDiagnostics.length > 0
  )
    violations.push(`${path}: feature source must parse without TypeScript syntax errors`)
  return sourceFile
}

function findNamedFunctions(sourceFile: ts.SourceFile, name: string): ts.FunctionLikeDeclaration[] {
  const matches: ts.FunctionLikeDeclaration[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      matches.push(statement)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer &&
        (ts.isArrowFunction(unwrapExpression(declaration.initializer)) ||
          ts.isFunctionExpression(unwrapExpression(declaration.initializer)))
      )
        matches.push(unwrapExpression(declaration.initializer) as ts.FunctionLikeDeclaration)
  }
  return matches
}

function findNamedDeclarations(sourceFile: ts.SourceFile, name: string): ts.Node[] {
  const matches: ts.Node[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      matches.push(statement)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        matches.push(declaration)
  }
  return matches
}

function visitImmediate(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => {
    if (child !== node && isFunctionLike(child)) return
    visitImmediate(child, operation)
  })
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  )
}

function isEnvironmentReference(node: ts.Node) {
  if (!ts.isPropertyAccessExpression(node)) return false
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
  )
    return true
  return (
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === 'env'
  )
}

function isDrizzleSchemaCall(call: ts.CallExpression): boolean {
  const expression = call.expression
  if (ts.isIdentifier(expression))
    return (
      ['pgTable', 'text', 'uuid', 'bigint', 'integer', 'jsonb', 'timestamp', 'primaryKey'].includes(
        expression.text,
      ) && call.arguments.every(isPureCompositionExpression)
    )
  return (
    ts.isPropertyAccessExpression(expression) &&
    ['notNull', 'default'].includes(expression.name.text) &&
    ts.isCallExpression(expression.expression) &&
    call.arguments.every(isPureCompositionExpression) &&
    isDrizzleSchemaCall(expression.expression)
  )
}

function isZodCall(call: ts.CallExpression) {
  let expression: ts.Expression = call.expression
  while (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression))
    expression = expression.expression
  return ts.isIdentifier(expression) && expression.text === 'z'
}

function calledName(expression: ts.Expression) {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value)) return value.text
  if (ts.isPropertyAccessExpression(value)) return value.name.text
  return undefined
}

function identifierText(expression: ts.Expression) {
  const value = unwrapExpression(expression)
  return ts.isIdentifier(value) ? value.text : undefined
}

function normalizeIdentifier(value: string) {
  return value.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()
}

function isTypeOnlyImport(importClause: ts.ImportClause | undefined) {
  if (!importClause) return false
  if (importClause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true
  if (importClause.name || !importClause.namedBindings) return false
  if (ts.isNamespaceImport(importClause.namedBindings)) return false
  return (
    importClause.namedBindings.elements.length > 0 &&
    importClause.namedBindings.elements.every((element) => element.isTypeOnly)
  )
}

function stringModuleSpecifier(node: ts.Expression) {
  return ts.isStringLiteral(node) ? node.text : undefined
}

function packageNameFromSpecifier(specifier: string) {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier)
}

function propertyName(name: ts.PropertyName | undefined) {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text
  return undefined
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return (
    ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind)
  )
}

function isEmptyExport(statement: ts.Statement) {
  return (
    ts.isExportDeclaration(statement) &&
    !statement.moduleSpecifier &&
    !!statement.exportClause &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length === 0
  )
}

function scriptKind(path: string) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs'))
    return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lowercaseFirst(value: string) {
  const normalized = value.endsWith('.') ? value.slice(0, -1) : value
  return normalized.length === 0
    ? normalized
    : `${normalized[0]!.toLowerCase()}${normalized.slice(1)}`
}
