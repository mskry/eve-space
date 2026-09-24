import { lstat, readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  compilePlatformModules,
  readCompiledPlatformModules,
} from '@eve-space/platform-module-contract/compiler'
import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'
import { platformModulePublisherAuthorities } from '@eve-space/platform-module-contract/publisher'
import {
  assertModuleMigrationSql,
  ModuleMigrationValidationError,
} from '@eve-space/platform-module-persistence-policy/postgres-policy'
import {
  modulePersistenceNames,
  modulePersistenceRoutineName,
} from '@eve-space/platform-module-persistence-policy/persistence-policy'
import ts from 'typescript'
import {
  platformModulePackageManifestIssues,
  platformModuleRelativeImportIssues,
  platformModuleSourceIssues,
  runtimeDependencyNames,
  type PlatformModuleEnvironment,
  type PlatformModulePackageManifest,
  type PlatformModulePolicyScope,
} from './source-policy.js'

const inspectableExtensions = new Set([
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
const sensitiveFileNames = new Set(['.env', '.npmrc', '.pnpmfile.cjs'])

export interface PlatformModulePackageInput {
  readonly packageRoot?: string
  readonly archivePath?: string
}

export interface PlatformModuleManifestInput extends PlatformModulePackageInput {
  readonly data?: unknown
  readonly path?: string
  readonly export?: string
}

export interface PlatformModuleRuntimeInput extends PlatformModulePackageInput {
  readonly sourceRoot?: string
}

export interface PlatformModuleConformanceInput {
  readonly manifest: PlatformModuleManifestInput
  readonly server: PlatformModuleRuntimeInput
  readonly nuxt: PlatformModuleRuntimeInput
}

export interface PlatformModuleArtifactVerificationOptions {
  readonly baseDirectory?: string
  readonly allowLocalDependencySpecifiers?:
    | boolean
    | Readonly<Partial<Record<PlatformModuleEnvironment, boolean>>>
}

export interface PlatformModuleConformanceIssue {
  readonly code: string
  readonly scope: 'input' | PlatformModulePolicyScope
  readonly path: string
  readonly message: string
}

export interface PlatformModuleConformanceReport {
  readonly version: 1
  readonly ok: boolean
  readonly checks: {
    readonly source: boolean
    readonly artifact: boolean
  }
  readonly issues: readonly PlatformModuleConformanceIssue[]
}

export async function runPlatformModuleConformance(
  input: PlatformModuleConformanceInput,
  options: { readonly baseDirectory?: string } = {},
): Promise<PlatformModuleConformanceReport> {
  const baseDirectory = resolve(options.baseDirectory ?? process.cwd())
  const issues: PlatformModuleConformanceIssue[] = []
  const manifest = await loadManifestInput(input.manifest, baseDirectory, issues)
  const sourceRequested = !!(input.server.sourceRoot || input.nuxt.sourceRoot)
  if (manifest) {
    await validateSourceRoot(manifest, 'server', input.server, baseDirectory, issues)
    await validateSourceRoot(manifest, 'nuxt', input.nuxt, baseDirectory, issues)
  }
  const artifactRequested =
    hasPackageArtifact(input.manifest) ||
    hasPackageArtifact(input.server) ||
    hasPackageArtifact(input.nuxt)
  if (artifactRequested) {
    const artifactReport = await verifyInstalledModuleArtifacts(input, {
      allowLocalDependencySpecifiers:
        sourceRequested &&
        !input.manifest.archivePath &&
        !input.server.archivePath &&
        !input.nuxt.archivePath,
      baseDirectory,
    })
    issues.push(...artifactReport.issues)
  }
  if (!sourceRequested && !artifactRequested) {
    issues.push(
      issue(
        'CONFORMANCE_INPUT_INVALID',
        'input',
        'config.json',
        'At least one source or artifact check must be configured.',
      ),
    )
  }
  return report(sourceRequested, artifactRequested, issues)
}

export async function verifyInstalledModuleArtifacts(
  input: PlatformModuleConformanceInput,
  options: PlatformModuleArtifactVerificationOptions = {},
): Promise<PlatformModuleConformanceReport> {
  const baseDirectory = resolve(options.baseDirectory ?? process.cwd())
  const issues: PlatformModuleConformanceIssue[] = []
  const [manifestView, serverView, nuxtView] = await Promise.all([
    openPackageView(input.manifest, 'manifest', baseDirectory, issues),
    openPackageView(input.server, 'server', baseDirectory, issues),
    openPackageView(input.nuxt, 'nuxt', baseDirectory, issues),
  ])
  if (!manifestView || !serverView || !nuxtView) {
    return report(false, true, issues)
  }

  const manifestPackage = await readPackageManifest(manifestView, issues)
  const serverPackage = await readPackageManifest(serverView, issues)
  const nuxtPackage = await readPackageManifest(nuxtView, issues)
  if (!manifestPackage || !serverPackage || !nuxtPackage) {
    return report(false, true, issues)
  }

  const manifestExport = input.manifest.export ?? './manifest'
  const manifestTarget = resolveExportTarget(manifestPackage.exports, manifestExport)
  if (!manifestTarget) {
    issues.push(
      issue(
        'MANIFEST_EXPORT_MISSING',
        'artifact',
        'manifest/package.json',
        `Manifest package must export ${manifestExport}.`,
      ),
    )
    return report(false, true, issues)
  }
  const manifestData = await readJsonFromView(
    manifestView,
    manifestTarget,
    'manifest/manifest.json',
    issues,
  )
  const manifest = compileManifest(
    manifestData,
    stringValue(manifestPackage.name),
    'artifact',
    issues,
  )
  if (!manifest) {
    return report(false, true, issues)
  }

  validateManifestPackage(
    manifest,
    manifestPackage,
    manifestExport,
    manifestTarget,
    manifestView,
    issues,
  )
  await validateRuntimeArtifact(
    manifest,
    'server',
    serverPackage,
    serverView,
    allowsLocalDependencySpecifiers(options, 'server'),
    issues,
  )
  await validateRuntimeArtifact(
    manifest,
    'nuxt',
    nuxtPackage,
    nuxtView,
    allowsLocalDependencySpecifiers(options, 'nuxt'),
    issues,
  )
  validateReleaseAgreement(manifest, manifestPackage, serverPackage, nuxtPackage, issues)
  return report(false, true, issues)
}

export function formatPlatformModuleConformanceReport(result: PlatformModuleConformanceReport) {
  const lines = [
    result.ok ? 'Platform module conformance passed.' : 'Platform module conformance failed.',
    `Checks: source=${result.checks.source ? 'run' : 'not-run'}, artifact=${result.checks.artifact ? 'run' : 'not-run'}`,
  ]
  for (const finding of result.issues) {
    lines.push(`[${finding.code}] ${finding.scope} ${finding.path}: ${finding.message}`)
  }
  return lines.join('\n')
}

async function loadManifestInput(
  input: PlatformModuleManifestInput,
  baseDirectory: string,
  issues: PlatformModuleConformanceIssue[],
) {
  let value = input.data
  if (value === undefined && input.path) {
    try {
      value = JSON.parse(
        await readFile(resolveInputPath(baseDirectory, input.path), 'utf8'),
      ) as unknown
    } catch {
      issues.push(
        issue(
          'MANIFEST_READ_FAILED',
          'input',
          'manifest/manifest.json',
          'Canonical manifest data could not be read.',
        ),
      )
    }
  }
  if (value === undefined) {
    return
  }
  const expectedPublisher =
    isRecord(value) && isRecord(value.release) ? stringValue(value.release.publisherPackage) : ''
  return compileManifest(value, expectedPublisher, 'source', issues)
}

function compileManifest(
  value: unknown,
  expectedPublisher: string,
  scope: PlatformModulePolicyScope,
  issues: PlatformModuleConformanceIssue[],
) {
  const expectedModuleId = isRecord(value) ? stringValue(value.id) : ''
  if (!expectedModuleId || !expectedPublisher) {
    issues.push(
      issue('MANIFEST_INVALID', scope, 'manifest/manifest.json', 'Manifest identity is invalid.'),
    )
    return
  }
  try {
    const compiled = compilePlatformModules(
      [{ declaration: value, expectedModuleId, expectedPublisherPackage: expectedPublisher }],
      platformModulePublisherAuthorities,
    )
    return readCompiledPlatformModules(compiled)[0]
  } catch {
    issues.push(
      issue(
        'MANIFEST_INVALID',
        scope,
        'manifest/manifest.json',
        'Manifest does not satisfy the public platform contract.',
      ),
    )
    return
  }
}

async function validateSourceRoot(
  manifest: PlatformModuleManifest,
  environment: PlatformModuleEnvironment,
  input: PlatformModuleRuntimeInput,
  baseDirectory: string,
  issues: PlatformModuleConformanceIssue[],
) {
  if (!input.sourceRoot) {
    return
  }
  const sourceRoot = resolveInputPath(baseDirectory, input.sourceRoot)
  const packageRoot = input.packageRoot
    ? resolveInputPath(baseDirectory, input.packageRoot)
    : dirname(sourceRoot)
  const packageManifest = await readDirectoryPackageManifest(
    packageRoot,
    environment,
    'source',
    issues,
  )
  if (!packageManifest) {
    return
  }
  const expectedName = manifest[environment].package
  issues.push(
    ...platformModulePackageManifestIssues({
      environment,
      expectedPackageName: expectedName,
      manifest: packageManifest,
      moduleId: manifest.id,
      path: `${environment}/package.json`,
      requireWorkspaceSpecifiers: false,
      scope: 'source',
    }),
  )
  const dependencies = runtimeDependencyNames(packageManifest)
  const files = await walkDirectory(
    sourceRoot,
    packageRoot,
    `${environment}/source`,
    'source',
    issues,
  )
  const packageFiles = new Set(
    files.map(({ logicalPath }) => logicalPath.slice(`${environment}/source/`.length)),
  )
  for (const file of files) {
    if (inspectableExtensions.has(extname(file.logicalPath))) {
      const sourceInput = {
        boundaryRoot: `${environment}/source`,
        environment,
        moduleId: manifest.id,
        path: file.logicalPath,
        scope: 'source',
        // oxlint-disable-next-line no-await-in-loop -- Preserve source diagnostic order.
        source: await readFile(file.absolutePath, 'utf8'),
      } as const
      issues.push(
        ...platformModuleSourceIssues(sourceInput, dependencies),
        ...platformModuleRelativeImportIssues(sourceInput, packageFiles),
      )
    }
  }
}

async function validateRuntimeArtifact(
  manifest: PlatformModuleManifest,
  environment: PlatformModuleEnvironment,
  packageManifest: PlatformModulePackageManifest,
  view: PackageView,
  allowLocalDependencySpecifiers: boolean,
  issues: PlatformModuleConformanceIssue[],
) {
  const expectedName = manifest[environment].package
  issues.push(
    ...platformModulePackageManifestIssues({
      allowLocalDependencySpecifiers,
      environment,
      expectedPackageName: expectedName,
      manifest: packageManifest,
      moduleId: manifest.id,
      path: `${environment}/package.json`,
      scope: 'artifact',
    }),
  )
  validatePackedFiles(packageManifest, view, environment, issues)
  const dependencies = runtimeDependencyNames(packageManifest)
  validateRuntimeRole(manifest, environment, dependencies, view.files, issues)
  for (const target of exportTargets(packageManifest.exports)) {
    if (!target.includes('*') && !view.files.includes(target))
      issues.push(
        issue(
          'PACKAGE_EXPORT_TARGET_MISSING',
          'artifact',
          `${environment}/${target}`,
          'Package export target is missing.',
        ),
      )
  }
  for (const path of view.files) {
    if (inspectableExtensions.has(extname(path))) {
      // oxlint-disable-next-line no-await-in-loop -- Preserve artifact diagnostic order.
      const source = await view.read(path)
      if (source !== undefined) {
        const sourceInput = {
          boundaryRoot: environment,
          environment,
          moduleId: manifest.id,
          path: `${environment}/${path}`,
          scope: 'artifact',
          source,
        } as const
        issues.push(
          ...platformModuleSourceIssues(sourceInput, dependencies),
          ...platformModuleRelativeImportIssues(sourceInput, new Set(view.files)),
        )
      }
    }
  }

  const rootEntry = resolveExportTarget(packageManifest.exports, '.')
  if (rootEntry) {
    const expectedExports =
      environment === 'server'
        ? [
            ...manifest.server.routes,
            ...manifest.server.persistenceOperations,
            ...manifest.server.resources,
            ...manifest.server.esiOperations,
            ...manifest.server.activityProviders,
          ].map(({ exportName }) => exportName)
        : ['default']
    const actual = await collectRuntimeExports(view, rootEntry, issues)
    const missing = expectedExports.filter((name) => !actual.has(name)).toSorted()
    const extra = [...actual].filter((name) => !expectedExports.includes(name)).toSorted()
    if (missing.length > 0 || extra.length > 0) {
      issues.push(
        issue(
          'EXECUTABLE_INVENTORY_MISMATCH',
          'artifact',
          `${environment}/${rootEntry}`,
          `Executable inventory differs (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}).`,
        ),
      )
    }
  }

  if (environment === 'server') {
    await validateMigrations(manifest, packageManifest, view, issues)
  } else {
    await validateNuxtInventory(manifest, packageManifest, view, issues)
  }
}

function validateRuntimeRole(
  manifest: PlatformModuleManifest,
  environment: PlatformModuleEnvironment,
  dependencies: ReadonlySet<string>,
  files: readonly string[],
  issues: PlatformModuleConformanceIssue[],
) {
  const oppositePackage = environment === 'server' ? manifest.nuxt.package : manifest.server.package
  if (dependencies.has(oppositePackage)) {
    issues.push(
      issue(
        'PACKAGE_ROLE_DEPENDENCY_CONTAMINATION',
        'artifact',
        `${environment}/package.json`,
        `${environment} package must not depend on its ${environment === 'server' ? 'Nuxt' : 'server'} package.`,
      ),
    )
  }

  const contaminated = files.filter((path) =>
    environment === 'server'
      ? path.endsWith('.vue')
      : path.startsWith('server/') || path.startsWith('migrations/'),
  )
  for (const path of contaminated) {
    issues.push(
      issue(
        'PACKAGE_ROLE_FILE_CONTAMINATION',
        'artifact',
        `${environment}/${path}`,
        `${environment} package contains a ${environment === 'server' ? 'Nuxt' : 'server'} artifact.`,
      ),
    )
  }
}

async function validateMigrations(
  manifest: PlatformModuleManifest,
  packageManifest: PlatformModulePackageManifest,
  view: PackageView,
  issues: PlatformModuleConformanceIssue[],
) {
  const expected = manifest.server.migrations.map(({ name }) => name).toSorted()
  const actual = view.files
    .filter((path) => path.startsWith('migrations/') && path.endsWith('.sql'))
    .map((path) => path.slice('migrations/'.length))
    .toSorted()
  if (!arraysEqual(expected, actual)) {
    issues.push(
      issue(
        'MIGRATION_INVENTORY_MISMATCH',
        'artifact',
        'server/migrations',
        `Migration inventory differs (missing: ${expected.filter((name) => !actual.includes(name)).join(', ') || 'none'}; extra: ${actual.filter((name) => !expected.includes(name)).join(', ') || 'none'}).`,
      ),
    )
  }
  const { schemaName } = modulePersistenceNames(manifest.id)
  await Promise.all(
    manifest.server.migrations.map(async (migration) => {
      const exportPath = `./migrations/${migration.name}`
      const target = resolveExportTarget(packageManifest.exports, exportPath)
      if (target !== `migrations/${migration.name}`) {
        issues.push(
          issue(
            'MIGRATION_EXPORT_INVALID',
            'artifact',
            `server/migrations/${migration.name}`,
            `Migration must be exported as ${exportPath}.`,
          ),
        )
      }
      const sql = await view.read(`migrations/${migration.name}`)
      if (sql === undefined) {
        return
      }
      const routines = manifest.server.persistenceOperations
        .filter((operation) => operation.migration === migration.name)
        .map((operation) => ({
          mode: operation.mode,
          operationId: operation.id,
          routineName: modulePersistenceRoutineName(operation.id),
        }))
      try {
        await assertModuleMigrationSql(
          manifest.id,
          schemaName,
          { name: migration.name, sql },
          routines,
        )
      } catch (error) {
        const category = error instanceof ModuleMigrationValidationError ? error.category : 'parse'
        issues.push(
          issue(
            `MIGRATION_${category.toUpperCase().replaceAll('-', '_')}`,
            'artifact',
            `server/migrations/${migration.name}`,
            `Migration SQL was rejected by the ${category} policy.`,
          ),
        )
      }
    }),
  )
}

async function validateNuxtInventory(
  manifest: PlatformModuleManifest,
  packageManifest: PlatformModulePackageManifest,
  view: PackageView,
  issues: PlatformModuleConformanceIssue[],
) {
  for (const page of manifest.nuxt.pages) {
    if (!view.files.includes(normalizePackagePath(page.file)))
      issues.push(
        issue(
          'NUXT_PAGE_MISSING',
          'artifact',
          `nuxt/${normalizePackagePath(page.file)}`,
          `Nuxt page ${page.id} is missing.`,
        ),
      )
  }
  const reviewerIssues = await Promise.all(
    (manifest.reviewerContributions ?? []).map(async (contribution) => {
      const contributionIssues: PlatformModuleConformanceIssue[] = []
      const target = resolveExportTarget(packageManifest.exports, contribution.panelExport)
      if (!target || !view.files.includes(target)) {
        contributionIssues.push(
          issue(
            'REVIEWER_PANEL_MISSING',
            'artifact',
            `nuxt/${contribution.panelExport}`,
            `Reviewer panel ${contribution.id} is missing or not exported.`,
          ),
        )
        return contributionIssues
      }
      if (extname(target) !== '.vue') {
        const exports = await collectRuntimeExports(view, target, contributionIssues)
        if (!exports.has('default')) {
          contributionIssues.push(
            issue(
              'REVIEWER_PANEL_DEFAULT_EXPORT_MISSING',
              'artifact',
              `nuxt/${target}`,
              `Reviewer panel ${contribution.id} must have a default component export.`,
            ),
          )
        }
      }
      return contributionIssues
    }),
  )
  issues.push(...reviewerIssues.flat())
}

function validateManifestPackage(
  manifest: PlatformModuleManifest,
  packageManifest: PlatformModulePackageManifest,
  exportPath: string,
  target: string,
  view: PackageView,
  issues: PlatformModuleConformanceIssue[],
) {
  if (packageManifest.name !== manifest.release.publisherPackage) {
    issues.push(
      issue(
        'PACKAGE_NAME_MISMATCH',
        'artifact',
        'manifest/package.json',
        'Manifest package name does not match publisher identity.',
      ),
    )
  }
  if (packageManifest.type !== 'module' || packageManifest.sideEffects !== false) {
    issues.push(
      issue(
        'MANIFEST_PACKAGE_POLICY_INVALID',
        'artifact',
        'manifest/package.json',
        'Manifest package must be side-effect-free ESM.',
      ),
    )
  }
  const targets = exportTargets(packageManifest.exports)
  if (targets.length !== 1 || resolveExportTarget(packageManifest.exports, exportPath) !== target) {
    issues.push(
      issue(
        'MANIFEST_EXPORT_INVALID',
        'artifact',
        'manifest/package.json',
        `Manifest package must export only ${exportPath}.`,
      ),
    )
  }
  if (
    !Array.isArray(packageManifest.files) ||
    packageManifest.files.length !== 1 ||
    normalizePackagePath(String(packageManifest.files[0])) !== target
  ) {
    issues.push(
      issue(
        'MANIFEST_FILES_INVALID',
        'artifact',
        'manifest/package.json',
        'Manifest package must publish only its canonical manifest.',
      ),
    )
  }
  validatePackedFiles(packageManifest, view, 'manifest', issues)
}

function validateReleaseAgreement(
  manifest: PlatformModuleManifest,
  manifestPackage: PlatformModulePackageManifest,
  serverPackage: PlatformModulePackageManifest,
  nuxtPackage: PlatformModulePackageManifest,
  issues: PlatformModuleConformanceIssue[],
) {
  for (const [kind, packageManifest] of [
    ['manifest', manifestPackage],
    ['server', serverPackage],
    ['nuxt', nuxtPackage],
  ] as const) {
    if (packageManifest.version !== manifest.release.version)
      issues.push(
        issue(
          'RELEASE_VERSION_MISMATCH',
          'artifact',
          `${kind}/package.json`,
          `Package version must equal release ${manifest.release.version}.`,
        ),
      )
  }
}

function validatePackedFiles(
  packageManifest: PlatformModulePackageManifest,
  view: PackageView,
  label: string,
  issues: PlatformModuleConformanceIssue[],
) {
  if (!view.packed) {
    return
  }
  const files = Array.isArray(packageManifest.files)
    ? packageManifest.files
        .filter((value): value is string => typeof value === 'string')
        .map(normalizePackagePath)
    : []
  for (const path of view.files) {
    if (sensitiveFileNames.has(path.split('/').at(-1) ?? '')) {
      issues.push(
        issue(
          'SENSITIVE_FILE_PACKED',
          'artifact',
          `${label}/${path}`,
          'Packed release contains a sensitive configuration file.',
        ),
      )
    }
    if (path === 'package.json') {
      continue
    }
    if (!files.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
      issues.push(
        issue(
          'PACKED_FILE_UNDECLARED',
          'artifact',
          `${label}/${path}`,
          'Packed file is outside the package files declaration.',
        ),
      )
    }
  }
}

interface PackageView {
  readonly files: readonly string[]
  readonly packed: boolean
  read(path: string): Promise<string | undefined>
}

async function openPackageView(
  input: PlatformModulePackageInput,
  label: string,
  baseDirectory: string,
  issues: PlatformModuleConformanceIssue[],
): Promise<PackageView | undefined> {
  if (!!input.packageRoot === !!input.archivePath) {
    issues.push(
      issue(
        'ARTIFACT_INPUT_INVALID',
        'input',
        label,
        'Specify exactly one packageRoot or archivePath.',
      ),
    )
    return undefined
  }
  return input.archivePath
    ? openArchiveView(resolveInputPath(baseDirectory, input.archivePath), label, issues)
    : openDirectoryView(resolveInputPath(baseDirectory, input.packageRoot!), label, issues)
}

async function openDirectoryView(
  root: string,
  label: string,
  issues: PlatformModuleConformanceIssue[],
): Promise<PackageView | undefined> {
  const files = await walkDirectory(root, root, label, 'artifact', issues)
  if (files.length === 0) {
    issues.push(
      issue('PACKAGE_ARTIFACT_MISSING', 'artifact', label, 'Package artifact is missing or empty.'),
    )
    return undefined
  }
  const allPaths = files.map(({ logicalPath }) => logicalPath.slice(label.length + 1)).toSorted()
  const packageFiles = await directoryPackageFiles(root, allPaths)
  const paths = allPaths.filter((path) => packageFiles.has(path))
  const absoluteByPath = new Map(
    files.map((file) => [file.logicalPath.slice(label.length + 1), file.absolutePath]),
  )
  return {
    files: paths,
    packed: false,
    async read(path) {
      const absolute = absoluteByPath.get(normalizePackagePath(path))
      return absolute ? readFile(absolute, 'utf8') : undefined
    },
  }
}

async function directoryPackageFiles(root: string, paths: readonly string[]) {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as unknown
  } catch {
    return new Set(paths)
  }
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return new Set(paths)
  }
  const declared = value.files.flatMap((entry) =>
    typeof entry === 'string' && isSafePackagePath(entry) ? [normalizePackagePath(entry)] : [],
  )
  return new Set(
    paths.filter(
      (path) =>
        path === 'package.json' ||
        declared.some((allowed) => path === allowed || path.startsWith(`${allowed}/`)),
    ),
  )
}

async function openArchiveView(
  archivePath: string,
  label: string,
  issues: PlatformModuleConformanceIssue[],
): Promise<PackageView | undefined> {
  const listed = runTar(['-tzf', archivePath])
  const verbose = runTar(['-tvzf', archivePath])
  if (!listed.ok || !verbose.ok) {
    issues.push(
      issue('ARCHIVE_READ_FAILED', 'artifact', label, 'Packed release archive could not be read.'),
    )
    return undefined
  }
  const entries = listed.output.split('\n').filter(Boolean)
  const unique = new Set<string>()
  let unsafe = entries.some(
    (entry) => !isSafeArchiveEntry(entry) || unique.has(entry) || (unique.add(entry), false),
  )
  unsafe ||= verbose.output
    .split('\n')
    .filter(Boolean)
    .some((line) => line[0] !== '-' && line[0] !== 'd')
  if (unsafe) {
    issues.push(
      issue(
        'ARCHIVE_ENTRY_UNSAFE',
        'artifact',
        label,
        'Packed release contains an unsafe, linked, or duplicate entry.',
      ),
    )
    return undefined
  }
  const files = entries
    .filter((entry) => !entry.endsWith('/'))
    .map((entry) => entry.slice('package/'.length))
    .toSorted()
  return {
    files,
    packed: true,
    async read(path) {
      const normalized = normalizePackagePath(path)
      if (!files.includes(normalized)) {
        return
      }
      const result = runTar(['-xOzf', archivePath, `package/${normalized}`])
      return result.ok ? result.output : undefined
    },
  }
}

function runTar(arguments_: readonly string[]) {
  const result = spawnSync('tar', arguments_, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { ok: result.status === 0 && !result.error, output: result.stdout || '' }
}

async function readPackageManifest(view: PackageView, issues: PlatformModuleConformanceIssue[]) {
  return readJsonFromView(view, 'package.json', 'package.json', issues) as Promise<
    PlatformModulePackageManifest | undefined
  >
}

async function readJsonFromView(
  view: PackageView,
  path: string,
  logicalPath: string,
  issues: PlatformModuleConformanceIssue[],
) {
  const source = await view.read(normalizePackagePath(path))
  if (source === undefined) {
    issues.push(
      issue('ARTIFACT_FILE_MISSING', 'artifact', logicalPath, 'Required artifact file is missing.'),
    )
    return
  }
  try {
    const value: unknown = JSON.parse(source)
    if (!isRecord(value)) {
      throw new TypeError('not an object')
    }
    return value
  } catch {
    issues.push(
      issue(
        'ARTIFACT_JSON_INVALID',
        'artifact',
        logicalPath,
        'Artifact must contain a JSON object.',
      ),
    )
    return
  }
}

async function readDirectoryPackageManifest(
  root: string,
  label: string,
  scope: PlatformModulePolicyScope,
  issues: PlatformModuleConformanceIssue[],
) {
  try {
    const value: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (isRecord(value)) {
      return value as PlatformModulePackageManifest
    }
  } catch {}
  issues.push(
    issue(
      'PACKAGE_JSON_INVALID',
      scope,
      `${label}/package.json`,
      'Package manifest is missing or invalid.',
    ),
  )
  return
}

interface WalkedFile {
  readonly absolutePath: string
  readonly logicalPath: string
}

async function walkDirectory(
  root: string,
  directory: string,
  logicalRoot: string,
  scope: PlatformModulePolicyScope,
  issues: PlatformModuleConformanceIssue[],
): Promise<WalkedFile[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const nestedFiles = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        if (entry.name === 'node_modules') {
          return []
        }
        const absolutePath = join(directory, entry.name)
        const logicalPath = `${logicalRoot}/${relative(root, absolutePath).replaceAll('\\', '/')}`
        const stats = await lstat(absolutePath)
        if (stats.isSymbolicLink()) {
          issues.push(
            issue(
              'SYMLINK_FORBIDDEN',
              scope,
              logicalPath,
              'Package inputs must not contain symbolic links.',
            ),
          )
          return []
        }
        if (stats.isDirectory()) {
          return walkDirectory(root, absolutePath, logicalRoot, scope, issues)
        }
        return stats.isFile() ? [{ absolutePath, logicalPath }] : []
      }),
  )
  return nestedFiles.flat()
}

async function collectRuntimeExports(
  view: PackageView,
  entry: string,
  issues: PlatformModuleConformanceIssue[],
  visited = new Set<string>(),
): Promise<Set<string>> {
  const path = normalizePackagePath(entry)
  if (visited.has(path)) {
    return new Set()
  }
  visited.add(path)
  const source = await view.read(path)
  if (source === undefined) {
    issues.push(
      issue('PACKAGE_EXPORT_TARGET_MISSING', 'artifact', path, 'Package export target is missing.'),
    )
    return new Set()
  }
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const names = new Set<string>()
  const reexportedNames = await collectReexportedNames(view, file, path, issues, visited)
  for (const exported of reexportedNames) {
    for (const name of exported) if (name !== 'default') names.add(name)
  }
  collectDeclaredExportNames(file, path, issues, names)
  return names
}

function collectReexportedNames(
  view: PackageView,
  file: ts.SourceFile,
  path: string,
  issues: PlatformModuleConformanceIssue[],
  visited: Set<string>,
) {
  return Promise.all(
    file.statements.flatMap((statement) => {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.exportClause ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith('.')
      ) {
        return []
      }
      const nested = resolveRelativeModule(path, statement.moduleSpecifier.text, view.files)
      return nested ? [collectRuntimeExports(view, nested, issues, visited)] : []
    }),
  )
}

function collectDeclaredExportNames(
  file: ts.SourceFile,
  path: string,
  issues: PlatformModuleConformanceIssue[],
  names: Set<string>,
) {
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      names.add('default')
    }
    if (
      ts.isExportDeclaration(statement) &&
      collectExportDeclaration(statement, path, issues, names)
    ) {
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (!modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      continue
    }
    if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add('default')
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text)
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
    }
  }
}

function collectExportDeclaration(
  statement: ts.ExportDeclaration,
  path: string,
  issues: PlatformModuleConformanceIssue[],
  names: Set<string>,
) {
  if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    for (const element of statement.exportClause.elements) {
      names.add(element.name.text)
    }
    return false
  }
  if (
    !statement.exportClause &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    !statement.moduleSpecifier.text.startsWith('.')
  ) {
    issues.push(
      issue(
        'PUBLIC_CONTRACT_SURFACE_INVALID',
        'artifact',
        path,
        'Package root must not re-export external package surfaces.',
      ),
    )
    return true
  }
  return false
}

function resolveRelativeModule(from: string, specifier: string, files: readonly string[]) {
  const candidate = normalizePackagePath(join(dirname(from), specifier))
  return [candidate, `${candidate}.js`, `${candidate}.mjs`, join(candidate, 'index.js')]
    .map(normalizePackagePath)
    .find((path) => files.includes(path))
}

function resolveExportTarget(exportsValue: unknown, exportPath: string): string | undefined {
  const raw = packageExportTarget(exportsValue, exportPath)
  if (!raw || !raw.startsWith('./') || raw.replaceAll('\\', '/').split('/').includes('..')) {
    return undefined
  }
  return normalizePackagePath(raw)
}

function packageExportTarget(value: unknown, exportPath: string): string | undefined {
  if (exportPath === '.' && (typeof value === 'string' || isConditionalExport(value))) {
    return conditionalTarget(value)
  }
  if (!isRecord(value)) {
    return undefined
  }
  const exact = conditionalTarget(value[exportPath])
  if (exact) {
    return exact
  }
  for (const [key, targetValue] of Object.entries(value)) {
    const marker = key.indexOf('*')
    if (
      marker < 0 ||
      !exportPath.startsWith(key.slice(0, marker)) ||
      !exportPath.endsWith(key.slice(marker + 1))
    ) {
      continue
    }
    const wildcard = exportPath.slice(marker, exportPath.length - key.slice(marker + 1).length)
    const target = conditionalTarget(targetValue)
    if (target?.includes('*')) {
      return target.replace('*', wildcard)
    }
  }
  return undefined
}

function conditionalTarget(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!isRecord(value)) {
    return undefined
  }
  return conditionalTarget(value.import) ?? conditionalTarget(value.default)
}

function isConditionalExport(value: unknown) {
  return isRecord(value) && Object.keys(value).every((key) => !key.startsWith('.'))
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') {
    return [normalizePackagePath(value)]
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.values(value).flatMap(exportTargets)
}

function isSafeArchiveEntry(entry: string) {
  if (
    !entry.startsWith('package/') ||
    entry.includes('\\') ||
    entry.includes('\0') ||
    isAbsolute(entry)
  ) {
    return false
  }
  const parts = entry.split('/')
  return !parts.includes('..') && !parts.includes('.')
}

function isSafePackagePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized !== '' &&
    !normalized.includes('\0') &&
    !isAbsolute(normalized) &&
    !normalized.split('/').some((part) => part === '..' || part === '.')
  )
}

function hasPackageArtifact(input: PlatformModulePackageInput) {
  return !!(input.packageRoot || input.archivePath)
}

function allowsLocalDependencySpecifiers(
  options: PlatformModuleArtifactVerificationOptions,
  environment: PlatformModuleEnvironment,
) {
  const allowance = options.allowLocalDependencySpecifiers
  return allowance === true || (typeof allowance === 'object' && allowance[environment] === true)
}

function resolveInputPath(baseDirectory: string, path: string) {
  return resolve(baseDirectory, path)
}

function normalizePackagePath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function report(
  source: boolean,
  artifact: boolean,
  issues: readonly PlatformModuleConformanceIssue[],
): PlatformModuleConformanceReport {
  const sorted = issues.toSorted((left, right) =>
    `${left.scope}\0${left.path}\0${left.code}\0${left.message}`.localeCompare(
      `${right.scope}\0${right.path}\0${right.code}\0${right.message}`,
    ),
  )
  return { checks: { artifact, source }, issues: sorted, ok: sorted.length === 0, version: 1 }
}

function issue(
  code: string,
  scope: PlatformModuleConformanceIssue['scope'],
  path: string,
  message: string,
): PlatformModuleConformanceIssue {
  return { code, message, path: path.replaceAll('\\', '/'), scope }
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
