import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  compilePlatformModules,
  readCompiledPlatformModules,
  type CompiledPlatformModules,
  type PlatformModuleCandidate,
} from '@eve-space/platform-module-contract/compiler'
import {
  isPlatformModuleId,
  isPlatformPackageExport,
  isPlatformPackageName,
  isPlatformSemanticVersion,
} from '@eve-space/platform-module-contract/identifiers'
import {
  platformModuleHostContractVersion,
  type PlatformModuleManifest,
} from '@eve-space/platform-module-contract/manifest'
import ts from 'typescript'
import { parse as parseYaml } from 'yaml'
import { coreModuleValidationAuthorities } from './authorities.js'

const semanticVersionNumberPattern = /^(?:0|[1-9]\d*)$/
const semanticVersionLooseIdentifiersPattern = /^[\dA-Za-z.-]+$/

interface InstalledModuleSelection {
  readonly moduleId: string
  readonly manifest: {
    readonly package: string
    readonly export: string
  }
}

export interface ResolvedModulePackage {
  readonly name: string
  readonly version: string
  readonly integrity: string
  readonly root: string
  readonly entryPath: string
  readonly workspace: boolean
}

interface ResolvedModuleMigration {
  readonly name: string
  readonly exportPath: string
  readonly path: string
}

export interface ResolvedInstalledModuleRelease {
  readonly moduleId: string
  readonly publisherPackage: string
  readonly version: string
  readonly manifestExport: string
  readonly manifest: PlatformModuleManifest
  readonly packages: {
    readonly manifest: ResolvedModulePackage
    readonly server: ResolvedModulePackage
    readonly nuxt: ResolvedModulePackage
  }
  readonly migrations: readonly ResolvedModuleMigration[]
  readonly nuxtPages: Readonly<Record<string, string>>
}

export interface ResolvedInstalledModuleSet {
  readonly compiled: CompiledPlatformModules
  readonly releases: readonly ResolvedInstalledModuleRelease[]
}

interface PackageJson extends Record<string, unknown> {
  readonly name?: unknown
  readonly version?: unknown
  readonly exports?: unknown
  readonly files?: unknown
  readonly dependencies?: unknown
}

interface Lockfile {
  readonly importers?: Record<
    string,
    {
      readonly dependencies?: Record<string, { readonly version?: unknown }>
      readonly devDependencies?: Record<string, { readonly version?: unknown }>
    }
  >
  readonly packages?: Record<
    string,
    {
      readonly name?: unknown
      readonly version?: unknown
      readonly resolution?: {
        readonly integrity?: unknown
        readonly tarball?: unknown
      }
    }
  >
  readonly snapshots?: Record<string, unknown>
}

interface PackageResolutionContext {
  readonly lockfile: Lockfile
  readonly lockRoot: string
  readonly hostRoot: string
  readonly importer: string
}

function readInstalledModuleSelections(root: string): readonly InstalledModuleSelection[] {
  const path = join(root, 'features/installed-modules.json')
  const installed = readJson(path)
  if (!isRecord(installed) || Object.keys(installed).some((key) => key !== 'modules')) {
    throw new Error('features/installed-modules.json must contain module package-export records')
  }
  if (!Array.isArray(installed.modules)) {
    throw new TypeError(
      'features/installed-modules.json must contain module package-export records',
    )
  }

  const selections = installed.modules.map((value, index) => parseSelection(value, index))
  const moduleIds = new Set<string>()
  const manifestPackages = new Set<string>()
  for (const selection of selections) {
    if (moduleIds.has(selection.moduleId)) {
      throw new Error(`Duplicate installed module selection ${selection.moduleId}`)
    }
    if (manifestPackages.has(selection.manifest.package)) {
      throw new Error(`Duplicate installed manifest package ${selection.manifest.package}`)
    }
    moduleIds.add(selection.moduleId)
    manifestPackages.add(selection.manifest.package)
  }
  return selections
}

export function resolveInstalledModuleReleases(
  root: string,
  options: { readonly validateArtifacts?: boolean } = {},
): ResolvedInstalledModuleSet {
  const selections = readInstalledModuleSelections(root)
  const lockfile = readLockfile(root)
  const rootContext = packageContext(root, root, '.', lockfile)
  const apiContext = packageContext(root, join(root, 'api'), 'api', lockfile)
  const manifestResolutions = selections.map((selection) => {
    const resolved = resolvePackage(
      rootContext,
      selection.manifest.package,
      selection.manifest.export,
    )
    assertManifestPackage(
      resolved.packageJson,
      selection.manifest.package,
      selection.manifest.export,
    )
    return {
      declaration: readJson(resolved.package.entryPath),
      resolved,
      selection,
    }
  })
  const candidates: PlatformModuleCandidate[] = manifestResolutions.map(
    ({ selection, declaration }) => ({
      declaration,
      expectedModuleId: selection.moduleId,
      expectedPublisherPackage: selection.manifest.package,
    }),
  )
  const compiled = compilePlatformModules(candidates, coreModuleValidationAuthorities)
  const manifests = readCompiledPlatformModules(compiled)
  const resolutionsByModuleId = new Map(
    manifestResolutions.map((resolution) => [resolution.selection.moduleId, resolution]),
  )
  const releases = manifests.map((manifest) => {
    const manifestResolution = resolutionsByModuleId.get(manifest.id)
    if (!manifestResolution) {
      throw new Error(`Missing resolved manifest package for ${manifest.id}`)
    }
    const server = resolvePackage(apiContext, manifest.server.package, '.')
    const nuxt = resolvePackage(rootContext, manifest.nuxt.package, '.')
    assertReleaseVersions(
      manifest,
      manifestResolution.resolved.package,
      server.package,
      nuxt.package,
    )
    if (
      !semanticVersionSatisfies(
        platformModuleHostContractVersion,
        manifest.release.hostContractRange,
      )
    ) {
      throw new Error(
        `Module ${manifest.id} requires host contract ${manifest.release.hostContractRange}; host provides ${platformModuleHostContractVersion}`,
      )
    }
    const migrations = resolveMigrations(manifest, server, options.validateArtifacts !== false)
    const nuxtPages = resolveNuxtPages(manifest, nuxt.package, options.validateArtifacts !== false)
    if (options.validateArtifacts !== false) {
      assertRegularPackageFile(server.package, server.package.entryPath, 'root export')
      assertRegularPackageFile(nuxt.package, nuxt.package.entryPath, 'root export')
      assertExecutableInventory(manifest, server.package.entryPath)
      assertNuxtInventory(manifest, nuxt.package.entryPath)
    }
    return {
      manifest,
      manifestExport: manifestResolution.selection.manifest.export,
      migrations,
      moduleId: manifest.id,
      nuxtPages,
      packages: {
        manifest: manifestResolution.resolved.package,
        nuxt: nuxt.package,
        server: server.package,
      },
      publisherPackage: manifest.release.publisherPackage,
      version: manifest.release.version,
    } satisfies ResolvedInstalledModuleRelease
  })
  validateDeploymentDependencies(root, releases)
  return { compiled, releases }
}

function parseSelection(value: unknown, index: number): InstalledModuleSelection {
  const path = `features/installed-modules.json modules[${index}]`
  if (!isRecord(value) || hasUnknownKeys(value, ['moduleId', 'manifest'])) {
    throw new Error(`${path} must be a module package-export record`)
  }
  if (typeof value.moduleId !== 'string' || !isPlatformModuleId(value.moduleId)) {
    throw new Error(`${path}.moduleId must be a valid platform module ID`)
  }
  if (!isRecord(value.manifest) || hasUnknownKeys(value.manifest, ['package', 'export'])) {
    throw new Error(`${path}.manifest must contain package and export`)
  }
  if (
    typeof value.manifest.package !== 'string' ||
    !isPlatformPackageName(value.manifest.package)
  ) {
    throw new Error(`${path}.manifest.package must be a valid package name`)
  }
  if (
    typeof value.manifest.export !== 'string' ||
    !isPlatformPackageExport(value.manifest.export)
  ) {
    throw new Error(`${path}.manifest.export must be a valid package export`)
  }
  return {
    manifest: { export: value.manifest.export, package: value.manifest.package },
    moduleId: value.moduleId,
  }
}

function packageContext(
  lockRoot: string,
  hostRoot: string,
  importer: string,
  lockfile: Lockfile,
): PackageResolutionContext {
  return { hostRoot, importer, lockRoot, lockfile }
}

function resolvePackage(
  context: PackageResolutionContext,
  packageName: string,
  exportPath: string,
) {
  const packageRootLink = join(context.hostRoot, 'node_modules', ...packageName.split('/'))
  let root: string
  try {
    root = realpathSync(packageRootLink)
  } catch (error) {
    const dependency = dependencyLock(context, packageName)
    if (!dependency?.version.startsWith('link:')) {
      throw new Error(`Package ${packageName} cannot be resolved from ${context.importer}`, {
        cause: error,
      })
    }
    root = realpathSync(resolve(context.lockRoot, context.importer, dependency.version.slice(5)))
  }
  const packageJsonPath = join(root, 'package.json')
  const packageJson = readPackageJson(packageJsonPath)
  if (packageJson.name !== packageName) {
    throw new Error(
      `Resolved package ${packageName} declares changed ownership ${String(packageJson.name)}`,
    )
  }
  if (typeof packageJson.version !== 'string' || !isPlatformSemanticVersion(packageJson.version)) {
    throw new Error(`Resolved package ${packageName} must declare a semantic version`)
  }
  const entryPath = resolvePackageExport(root, packageJson.exports, exportPath, packageName)
  const lock = resolveLockIdentity(context, packageName, packageJson.version, root)
  return {
    package: {
      entryPath,
      integrity: lock.integrity,
      name: packageName,
      root,
      version: packageJson.version,
      workspace: lock.workspace,
    } satisfies ResolvedModulePackage,
    packageJson,
  }
}

function resolvePackageExport(
  packageRoot: string,
  exportsValue: unknown,
  exportPath: string,
  packageName: string,
) {
  const target = packageExportTarget(exportsValue, exportPath)
  if (!target) {
    throw new Error(
      `Package ${packageName} does not export ${exportPath === '.' ? 'its root' : exportPath}`,
    )
  }
  if (!target.startsWith('./') || target.split('/').includes('..')) {
    throw new Error(`Package ${packageName} export ${exportPath} escapes its package root`)
  }
  const path = resolve(packageRoot, target)
  if (!isPathInside(packageRoot, path)) {
    throw new Error(`Package ${packageName} export ${exportPath} escapes its package root`)
  }
  return path
}

function packageExportTarget(exportsValue: unknown, exportPath: string): string | undefined {
  if (
    exportPath === '.' &&
    (typeof exportsValue === 'string' || isConditionalExport(exportsValue))
  ) {
    return conditionalExportTarget(exportsValue)
  }
  if (!isRecord(exportsValue)) {
    return undefined
  }
  const exact = conditionalExportTarget(exportsValue[exportPath])
  if (exact) {
    return exact
  }
  for (const [key, value] of Object.entries(exportsValue)) {
    const marker = key.indexOf('*')
    if (marker < 0 || !exportPath.startsWith(key.slice(0, marker))) {
      continue
    }
    const suffix = key.slice(marker + 1)
    if (!exportPath.endsWith(suffix)) {
      continue
    }
    const wildcard = exportPath.slice(marker, exportPath.length - suffix.length)
    const target = conditionalExportTarget(value)
    if (target?.includes('*')) {
      return target.replace('*', wildcard)
    }
  }
  return undefined
}

function conditionalExportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!isRecord(value)) {
    return undefined
  }
  return conditionalExportTarget(value.import) ?? conditionalExportTarget(value.default)
}

function isConditionalExport(value: unknown) {
  return isRecord(value) && Object.keys(value).every((key) => !key.startsWith('.'))
}

function resolveLockIdentity(
  context: PackageResolutionContext,
  packageName: string,
  packageVersion: string,
  packageRoot: string,
) {
  const dependency = dependencyLock(context, packageName)
  if (!dependency || typeof dependency.version !== 'string') {
    throw new Error(`Package ${packageName} must be a direct dependency of ${context.importer}`)
  }
  if (dependency.version.startsWith('link:')) {
    const lockedRoot = realpathSync(
      resolve(context.lockRoot, context.importer, dependency.version.slice(5)),
    )
    if (lockedRoot !== packageRoot) {
      throw new Error(
        `Workspace lockfile target for ${packageName} differs from the resolved package`,
      )
    }
    return { integrity: 'workspace', workspace: true }
  }
  const archiveReference = fileArchiveReference(dependency.version)
  if (archiveReference) {
    return resolveFileArchiveLockIdentity(
      context.lockfile,
      packageName,
      packageVersion,
      dependency.version,
      archiveReference,
    )
  }
  const lockedVersion = semanticVersionPrefix(dependency.version)
  if (lockedVersion !== packageVersion) {
    throw new Error(
      `Lockfile version for ${packageName} is ${lockedVersion || dependency.version}; package declares ${packageVersion}`,
    )
  }
  const packageKey = Object.keys(context.lockfile.packages ?? {})
    .filter(
      (key) =>
        key === `${packageName}@${packageVersion}` ||
        key.startsWith(`${packageName}@${packageVersion}(`),
    )
    .toSorted((left, right) => left.localeCompare(right))[0]
  const integrity = packageKey
    ? context.lockfile.packages?.[packageKey]?.resolution?.integrity
    : undefined
  if (typeof integrity !== 'string' || !integrity.startsWith('sha')) {
    throw new Error(`Lockfile integrity for ${packageName}@${packageVersion} is missing`)
  }
  return { integrity, workspace: false }
}

function resolveFileArchiveLockIdentity(
  lockfile: Lockfile,
  packageName: string,
  packageVersion: string,
  dependencyVersion: string,
  archiveReference: string,
) {
  const expectedKey = `${packageName}@${dependencyVersion}`
  const packages = lockfile.packages ?? {}
  const snapshots = lockfile.snapshots ?? {}
  const exact = Object.hasOwn(packages, expectedKey) ? [expectedKey] : []
  const candidates = (
    exact.length > 0
      ? exact
      : Object.keys(packages).filter((key) => {
          const entry = packages[key]
          return (
            key.startsWith(`${packageName}@file:`) &&
            entry?.resolution?.tarball === archiveReference &&
            (entry.name === undefined || entry.name === packageName)
          )
        })
  ).filter((key) => Object.hasOwn(snapshots, key))
  if (candidates.length !== 1) {
    throw new Error(`Lockfile archive identity for ${packageName} is missing or ambiguous`)
  }

  const locked = packages[candidates[0]!]
  if (locked?.resolution?.tarball !== archiveReference) {
    throw new Error(`Lockfile archive identity for ${packageName} does not match its dependency`)
  }
  if (locked?.version !== packageVersion) {
    throw new Error(
      `Lockfile archive version for ${packageName} does not match package version ${packageVersion}`,
    )
  }
  const integrity = locked.resolution?.integrity
  if (typeof integrity !== 'string' || !integrity.startsWith('sha')) {
    throw new Error(`Lockfile integrity for ${packageName}@${packageVersion} is missing`)
  }
  return { integrity, workspace: false }
}

function dependencyLock(context: PackageResolutionContext, packageName: string) {
  const importer = context.lockfile.importers?.[context.importer]
  return importer?.dependencies?.[packageName] ?? importer?.devDependencies?.[packageName]
}

function resolveMigrations(
  manifest: PlatformModuleManifest,
  server: { readonly package: ResolvedModulePackage; readonly packageJson: PackageJson },
  validateArtifacts: boolean,
) {
  const migrations = manifest.server.migrations.map(({ name }) => {
    const exportPath = `./migrations/${name}`
    const path = resolvePackageExport(
      server.package.root,
      server.packageJson.exports,
      exportPath,
      server.package.name,
    )
    if (validateArtifacts) {
      assertRegularPackageFile(server.package, path, `migration ${name}`)
    }
    return { exportPath, name, path }
  })
  if (!validateArtifacts) {
    return migrations
  }
  const migrationDirectory = join(server.package.root, 'migrations')
  const actual = existsSync(migrationDirectory)
    ? readdirSync(migrationDirectory)
        .filter((name) => extname(name) === '.sql')
        .toSorted((left, right) => left.localeCompare(right))
    : []
  const expected = migrations
    .map(({ name }) => name)
    .toSorted((left, right) => left.localeCompare(right))
  if (!arraysEqual(actual, expected)) {
    throw new Error(
      `Module ${manifest.id} migration artifacts differ from its manifest (missing: ${expected.filter((name) => !actual.includes(name)).join(', ') || 'none'}; extra: ${actual.filter((name) => !expected.includes(name)).join(', ') || 'none'})`,
    )
  }
  return migrations
}

function resolveNuxtPages(
  manifest: PlatformModuleManifest,
  nuxt: ResolvedModulePackage,
  validateArtifacts: boolean,
) {
  return Object.fromEntries(
    manifest.nuxt.pages.map((page) => {
      const path = resolve(nuxt.root, page.file)
      if (!isPathInside(nuxt.root, path)) {
        throw new Error(`Nuxt page ${manifest.id}/${page.id} escapes package ${nuxt.name}`)
      }
      if (validateArtifacts) {
        assertRegularPackageFile(nuxt, path, `Nuxt page ${page.id}`)
      }
      return [page.id, path]
    }),
  )
}

function assertExecutableInventory(manifest: PlatformModuleManifest, entryPath: string) {
  const expected = [
    ...manifest.server.routes,
    ...manifest.server.persistenceOperations,
    ...manifest.server.resources,
    ...manifest.server.esiOperations,
    ...manifest.server.activityProviders,
  ]
    .map(({ exportName }) => exportName)
    .toSorted((left, right) => left.localeCompare(right))
  const actual = [...collectRuntimeExports(entryPath)]
    .filter((name) => name !== 'default')
    .toSorted((left, right) => left.localeCompare(right))
  if (!arraysEqual(actual, expected)) {
    throw new Error(
      `Module ${manifest.id} server exports differ from its executable inventory (missing: ${expected.filter((name) => !actual.includes(name)).join(', ') || 'none'}; extra: ${actual.filter((name) => !expected.includes(name)).join(', ') || 'none'})`,
    )
  }
}

function assertNuxtInventory(manifest: PlatformModuleManifest, entryPath: string) {
  const actual = [...collectRuntimeExports(entryPath)].toSorted((left, right) =>
    left.localeCompare(right),
  )
  if (!arraysEqual(actual, ['default'])) {
    throw new Error(`Module ${manifest.id} Nuxt package must export exactly one default module`)
  }
}

function collectRuntimeExports(path: string, visited = new Set<string>()): Set<string> {
  const realPath = runtimeExportRealPath(path)
  if (visited.has(realPath)) {
    return new Set()
  }
  visited.add(realPath)
  const source = ts.createSourceFile(
    realPath,
    readFileSync(realPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const names = source.statements.flatMap((statement) =>
    runtimeExportNames(statement, realPath, visited),
  )
  return new Set(names)
}

function runtimeExportRealPath(path: string) {
  const sourcePath =
    !existsSync(path) && path.endsWith('.js') && existsSync(`${path.slice(0, -3)}.ts`)
      ? `${path.slice(0, -3)}.ts`
      : path
  return realpathSync(sourcePath)
}

function runtimeExportNames(statement: ts.Statement, realPath: string, visited: Set<string>) {
  if (ts.isExportAssignment(statement)) {
    return statement.isExportEquals ? [] : ['default']
  }
  if (ts.isExportDeclaration(statement)) {
    return exportDeclarationRuntimeNames(statement, realPath, visited)
  }
  if (!statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
    return []
  }
  return exportedStatementNames(statement)
}

function exportDeclarationRuntimeNames(
  declaration: ts.ExportDeclaration,
  realPath: string,
  visited: Set<string>,
) {
  if (declaration.exportClause && ts.isNamedExports(declaration.exportClause)) {
    return declaration.exportClause.elements.map(({ name }) => name.text)
  }
  if (declaration.exportClause || !declaration.moduleSpecifier) {
    return []
  }
  const target = stringLiteral(declaration.moduleSpecifier)
  if (!target?.startsWith('.')) {
    throw new Error(`Runtime export ${realPath} re-exports outside its package`)
  }
  const nested = resolve(dirname(realPath), target)
  return [...collectRuntimeExports(nested, visited)].filter((name) => name !== 'default')
}

function exportedStatementNames(statement: ts.Statement) {
  const names: string[] = []
  if (statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) {
    names.push('default')
  }
  const declarationName = runtimeDeclarationName(statement)
  if (declarationName) {
    names.push(declarationName)
  }
  if (!ts.isVariableStatement(statement)) {
    return names
  }
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
  }
  return names
}

function runtimeDeclarationName(statement: ts.Statement) {
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name?.text
  }
}

function assertRegularPackageFile(
  packageArtifact: ResolvedModulePackage,
  path: string,
  label: string,
) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Package ${packageArtifact.name} is missing ${label}`)
  }
  const realPath = realpathSync(path)
  if (!isPathInside(packageArtifact.root, realPath)) {
    throw new Error(`Package ${packageArtifact.name} ${label} escapes its package root`)
  }
}

function assertManifestPackage(
  packageJson: PackageJson,
  packageName: string,
  manifestExport: string,
) {
  if (packageJson.sideEffects !== false) {
    throw new Error(`Manifest package ${packageName} must declare sideEffects false`)
  }
  const targets = allExportTargets(packageJson.exports)
  if (targets.length !== 1 || !packageExportTarget(packageJson.exports, manifestExport)) {
    throw new Error(`Manifest package ${packageName} must export only ${manifestExport}`)
  }
  if (!Array.isArray(packageJson.files) || packageJson.files.length !== 1) {
    throw new Error(`Manifest package ${packageName} must publish only its canonical manifest`)
  }
}

function assertReleaseVersions(
  manifest: PlatformModuleManifest,
  ...packages: readonly ResolvedModulePackage[]
) {
  for (const artifact of packages) {
    if (artifact.version !== manifest.release.version)
      throw new Error(
        `Module ${manifest.id} release ${manifest.release.version} does not match ${artifact.name}@${artifact.version}`,
      )
  }
}

function validateDeploymentDependencies(
  root: string,
  releases: readonly ResolvedInstalledModuleRelease[],
) {
  const rootPackage = readPackageJson(join(root, 'package.json'))
  const apiPackage = readPackageJson(join(root, 'api/package.json'))
  const rootDependencies = dependencyNames(rootPackage)
  const apiDependencies = dependencyNames(apiPackage)
  const expectedManifest = new Set(releases.map(({ packages }) => packages.manifest.name))
  const expectedServer = new Set(releases.map(({ packages }) => packages.server.name))
  const expectedNuxt = new Set(releases.map(({ packages }) => packages.nuxt.name))
  assertDependenciesPresent('root manifest', rootDependencies, expectedManifest)
  assertDependenciesPresent('API server', apiDependencies, expectedServer)
  assertDependenciesPresent('root Nuxt', rootDependencies, expectedNuxt)
  for (const packageName of [...expectedManifest, ...expectedNuxt]) {
    if (apiDependencies.has(packageName))
      throw new Error(`API dependencies must not include module package ${packageName}`)
  }
  for (const packageName of expectedServer) {
    if (rootDependencies.has(packageName))
      throw new Error(`Root dependencies must not include module server package ${packageName}`)
  }
}

function assertDependenciesPresent(label: string, actual: Set<string>, expected: Set<string>) {
  const missing = [...expected]
    .filter((name) => !actual.has(name))
    .toSorted((left, right) => left.localeCompare(right))
  if (missing.length > 0) {
    throw new Error(
      `${label} dependencies are missing installed module packages: ${missing.join(', ')}`,
    )
  }
}

function dependencyNames(packageJson: PackageJson) {
  return new Set(isRecord(packageJson.dependencies) ? Object.keys(packageJson.dependencies) : [])
}

function readLockfile(root: string): Lockfile {
  const value: unknown = parseYaml(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
  if (!isRecord(value)) {
    throw new Error('pnpm-lock.yaml must contain an object')
  }
  return value as Lockfile
}

function readPackageJson(path: string): PackageJson {
  const value = readJson(path)
  if (!isRecord(value)) {
    throw new Error(`${path} must contain a JSON object`)
  }
  return value
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Could not read JSON artifact ${path}`, { cause: error })
  }
}

function semanticVersionSatisfies(version: string, range: string) {
  const parsedVersion = parseSemanticVersion(version)
  if (!parsedVersion) {
    return false
  }
  return range.split('||').some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .every((comparator) => satisfiesComparator(parsedVersion, comparator)),
  )
}

function satisfiesComparator(version: SemanticVersion, comparator: string) {
  const match = /^(\^|~|<=|>=|<|>|=)?(.+)$/.exec(comparator)
  if (!match?.[2]) {
    return false
  }
  const operator = match[1] ?? '='
  const requested = parseSemanticVersion(match[2])
  if (!requested) {
    return satisfiesWildcard(version, match[2], operator)
  }
  const compared = compareSemanticVersion(version, requested)
  if (operator === '^') {
    return satisfiesUpperBound(version, compared, caretUpperBound(requested))
  }
  if (operator === '~') {
    const upper = { major: requested.major, minor: requested.minor + 1, patch: 0, prerelease: [] }
    return satisfiesUpperBound(version, compared, upper)
  }
  return satisfiesOrderedComparator(operator, compared)
}

function caretUpperBound(version: SemanticVersion): SemanticVersion {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] }
  }
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] }
}

function satisfiesUpperBound(version: SemanticVersion, compared: number, upper: SemanticVersion) {
  return compared >= 0 && compareSemanticVersion(version, upper) < 0
}

function satisfiesOrderedComparator(operator: string, compared: number) {
  switch (operator) {
    case '=':
      return compared === 0
    case '<':
      return compared < 0
    case '<=':
      return compared <= 0
    case '>':
      return compared > 0
    case '>=':
      return compared >= 0
    default:
      return false
  }
}

interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const buildSeparator = value.indexOf('+')
  if (buildSeparator !== value.lastIndexOf('+')) {
    return undefined
  }
  const versionAndPrerelease = buildSeparator < 0 ? value : value.slice(0, buildSeparator)
  const build = buildSeparator < 0 ? undefined : value.slice(buildSeparator + 1)
  if (build !== undefined && !semanticVersionLooseIdentifiersPattern.test(build)) {
    return undefined
  }

  const prereleaseSeparator = versionAndPrerelease.indexOf('-')
  const core =
    prereleaseSeparator < 0
      ? versionAndPrerelease
      : versionAndPrerelease.slice(0, prereleaseSeparator)
  const prerelease =
    prereleaseSeparator < 0 ? undefined : versionAndPrerelease.slice(prereleaseSeparator + 1)
  if (prerelease !== undefined && !semanticVersionLooseIdentifiersPattern.test(prerelease)) {
    return undefined
  }
  const coreParts = core.split('.')
  if (
    coreParts.length !== 3 ||
    !coreParts.every((part) => semanticVersionNumberPattern.test(part))
  ) {
    return undefined
  }
  return {
    major: Number(coreParts[0]),
    minor: Number(coreParts[1]),
    patch: Number(coreParts[2]),
    prerelease: prerelease?.split('.') ?? [],
  }
}

function compareSemanticVersion(left: SemanticVersion, right: SemanticVersion) {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch
  if (core !== 0) {
    return Math.sign(core)
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

function comparePrerelease(left: readonly string[], right: readonly string[]) {
  if (left.length === 0) {
    return right.length === 0 ? 0 : 1
  }
  if (right.length === 0) {
    return -1
  }
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const compared = comparePrereleasePart(left[index], right[index])
    if (compared !== 0) {
      return compared
    }
  }
  return 0
}

function comparePrereleasePart(left: string | undefined, right: string | undefined) {
  if (left === undefined) {
    return -1
  }
  if (right === undefined) {
    return 1
  }
  if (left === right) {
    return 0
  }
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return Math.sign(leftNumber - rightNumber)
  }
  if (leftNumber !== undefined) {
    return -1
  }
  if (rightNumber !== undefined) {
    return 1
  }
  return left < right ? -1 : 1
}

function satisfiesWildcard(version: SemanticVersion, requested: string, operator: string) {
  if (operator !== '=') {
    return false
  }
  const parts = requested.split('.')
  const actual = [version.major, version.minor, version.patch]
  return parts.every((part, index) =>
    part === '*' || part === 'x' || part === 'X' ? true : Number(part) === actual[index],
  )
}

function semanticVersionPrefix(value: string) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\dA-Za-z.-]+)?/.exec(value)?.[0]
}

function fileArchiveReference(value: string) {
  if (!value.startsWith('file:')) {
    return
  }
  const archiveEnd = value.lastIndexOf('.tgz')
  if (archiveEnd < 5) {
    return
  }
  const end = archiveEnd + 4
  const suffix = value.slice(end)
  return suffix === '' || suffix.startsWith('(') ? value.slice(0, end) : undefined
}

function allExportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.values(value).flatMap(allExportTargets)
}

function stringLiteral(node: ts.Expression) {
  return ts.isStringLiteral(node) ? node.text : undefined
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).some((key) => !allowed.includes(key))
}

function isPathInside(root: string, path: string) {
  const target = relative(root, path)
  return target !== '' && target !== '..' && !target.startsWith(`..${sep}`) && !isAbsolute(target)
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
