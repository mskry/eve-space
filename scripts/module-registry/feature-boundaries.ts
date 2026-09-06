import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import type { PlatformModuleManifest } from '../../packages/platform-module-contract/src/index.js'

export type FeaturePackageEnvironment = 'server' | 'nuxt'

export interface FeatureBoundarySource {
  readonly moduleId: string
  readonly path: string
  readonly source: string
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

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx', '.vue'])
const serverRuntimePackages = new Set([
  '@eve-space/platform-module-contract',
  '@eve-space/platform-module-server',
  'hono',
  'zod',
])
const nuxtRuntimePackages = new Set([
  '@eve-space/platform-module-contract',
  '@eve-space/platform-module-nuxt',
  '@nuxt/kit',
  '@nuxt/schema',
  '@pinia/colada',
  'vue',
])
const sharedDevelopmentPackages = new Set([
  '@types/node',
  '@vitest/coverage-v8',
  'tsx',
  'typescript',
  'vitest',
])
const serverDevelopmentPackages = new Set(sharedDevelopmentPackages)
const nuxtDevelopmentPackages = new Set([
  ...sharedDevelopmentPackages,
  '@nuxt/test-utils',
  '@typescript/native',
  '@vue/test-utils',
  'happy-dom',
  'nuxt',
  'vue-tsc',
])
const nuxtRuntimeImports = new Set([
  'computed',
  'createError',
  'definePageMeta',
  'navigateTo',
  'nextTick',
  'onBeforeUnmount',
  'onMounted',
  'reactive',
  'readonly',
  'ref',
  'shallowRef',
  'toRef',
  'toRefs',
  'useAnnouncer',
  'useHead',
  'useNuxtApp',
  'useRoute',
  'useRouter',
  'useSeoMeta',
  'watch',
  'watchEffect',
])
const definitionCalls = new Set([
  'defineNuxtModule',
  'definePlatformExecutableEsiOperation',
  'definePlatformResourceOperation',
])
const nuxtSetupCalls = new Set([
  'addComponent',
  'addComponentsDir',
  'addImports',
  'addImportsDir',
  'addPlugin',
  'addRouteMiddleware',
  'addTemplate',
  'addTypeTemplate',
  'createResolver',
  'extendPages',
  'resolve',
  'resolvePath',
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
async function installedFeatureBoundaryViolations(root: string) {
  const moduleIds = await loadInstalledModuleIds(root)
  const violations = await Promise.all(
    moduleIds.map((moduleId) => installedModuleBoundaryViolations(root, moduleId)),
  )
  return violations.flat().toSorted((left, right) => left.localeCompare(right))
}

export async function assertInstalledFeatureBoundaries(root: string) {
  const violations = await installedFeatureBoundaryViolations(root)
  if (violations.length > 0)
    throw new Error(`Feature module boundary verification failed:\n${violations.join('\n')}`)
}

async function manifestCompositionBoundaryViolations(
  root: string,
  manifest: PlatformModuleManifest,
) {
  const sources = await loadSources(
    root,
    manifest.id,
    join(root, 'features', manifest.id, 'server', 'src'),
  )
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
        findNamedDeclarations(sourceFile, contribution.exportName),
      ),
    )
    if (matches.length !== 1)
      violations.push(
        `features/${manifest.id}/server: definition export ${contribution.exportName} must resolve to one local declaration`,
      )
  }
  return violations.toSorted((left, right) => left.localeCompare(right))
}

export async function assertManifestCompositionBoundaries(
  root: string,
  manifest: PlatformModuleManifest,
) {
  const violations = await manifestCompositionBoundaryViolations(root, manifest)
  if (violations.length > 0)
    throw new Error(`Feature module composition verification failed:\n${violations.join('\n')}`)
}

export function featurePackageManifestViolations(
  moduleId: string,
  environment: FeaturePackageEnvironment,
  path: string,
  manifest: FeaturePackageManifest,
) {
  const violations: string[] = []
  const expectedName = `@eve-space/${moduleId}-${environment}`
  if (manifest.name !== expectedName)
    violations.push(`${path}: feature package must be named ${expectedName}`)
  if (manifest.type !== 'module') violations.push(`${path}: feature package must use ESM`)
  if (
    environment === 'server'
      ? manifest.sideEffects !== false
      : !isNuxtSideEffectsDeclaration(manifest.sideEffects)
  )
    violations.push(
      `${path}: feature package must declare ${environment === 'server' ? 'sideEffects false' : 'only Vue files as side-effectful'}`,
    )

  const runtimePackages = environment === 'server' ? serverRuntimePackages : nuxtRuntimePackages
  const developmentPackages =
    environment === 'server' ? serverDevelopmentPackages : nuxtDevelopmentPackages
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const)
    validateDependencyField(manifest[field], field, runtimePackages, path, violations)
  validateDependencyField(
    manifest.devDependencies,
    'devDependencies',
    developmentPackages,
    path,
    violations,
  )
  validatePackageExports(manifest.exports, environment, path, violations)
  return violations
}

function isNuxtSideEffectsDeclaration(sideEffects: unknown) {
  return Array.isArray(sideEffects) && sideEffects.length === 1 && sideEffects[0] === '**/*.vue'
}

export function descriptorBoundaryViolations(source: FeatureBoundarySource) {
  const violations: string[] = []
  const sourceFile = parseTypescript(source.path, source.source, violations)
  let defaultExpression: ts.Expression | undefined
  const constants = new Map<string, ts.Expression>()

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = stringModuleSpecifier(statement.moduleSpecifier)
      if (
        specifier !== '@eve-space/platform-module-contract' ||
        !isTypeOnlyImport(statement.importClause)
      )
        violations.push(
          `${source.path}: module descriptor may only type-import @eve-space/platform-module-contract`,
        )
      continue
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue
    if (ts.isVariableStatement(statement)) {
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
        violations.push(`${source.path}: module descriptor declarations must be const`)
        continue
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          violations.push(
            `${source.path}: module descriptor declarations must be initialized names`,
          )
          continue
        }
        constants.set(declaration.name.text, declaration.initializer)
      }
      continue
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (defaultExpression)
        violations.push(`${source.path}: module descriptor must have one default export`)
      defaultExpression = statement.expression
      continue
    }
    if (isEmptyExport(statement)) continue
    violations.push(`${source.path}: module descriptor contains executable top-level code`)
  }

  if (!defaultExpression)
    violations.push(`${source.path}: module descriptor must default-export a static object`)
  else if (!isSerializableDescriptorExpression(defaultExpression, constants, new Set()))
    violations.push(`${source.path}: module descriptor must be a static serializable object`)
  return violations
}

export function serverSourceBoundaryViolations(source: FeatureBoundarySource) {
  const violations: string[] = []
  const packageRoot = `features/${source.moduleId}/server`
  const sourceFiles = parseSourceFiles(source, violations)
  for (const sourceFile of sourceFiles) {
    validateImports(source, sourceFile, packageRoot, 'server', violations)
    validateServerRuntimeBoundaries(source.path, sourceFile, violations)
    validateCompositionTopLevel(source.path, sourceFile, 'server', violations)
  }
  return violations
}

export function nuxtSourceBoundaryViolations(source: FeatureBoundarySource) {
  const violations: string[] = []
  const packageRoot = `features/${source.moduleId}/nuxt`
  const runtimePath = `/nuxt/src/runtime/app/`
  const isModuleSetup = /\/nuxt\/src\/module\.(?:[cm]?[jt]s)$/.test(source.path)
  if (!source.path.includes(runtimePath) && !isModuleSetup)
    violations.push(`${source.path}: Nuxt source must live under src/runtime/app`)

  const sourceFiles = parseSourceFiles(source, violations)
  for (const sourceFile of sourceFiles) {
    validateImports(source, sourceFile, packageRoot, 'nuxt', violations)
    validateNuxtRuntimeBoundaries(source.path, sourceFile, violations)
    if (isModuleSetup) validateCompositionTopLevel(source.path, sourceFile, 'nuxt', violations)
  }
  return violations
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
  validateFactory(match.source.path, match.functionNode, kind, violations)
  return violations
}

async function installedModuleBoundaryViolations(root: string, moduleId: string) {
  const featureRoot = join(root, 'features', moduleId)
  const descriptorPath = join(featureRoot, 'module.config.ts')
  const violations: string[] = []
  const descriptor = await readSource(root, moduleId, descriptorPath)
  if (!descriptor) violations.push(`features/${moduleId}/module.config.ts: descriptor is missing`)
  else violations.push(...descriptorBoundaryViolations(descriptor))

  const packageViolations = await Promise.all(
    (['server', 'nuxt'] as const).map(async (environment) => {
      const environmentViolations: string[] = []
      const packageRoot = join(featureRoot, environment)
      const packagePath = join(packageRoot, 'package.json')
      const manifest = await readJson(packagePath)
      const relativePackagePath = relative(root, packagePath).replaceAll('\\', '/')
      if (!manifest)
        environmentViolations.push(
          `${relativePackagePath}: feature package manifest is missing or invalid`,
        )
      else
        environmentViolations.push(
          ...featurePackageManifestViolations(moduleId, environment, relativePackagePath, manifest),
        )

      const sources = await loadSources(root, moduleId, join(packageRoot, 'src'))
      if (sources.length === 0)
        environmentViolations.push(
          `features/${moduleId}/${environment}/src: feature package source is missing`,
        )
      for (const source of sources)
        environmentViolations.push(
          ...(environment === 'server'
            ? serverSourceBoundaryViolations(source)
            : nuxtSourceBoundaryViolations(source)),
        )
      if (manifest)
        for (const source of sources)
          environmentViolations.push(...undeclaredSourceDependencyViolations(source, manifest))
      for (const source of sources)
        if (source.source === '/* symbolic links are not valid feature package source */')
          environmentViolations.push(
            `${source.path}: symbolic links are not allowed in feature package source`,
          )
      if (environment === 'nuxt') {
        const [hasRuntimeApp, hasServerDirectory] = await Promise.all([
          isDirectory(join(packageRoot, 'src', 'runtime', 'app')),
          isDirectory(join(packageRoot, 'server')),
        ])
        if (!hasRuntimeApp)
          environmentViolations.push(
            `features/${moduleId}/nuxt: installed Nuxt module is missing src/runtime/app`,
          )
        if (hasServerDirectory)
          environmentViolations.push(
            `features/${moduleId}/nuxt: installed Nuxt module must not define Nitro server handlers`,
          )
      }
      return environmentViolations
    }),
  )
  violations.push(...packageViolations.flat())
  return violations
}

async function loadInstalledModuleIds(root: string) {
  const installed = await readJson(join(root, 'features', 'installed-modules.json'))
  if (
    !installed ||
    !Array.isArray(installed.modules) ||
    !installed.modules.every((moduleId) => typeof moduleId === 'string')
  )
    throw new Error('features/installed-modules.json must contain a string modules array')
  return installed.modules
}

async function loadSources(
  root: string,
  moduleId: string,
  directory: string,
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
      if (entry.isSymbolicLink())
        return [
          {
            moduleId,
            path: relative(root, path).replaceAll('\\', '/'),
            source: '/* symbolic links are not valid feature package source */',
          },
        ]
      if (entry.isDirectory()) return loadSources(root, moduleId, path)
      if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return []
      return [
        {
          moduleId,
          path: relative(root, path).replaceAll('\\', '/'),
          source: await readFile(path, 'utf8'),
        },
      ]
    }),
  )
  return nested.flat()
}

function validateDependencyField(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
  path: string,
  violations: string[],
) {
  if (value === undefined) return
  if (!isRecord(value)) {
    violations.push(`${path}: ${field} must be an object`)
    return
  }
  for (const [dependency, version] of Object.entries(value)) {
    if (!allowed.has(dependency))
      violations.push(
        `${path}: ${field} dependency ${dependency} is not allowed for this feature package`,
      )
    const expectedVersion = dependency.startsWith('@eve-space/') ? 'workspace:*' : 'catalog:'
    if (version !== expectedVersion)
      violations.push(`${path}: ${field} dependency ${dependency} must use ${expectedVersion}`)
  }
}

function validatePackageExports(
  value: unknown,
  environment: FeaturePackageEnvironment,
  path: string,
  violations: string[],
) {
  if (!isRecord(value) || !('.' in value)) {
    violations.push(`${path}: feature package must export its root entry`)
    return
  }
  for (const target of exportTargets(value)) {
    const normalized = target.replaceAll('\\', '/')
    if (!normalized.startsWith('./') || normalized.split('/').includes('..'))
      violations.push(`${path}: package export ${target} escapes the feature package root`)
    else if (!normalized.startsWith('./dist/') && !normalized.startsWith('./migrations/'))
      violations.push(`${path}: package export ${target} must resolve from dist or migrations`)
  }
  if (environment === 'server' && !('./migrations/*' in value))
    violations.push(`${path}: server feature package must export ./migrations/*`)
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

function validateImports(
  source: FeatureBoundarySource,
  sourceFile: ts.SourceFile,
  packageRoot: string,
  environment: FeaturePackageEnvironment,
  violations: string[],
) {
  visit(sourceFile, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      validateSpecifier(
        source,
        node.moduleSpecifier.text,
        packageRoot,
        environment,
        ts.isImportDeclaration(node) ? node.importClause : undefined,
        violations,
      )
      if (ts.isImportDeclaration(node) && !node.importClause)
        violations.push(`${source.path}: side-effect imports are not allowed in feature packages`)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0]
      if (!argument || !ts.isStringLiteral(argument)) {
        violations.push(`${source.path}: feature package dynamic imports must use string literals`)
        return
      }
      validateSpecifier(source, argument.text, packageRoot, environment, undefined, violations)
    }
  })
}

function validateSpecifier(
  source: FeatureBoundarySource,
  specifier: string,
  packageRoot: string,
  environment: FeaturePackageEnvironment,
  importClause: ts.ImportClause | undefined,
  violations: string[],
) {
  const normalized = specifier.replaceAll('\\', '/')
  if (
    environment === 'server' &&
    (normalized === '@eve-space/api' ||
      normalized.startsWith('@eve-space/api/') ||
      /(?:^|\/)api\/src(?:\/|$)/.test(normalized))
  ) {
    violations.push(
      `${source.path}: feature server code cannot import core API source ${specifier}`,
    )
    return
  }
  if (normalized.startsWith('.')) {
    const target = resolve('/', dirname(source.path), normalized)
    const root = resolve('/', packageRoot)
    const relativeTarget = relative(root, target)
    if (relativeTarget === '..' || relativeTarget.startsWith('../') || isAbsolute(relativeTarget))
      violations.push(
        `${source.path}: relative import ${specifier} escapes the feature package root`,
      )
    return
  }
  if (normalized.startsWith('/') || normalized.startsWith('file:')) {
    violations.push(
      `${source.path}: absolute import ${specifier} is not allowed in feature packages`,
    )
    return
  }
  if (normalized === '#imports') {
    if (environment !== 'nuxt') {
      violations.push(`${source.path}: import ${specifier} is not allowed for server feature code`)
      return
    }
    const names = importedNames(importClause)
    const rejected = names.filter((name) => !nuxtRuntimeImports.has(name))
    if (rejected.length > 0 || names.length === 0)
      violations.push(
        `${source.path}: #imports may only expose approved Nuxt runtime imports; rejected ${rejected.join(', ') || 'namespace/default import'}`,
      )
    return
  }
  if (normalized.startsWith('#')) {
    violations.push(
      `${source.path}: feature package import ${specifier} bypasses its public platform surface`,
    )
    return
  }
  const packageName = packageNameFromSpecifier(normalized)
  const allowed = environment === 'server' ? serverRuntimePackages : nuxtRuntimePackages
  if (!allowed.has(packageName))
    violations.push(
      `${source.path}: import ${specifier} is not allowed for ${environment} feature code`,
    )
}

function validateServerRuntimeBoundaries(
  path: string,
  sourceFile: ts.SourceFile,
  violations: string[],
) {
  visit(sourceFile, (node) => {
    if (isEnvironmentReference(node))
      violations.push(`${path}: feature server code must not read process environment`)
    if (ts.isNewExpression(node)) {
      const name = identifierText(node.expression)
      if (name && ['EventSource', 'SharedWorker', 'WebSocket', 'Worker'].includes(name))
        violations.push(`${path}: feature server code must not construct network or worker clients`)
    }
    if (!ts.isCallExpression(node)) return
    const name = calledName(node.expression)
    if (
      name &&
      ['fetch', 'queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout'].includes(name)
    )
      violations.push(`${path}: feature server code must not call ${name}`)
  })
}

function validateNuxtRuntimeBoundaries(
  path: string,
  sourceFile: ts.SourceFile,
  violations: string[],
) {
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

function validateCompositionTopLevel(
  path: string,
  sourceFile: ts.SourceFile,
  environment: FeaturePackageEnvironment,
  violations: string[],
) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      isEmptyExport(statement)
    )
      continue
    if (ts.isClassDeclaration(statement)) {
      validateClassInitialization(path, statement, violations)
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (declaration.initializer && !isPureCompositionExpression(declaration.initializer))
          violations.push(
            `${path}: feature package entry or definition has an executable initializer`,
          )
      continue
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (!isPureCompositionExpression(statement.expression))
        violations.push(`${path}: feature package default export has an executable initializer`)
      if (environment === 'nuxt')
        validateNuxtModuleDefinition(path, statement.expression, violations)
      continue
    }
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) continue
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const name = calledName(statement.expression.expression)
      if (environment === 'nuxt' && name && forbiddenCompositionCalls.has(name)) {
        violations.push(`${path}: Nuxt module setup must not call ${name}`)
        continue
      }
    }
    violations.push(`${path}: feature package entry contains executable top-level code`)
  }
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
    if (name !== 'setup') continue
    const setup = functionLikeFromProperty(property)
    if (!setup) {
      violations.push(`${path}: feature Nuxt setup must be an inline function`)
      continue
    }
    validateNuxtSetup(path, setup, violations)
  }
}

function validateNuxtSetup(path: string, setup: ts.FunctionLikeDeclaration, violations: string[]) {
  if (!setup.body) return
  visitImmediate(setup.body, (node) => {
    if (isEnvironmentReference(node))
      violations.push(`${path}: feature Nuxt setup must not read environment-derived configuration`)
    if (ts.isNewExpression(node))
      violations.push(`${path}: feature Nuxt setup must not construct runtime clients`)
    if (!ts.isCallExpression(node)) return
    const name = calledName(node.expression)
    if (name && forbiddenCompositionCalls.has(name))
      violations.push(`${path}: feature Nuxt setup must not call ${name}`)
    else if (!name || !nuxtSetupCalls.has(name))
      violations.push(
        `${path}: feature Nuxt setup may only perform deterministic Nuxt Kit registration`,
      )
  })
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
  visitImmediate(factory.body, (node) => {
    if (isEnvironmentReference(node))
      violations.push(`${path}: ${kind} factory must not read environment-derived configuration`)
    if (ts.isNewExpression(node)) {
      const name = identifierText(node.expression)
      if (kind !== 'route' || name !== 'Hono')
        violations.push(`${path}: ${kind} factory must not construct runtime clients`)
      return
    }
    if (!ts.isCallExpression(node)) return
    const name = calledName(node.expression)
    if (name && forbiddenCompositionCalls.has(name)) {
      violations.push(`${path}: ${kind} factory must not call ${name}`)
      return
    }
    if (kind === 'route' && name && routeCompositionMethods.has(name)) return
    if (kind === 'route' && name === 'zValidator') return
    if (isZodCall(node)) return
    violations.push(`${path}: ${kind} factory must not perform work during composition`)
  })
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
  if (ts.isObjectLiteralExpression(value))
    return value.properties.every((property) => {
      if (ts.isMethodDeclaration(property)) return !ts.isComputedPropertyName(property.name)
      if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))
        return false
      return isPureCompositionExpression(property.initializer)
    })
  if (ts.isCallExpression(value)) {
    const name = identifierText(value.expression)
    return (
      (!!name && definitionCalls.has(name) && value.arguments.every(isPureCompositionExpression)) ||
      (isZodCall(value) && value.arguments.every(isPureCompositionExpression))
    )
  }
  return false
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
  const scripts: ts.SourceFile[] = []
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  let match: RegExpExecArray | null
  let remaining = source.source
  let index = 0
  while ((match = scriptPattern.exec(source.source))) {
    scripts.push(parseTypescript(`${source.path}#script-${index}`, match[1] ?? '', violations))
    remaining = remaining.replace(match[0], '')
    index += 1
  }
  if (/<script\b/i.test(remaining))
    violations.push(`${source.path}: Vue script blocks must be statically parseable`)
  return scripts
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

function isZodCall(call: ts.CallExpression) {
  let expression: ts.Expression = call.expression
  while (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression))
    expression = ts.isPropertyAccessExpression(expression)
      ? expression.expression
      : expression.expression
  return ts.isIdentifier(expression) && expression.text === 'z'
}

function functionLikeFromProperty(property: ts.ObjectLiteralElementLike) {
  if (ts.isMethodDeclaration(property)) return property
  if (!ts.isPropertyAssignment(property)) return undefined
  const initializer = unwrapExpression(property.initializer)
  return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
    ? initializer
    : undefined
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

function importedNames(importClause: ts.ImportClause | undefined) {
  if (!importClause || importClause.name || !importClause.namedBindings) return []
  if (ts.isNamespaceImport(importClause.namedBindings)) return []
  return importClause.namedBindings.elements.map(
    (element) => element.propertyName?.text ?? element.name.text,
  )
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

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let value = expression
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression
  return value
}

function scriptKind(path: string) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}

async function readSource(root: string, moduleId: string, path: string) {
  try {
    const resolved = await realpath(path)
    const featureRoot = await realpath(join(root, 'features', moduleId))
    const relativePath = relative(featureRoot, resolved)
    if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath))
      return null
    return {
      moduleId,
      path: relative(root, path).replaceAll('\\', '/'),
      source: await readFile(resolved, 'utf8'),
    }
  } catch {
    return null
  }
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
