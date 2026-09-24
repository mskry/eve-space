import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { parse as parseVue } from '@vue/compiler-sfc'

const serverRuntimePackages = new Set([
  '@eve-space/core-eve-projections',
  '@eve-space/platform-module-contract',
  '@eve-space/platform-module-server',
  'drizzle-orm',
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
const exactServerRuntimeImports = new Set([
  '@eve-space/core-eve-projections/assets',
  '@eve-space/core-eve-projections/mail',
  '@eve-space/core-eve-projections/skill-queue',
  '@eve-space/core-eve-projections/trained-skills',
  '@eve-space/core-eve-projections/wallet',
  '@eve-space/platform-module-contract/activity',
  '@eve-space/platform-module-contract/esi',
  '@eve-space/platform-module-contract/identifiers',
  '@eve-space/platform-module-contract/persistence',
  '@eve-space/platform-module-contract/resources',
  '@eve-space/platform-module-contract/server',
  '@eve-space/platform-module-server',
  'drizzle-orm/pg-core',
  'hono',
  'zod',
])
const exactNuxtRuntimeImports = new Set([
  '@eve-space/platform-module-contract/nuxt',
  '@eve-space/platform-module-nuxt',
  '@eve-space/platform-module-nuxt/runtime',
  '@eve-space/platform-module-nuxt/runtime/reviewer-panel',
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
const serverDevelopmentPackages = new Set([
  ...sharedDevelopmentPackages,
  'postgres',
  'testcontainers',
])
const nuxtDevelopmentPackages = new Set([
  ...sharedDevelopmentPackages,
  '@nuxt/test-utils',
  '@typescript/native',
  '@vue/test-utils',
  'happy-dom',
  'nuxt',
  'vue-tsc',
])
const forbiddenServerGlobals = new Set([
  'EventSource',
  'Function',
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
  'EventSource',
  'Function',
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
const globalObjectNames = new Set(['globalThis', 'global', 'self', 'window'])
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
const allowedNuxtImports = new Set([
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

export type PlatformModuleEnvironment = 'server' | 'nuxt'
export type PlatformModulePolicyScope = 'source' | 'artifact'

export interface PlatformModulePolicyIssue {
  readonly code: string
  readonly scope: PlatformModulePolicyScope
  readonly path: string
  readonly message: string
}

export interface PlatformModuleSource {
  readonly moduleId: string
  readonly path: string
  readonly source: string
  readonly boundaryRoot: string
  readonly environment: PlatformModuleEnvironment
  readonly scope: PlatformModulePolicyScope
}

export interface PlatformModulePackageManifest extends Record<string, unknown> {
  readonly name?: unknown
  readonly type?: unknown
  readonly sideEffects?: unknown
  readonly dependencies?: unknown
  readonly devDependencies?: unknown
  readonly optionalDependencies?: unknown
  readonly peerDependencies?: unknown
  readonly exports?: unknown
  readonly files?: unknown
  readonly version?: unknown
}

export function platformModulePackageManifestIssues(input: {
  readonly moduleId: string
  readonly environment: PlatformModuleEnvironment
  readonly path: string
  readonly manifest: PlatformModulePackageManifest
  readonly expectedPackageName: string
  readonly scope: PlatformModulePolicyScope
  readonly requireWorkspaceSpecifiers?: boolean
  readonly allowLocalDependencySpecifiers?: boolean
}): readonly PlatformModulePolicyIssue[] {
  const issues: PlatformModulePolicyIssue[] = []
  const { manifest, environment, path, scope } = input
  if (manifest.name !== input.expectedPackageName) {
    issues.push(
      issue(
        'PACKAGE_NAME_MISMATCH',
        scope,
        path,
        `Package must be named ${input.expectedPackageName}.`,
      ),
    )
  }
  if (manifest.type !== 'module') {
    issues.push(issue('PACKAGE_ESM_REQUIRED', scope, path, 'Package must use ESM.'))
  }
  if (
    environment === 'server'
      ? manifest.sideEffects !== false
      : !isNuxtSideEffects(manifest.sideEffects)
  ) {
    issues.push(
      issue(
        'PACKAGE_SIDE_EFFECTS_INVALID',
        scope,
        path,
        environment === 'server'
          ? 'Server package must declare sideEffects false.'
          : 'Nuxt package must declare only Vue files as side-effectful.',
      ),
    )
  }

  const runtime = environment === 'server' ? serverRuntimePackages : nuxtRuntimePackages
  const development = environment === 'server' ? serverDevelopmentPackages : nuxtDevelopmentPackages
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    validateDependencies(manifest[field], field, runtime, input, issues)
  }
  validateDependencies(manifest.devDependencies, 'devDependencies', development, input, issues)
  validateExports(manifest.exports, environment, scope, path, issues)
  return sortedIssues(issues)
}

export function platformModuleSourceIssues(
  input: PlatformModuleSource,
  declaredRuntimeDependencies: ReadonlySet<string>,
): readonly PlatformModulePolicyIssue[] {
  const issues: PlatformModulePolicyIssue[] = []
  if (input.path.endsWith('.cjs') || input.path.endsWith('.cts')) {
    issues.push(
      issue(
        'SOURCE_ESM_REQUIRED',
        input.scope,
        input.path,
        'Feature packages must use ESM source files.',
      ),
    )
  }
  for (const sourceFile of parseSourceFiles(input, issues)) {
    const imported = new Set<string>()
    const checker = sourceFileChecker(sourceFile)
    const persistenceNames = persistenceCapabilityNames(sourceFile)
    visit(sourceFile, (node) => {
      validateImportNode(input, node, imported, issues)
      if (
        ts.isIdentifier(node) &&
        isUnboundIdentifier(node, checker) &&
        forbiddenGlobals(input.environment).has(node.text)
      ) {
        issues.push(
          issue(
            'GLOBAL_REFERENCE_FORBIDDEN',
            input.scope,
            input.path,
            `Reference to ${node.text} is not allowed.`,
          ),
        )
      }
      if (isForbiddenGlobalProperty(node, input.environment)) {
        issues.push(
          issue(
            'GLOBAL_REFERENCE_FORBIDDEN',
            input.scope,
            input.path,
            `Reference to ${node.name.text} is not allowed.`,
          ),
        )
      }
      if (input.environment === 'server' && isRuntimeSqlLiteral(node)) {
        issues.push(
          issue(
            'RUNTIME_SQL_FORBIDDEN',
            input.scope,
            input.path,
            'Server code must not contain runtime SQL statements.',
          ),
        )
      }
      if (
        input.environment === 'server' &&
        ts.isCallExpression(node) &&
        isGenericPersistenceCall(node.expression, persistenceNames)
      ) {
        issues.push(
          issue(
            'GENERIC_PERSISTENCE_FORBIDDEN',
            input.scope,
            input.path,
            'Server code must not use generic persistence dispatch.',
          ),
        )
      }
    })
    for (const dependency of imported) {
      if (!declaredRuntimeDependencies.has(dependency))
        issues.push(
          issue(
            'RUNTIME_DEPENDENCY_UNDECLARED',
            input.scope,
            input.path,
            `Runtime dependency ${safePackageName(dependency)} must be declared by its package.`,
          ),
        )
    }
  }
  return sortedIssues(issues)
}

export function platformModuleRelativeImportIssues(
  input: PlatformModuleSource,
  packageFiles: ReadonlySet<string>,
): readonly PlatformModulePolicyIssue[] {
  const issues: PlatformModulePolicyIssue[] = []
  const sourcePath = packageRelativePath(input)
  for (const sourceFile of parseSourceFiles(input, issues)) {
    visit(sourceFile, (node) => {
      const specifier = importSpecifier(node)
      if (!specifier?.startsWith('.')) return
      const target = normalizeRelativePath(join(dirname(sourcePath), specifier))
      if (
        !relativeImportCandidates(target, input.path, input.scope).some((candidate) =>
          packageFiles.has(candidate),
        )
      )
        issues.push(
          issue(
            'IMPORT_TARGET_MISSING',
            input.scope,
            input.path,
            'Relative import target is missing from the inspected package graph.',
          ),
        )
    })
  }
  return sortedIssues(issues)
}

export function runtimeDependencyNames(manifest: PlatformModulePackageManifest) {
  return new Set(
    ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) => {
      const value = manifest[field]
      return isRecord(value) ? Object.keys(value) : []
    }),
  )
}

function validateDependencies(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
  input: Parameters<typeof platformModulePackageManifestIssues>[0],
  issues: PlatformModulePolicyIssue[],
) {
  if (value === undefined) {
    return
  }
  if (!isRecord(value)) {
    issues.push(
      issue(
        'DEPENDENCY_DECLARATION_INVALID',
        input.scope,
        input.path,
        `${field} must be an object.`,
      ),
    )
    return
  }
  for (const [dependency, version] of Object.entries(value).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const displayDependency = safePackageName(dependency)
    if (!allowed.has(dependency)) {
      issues.push(
        issue(
          'DEPENDENCY_NOT_ALLOWED',
          input.scope,
          input.path,
          `${field} dependency ${displayDependency} is not allowed.`,
        ),
      )
    }
    if (typeof version !== 'string' || version.trim().length === 0) {
      issues.push(
        issue(
          'DEPENDENCY_VERSION_INVALID',
          input.scope,
          input.path,
          `${field} dependency ${displayDependency} must declare a version.`,
        ),
      )
      continue
    }
    if (
      input.scope === 'artifact' &&
      input.allowLocalDependencySpecifiers !== true &&
      isLocalDependencySpecifier(version)
    ) {
      issues.push(
        issue(
          'DEPENDENCY_VERSION_LOCAL',
          input.scope,
          input.path,
          `${field} dependency ${displayDependency} must use a publishable version specifier.`,
        ),
      )
      continue
    }
    if (input.requireWorkspaceSpecifiers !== true) {
      continue
    }
    const expected = dependency.startsWith('@eve-space/') ? 'workspace:*' : 'catalog:'
    const named =
      (dependency === 'typescript' && ['catalog:tsapi', 'catalog:tsgo'].includes(version)) ||
      ((dependency === 'vitest' || dependency === '@vitest/coverage-v8') &&
        version === 'catalog:vitest4')
    if (version !== expected && !named) {
      issues.push(
        issue(
          'DEPENDENCY_VERSION_INVALID',
          input.scope,
          input.path,
          `${field} dependency ${displayDependency} must use ${expected}.`,
        ),
      )
    }
  }
}

function isLocalDependencySpecifier(value: string) {
  return ['workspace:', 'catalog:', 'link:', 'file:'].some((prefix) => value.startsWith(prefix))
}

function validateExports(
  value: unknown,
  environment: PlatformModuleEnvironment,
  scope: PlatformModulePolicyScope,
  path: string,
  issues: PlatformModulePolicyIssue[],
) {
  if (!isRecord(value) || !('.' in value)) {
    issues.push(
      issue('PACKAGE_ROOT_EXPORT_MISSING', scope, path, 'Package must export its root entry.'),
    )
    return
  }
  const expected =
    environment === 'server'
      ? { import: './dist/index.js', types: './dist/index.d.ts' }
      : { import: './dist/module.js', types: './dist/module.d.ts' }
  const root = value['.']
  if (
    !isRecord(root) ||
    root.types !== expected.types ||
    root.import !== expected.import ||
    Object.keys(root).some((key) => key !== 'types' && key !== 'import')
  ) {
    issues.push(
      issue(
        'PACKAGE_ROOT_EXPORT_INVALID',
        scope,
        path,
        `Feature package root export must use ${expected.types} and ${expected.import}.`,
      ),
    )
  }
  for (const target of exportTargets(value)) {
    const normalized = target.replaceAll('\\', '/')
    if (!normalized.startsWith('./') || normalized.split('/').includes('..')) {
      issues.push(
        issue(
          'PACKAGE_EXPORT_ESCAPE',
          scope,
          path,
          'Package export escapes the feature package root.',
        ),
      )
    } else if (!normalized.startsWith('./dist/') && !normalized.startsWith('./migrations/')) {
      issues.push(
        issue(
          'PACKAGE_EXPORT_INVALID',
          scope,
          path,
          `Package export ${target} must resolve from dist or migrations.`,
        ),
      )
    }
  }
  if (environment === 'server' && !('./migrations/*' in value)) {
    issues.push(
      issue('MIGRATION_EXPORT_MISSING', scope, path, 'Server package must export ./migrations/*.'),
    )
  }
}

function validateImportNode(
  input: PlatformModuleSource,
  node: ts.Node,
  imported: Set<string>,
  issues: PlatformModulePolicyIssue[],
) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    validateSpecifier(
      input,
      node.moduleSpecifier.text,
      ts.isImportDeclaration(node) ? node.importClause : undefined,
      imported,
      issues,
    )
    if (ts.isImportDeclaration(node) && !node.importClause) {
      issues.push(
        issue(
          'SIDE_EFFECT_IMPORT_FORBIDDEN',
          input.scope,
          input.path,
          'Side-effect imports are not allowed.',
        ),
      )
    }
  }
  if (ts.isImportEqualsDeclaration(node)) {
    issues.push(
      issue(
        'IMPORT_EQUALS_FORBIDDEN',
        input.scope,
        input.path,
        'Import-equals declarations are not allowed.',
      ),
    )
    const expression = ts.isExternalModuleReference(node.moduleReference)
      ? node.moduleReference.expression
      : undefined
    if (expression && ts.isStringLiteralLike(expression)) {
      validateSpecifier(input, expression.text, undefined, imported, issues)
    }
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const argument = node.arguments[0]
    if (!argument || !ts.isStringLiteral(argument)) {
      issues.push(
        issue(
          'DYNAMIC_IMPORT_INVALID',
          input.scope,
          input.path,
          'Dynamic imports must use string literals.',
        ),
      )
    } else {
      validateSpecifier(input, argument.text, undefined, imported, issues)
    }
  }
}

function importSpecifier(node: ts.Node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0] &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    return node.arguments[0].text
  }
  return
}

function validateSpecifier(
  input: PlatformModuleSource,
  specifier: string,
  importClause: ts.ImportClause | undefined,
  imported: Set<string>,
  issues: PlatformModulePolicyIssue[],
) {
  const normalized = specifier.replaceAll('\\', '/')
  if (isForbiddenCoreApiImport(input, normalized)) {
    issues.push(
      issue(
        'IMPORT_NOT_ALLOWED',
        input.scope,
        input.path,
        `Feature server code cannot import core API source ${specifier}.`,
      ),
    )
    return
  }
  if (normalized.startsWith('.')) {
    const target = resolve('/', dirname(input.path), normalized)
    const root = resolve('/', input.boundaryRoot)
    const targetRelative = relative(root, target)
    if (targetRelative === '..' || targetRelative.startsWith('../') || isAbsolute(targetRelative)) {
      issues.push(
        issue(
          'IMPORT_ESCAPE',
          input.scope,
          input.path,
          `Relative import ${specifier} escapes the feature package root.`,
        ),
      )
    }
    return
  }
  if (normalized.startsWith('/') || normalized.startsWith('file:')) {
    issues.push(
      issue(
        'ABSOLUTE_IMPORT_FORBIDDEN',
        input.scope,
        input.path,
        'Absolute imports are not allowed.',
      ),
    )
    return
  }
  if (normalized === '#imports') {
    validateNuxtImport(input, importClause, issues)
    return
  }
  if (normalized.startsWith('#')) {
    issues.push(
      issue(
        'IMPORT_NOT_ALLOWED',
        input.scope,
        input.path,
        `Import ${specifier} bypasses the public platform surface.`,
      ),
    )
    return
  }
  const packageName = packageNameFromSpecifier(normalized)
  imported.add(packageName)
  const allowedPackages =
    input.environment === 'server' ? serverRuntimePackages : nuxtRuntimePackages
  const allowedImports =
    input.environment === 'server' ? exactServerRuntimeImports : exactNuxtRuntimeImports
  if (!allowedPackages.has(packageName) || !allowedImports.has(normalized)) {
    issues.push(
      issue(
        'IMPORT_NOT_ALLOWED',
        input.scope,
        input.path,
        `Import ${safeSpecifier(specifier)} is not allowed for ${input.environment} module code.`,
      ),
    )
  }
  if (normalized === '@eve-space/platform-module-server') {
    rejectNamedImports(
      input,
      importClause,
      new Set([
        'PlatformInstalledPersistenceOperationDescriptor',
        'PlatformPersistenceOperationInvoker',
        'bindPlatformPersistenceOperation',
      ]),
      issues,
    )
  }
  if (normalized === '@eve-space/platform-module-nuxt/runtime') {
    rejectNamedImports(
      input,
      importClause,
      new Set(['PlatformApiClient', 'PlatformApiHost', 'createPlatformApiClient']),
      issues,
    )
  }
}

function isForbiddenCoreApiImport(input: PlatformModuleSource, normalized: string) {
  return (
    input.environment === 'server' &&
    (normalized === '@eve-space/api' ||
      normalized.startsWith('@eve-space/api/') ||
      /(?:^|\/)api\/src(?:\/|$)/.test(normalized))
  )
}

function validateNuxtImport(
  input: PlatformModuleSource,
  importClause: ts.ImportClause | undefined,
  issues: PlatformModulePolicyIssue[],
) {
  if (input.environment !== 'nuxt') {
    issues.push(
      issue(
        'IMPORT_NOT_ALLOWED',
        input.scope,
        input.path,
        '#imports is not allowed in server code.',
      ),
    )
    return
  }
  const names = importedNames(importClause)
  const rejected = names.filter((name) => !allowedNuxtImports.has(name))
  if (rejected.length > 0 || names.length === 0) {
    issues.push(
      issue(
        'NUXT_IMPORT_NOT_ALLOWED',
        input.scope,
        input.path,
        `#imports may only expose approved Nuxt runtime imports; rejected ${rejected.join(', ') || 'namespace/default import'}.`,
      ),
    )
  }
}

function rejectNamedImports(
  input: PlatformModuleSource,
  clause: ts.ImportClause | undefined,
  rejected: ReadonlySet<string>,
  issues: PlatformModulePolicyIssue[],
) {
  const names = importedNames(clause).filter((name) => rejected.has(name))
  if (!clause?.namedBindings || ts.isNamespaceImport(clause.namedBindings)) {
    issues.push(
      issue(
        'PUBLIC_CONTRACT_IMPORT_REQUIRED',
        input.scope,
        input.path,
        'Platform imports must use named feature-facing exports.',
      ),
    )
  }
  if (names.length > 0) {
    issues.push(
      issue(
        'HOST_CONTRACT_IMPORT_FORBIDDEN',
        input.scope,
        input.path,
        `Feature package imports host-only platform symbols ${names.join(', ')}.`,
      ),
    )
  }
}

function parseSourceFiles(input: PlatformModuleSource, issues: PlatformModulePolicyIssue[]) {
  if (!input.path.endsWith('.vue')) {
    return [parseTypescript(input, input.path, input.source, issues)]
  }
  const parsed = parseVue(input.source, { filename: input.path })
  if (parsed.errors.length > 0) {
    issues.push(
      issue('SOURCE_PARSE_ERROR', input.scope, input.path, 'Vue source must parse without errors.'),
    )
  }
  return [parsed.descriptor.script, parsed.descriptor.scriptSetup].flatMap((script, index) => {
    if (!script) {
      return []
    }
    if (script.src !== undefined) {
      issues.push(
        issue(
          'VUE_EXTERNAL_SCRIPT_FORBIDDEN',
          input.scope,
          input.path,
          'Vue script blocks must be inline.',
        ),
      )
    }
    const language = script.lang ?? 'js'
    if (!['js', 'jsx', 'ts', 'tsx'].includes(language)) {
      issues.push(
        issue(
          'VUE_SCRIPT_LANGUAGE_INVALID',
          input.scope,
          input.path,
          `Unsupported Vue script language ${language}.`,
        ),
      )
      return []
    }
    return [
      parseTypescript(input, `${input.path}#script-${index}.${language}`, script.content, issues),
    ]
  })
}

function parseTypescript(
  input: PlatformModuleSource,
  path: string,
  source: string,
  issues: PlatformModulePolicyIssue[],
) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path))
  if (
    (file as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] })
      .parseDiagnostics.length > 0
  ) {
    issues.push(
      issue(
        'SOURCE_PARSE_ERROR',
        input.scope,
        input.path,
        'Source must parse without syntax errors.',
      ),
    )
  }
  return file
}

function sourceFileChecker(sourceFile: ts.SourceFile) {
  const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name) => (name === sourceFile.fileName ? sourceFile : undefined)
  return ts.createProgram([sourceFile.fileName], options, host).getTypeChecker()
}

function isUnboundIdentifier(node: ts.Identifier, checker: ts.TypeChecker) {
  if (!isValueReference(node)) {
    return false
  }
  const symbol = checker.getSymbolAtLocation(node)
  return !symbol?.declarations?.length
}

function isValueReference(node: ts.Identifier) {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent)) {
    return true
  }
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.expression === node
  }
  if (ts.isBindingElement(parent)) {
    return parent.initializer === node
  }
  if (ts.isPropertyAssignment(parent)) {
    return parent.initializer === node
  }
  return !('name' in parent && parent.name === node)
}

function isRuntimeSqlLiteral(node: ts.Node) {
  const value =
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? node.head.text
        : undefined
  if (value === undefined) {
    return ts.isTaggedTemplateExpression(node) && ['sql', 'query'].includes(node.tag.getText())
  }
  const normalized = value.trimStart().toLowerCase()
  return (
    (normalized.startsWith('select ') && normalized.includes(' from ')) ||
    [
      'alter ',
      'call ',
      'create ',
      'delete from ',
      'drop ',
      'grant ',
      'insert into ',
      'revoke ',
      'set role ',
      'truncate ',
      'update ',
      'with ',
    ].some((prefix) => normalized.startsWith(prefix))
  )
}

function persistenceCapabilityNames(sourceFile: ts.SourceFile) {
  const names = new Set(['persistence'])
  let changed = true
  while (changed) {
    changed = false
    visit(sourceFile, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) {
        return
      }
      const initializer = unwrapExpression(node.initializer)
      const alias =
        (ts.isIdentifier(initializer) && names.has(initializer.text)) ||
        (ts.isPropertyAccessExpression(initializer) && initializer.name.text === 'persistence')
      if (alias && !names.has(node.name.text)) {
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
  if (ts.isPropertyAccessExpression(target)) {
    return (
      genericPersistenceMethods.has(target.name.text) &&
      referencesPersistence(target.expression, persistenceNames)
    )
  }
  return (
    ts.isElementAccessExpression(target) &&
    referencesPersistence(target.expression, persistenceNames)
  )
}

function referencesPersistence(expression: ts.Expression, names: ReadonlySet<string>): boolean {
  const target = unwrapExpression(expression)
  if (ts.isIdentifier(target)) {
    return names.has(target.text)
  }
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text === 'persistence' || referencesPersistence(target.expression, names)
  }
  if (ts.isElementAccessExpression(target)) {
    return referencesPersistence(target.expression, names)
  }
  return false
}

function isForbiddenGlobalProperty(
  node: ts.Node,
  environment: PlatformModuleEnvironment,
): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    globalObjectNames.has(node.expression.text) &&
    forbiddenGlobals(environment).has(node.name.text)
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
  ) {
    value = value.expression
  }
  return value
}

function forbiddenGlobals(environment: PlatformModuleEnvironment) {
  return environment === 'server' ? forbiddenServerGlobals : forbiddenNuxtGlobals
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.values(value).flatMap(exportTargets)
}

function importedNames(clause: ts.ImportClause | undefined) {
  if (
    !clause ||
    clause.name ||
    !clause.namedBindings ||
    ts.isNamespaceImport(clause.namedBindings)
  ) {
    return []
  }
  return clause.namedBindings.elements.map(
    (element) => element.propertyName?.text ?? element.name.text,
  )
}

function packageNameFromSpecifier(specifier: string) {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier)
}

function packageRelativePath(input: PlatformModuleSource) {
  const prefix = `${input.boundaryRoot.replaceAll('\\', '/').replace(/\/$/, '')}/`
  const normalized = input.path.replaceAll('\\', '/')
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
}

function relativeImportCandidates(
  target: string,
  importer: string,
  scope: PlatformModulePolicyScope,
) {
  if (extname(target)) {
    const declarationTarget =
      importer.endsWith('.d.ts') && target.endsWith('.js')
        ? `${target.slice(0, -3)}.d.ts`
        : undefined
    const sourceTargets =
      scope === 'source' && target.endsWith('.js')
        ? [`${target.slice(0, -3)}.ts`, `${target.slice(0, -3)}.tsx`]
        : []
    return [target, ...(declarationTarget ? [declarationTarget] : []), ...sourceTargets]
  }
  return [
    target,
    `${target}.js`,
    `${target}.mjs`,
    `${target}.cjs`,
    `${target}.ts`,
    `${target}.mts`,
    `${target}.cts`,
    `${target}.tsx`,
    `${target}.jsx`,
    `${target}.vue`,
    `${target}/index.js`,
    `${target}/index.ts`,
  ]
}

function normalizeRelativePath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

function safePackageName(value: string) {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i.test(value)
    ? value
    : '<invalid>'
}

function safeSpecifier(value: string) {
  return value.includes('://') || (value.includes('@') && value.includes(':')) ? '<invalid>' : value
}

function isNuxtSideEffects(value: unknown) {
  return Array.isArray(value) && value.length === 1 && value[0] === '**/*.vue'
}

function scriptKind(path: string) {
  if (path.endsWith('.tsx')) {
    return ts.ScriptKind.TSX
  }
  if (path.endsWith('.jsx')) {
    return ts.ScriptKind.JSX
  }
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function visit(node: ts.Node, operation: (node: ts.Node) => void) {
  operation(node)
  ts.forEachChild(node, (child) => visit(child, operation))
}

function issue(
  code: string,
  scope: PlatformModulePolicyScope,
  path: string,
  message: string,
): PlatformModulePolicyIssue {
  return { code, message, path: path.replaceAll('\\', '/'), scope }
}

function sortedIssues(issues: readonly PlatformModulePolicyIssue[]) {
  return issues.toSorted((left, right) =>
    `${left.scope}\0${left.path}\0${left.code}\0${left.message}`.localeCompare(
      `${right.scope}\0${right.path}\0${right.code}\0${right.message}`,
    ),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
