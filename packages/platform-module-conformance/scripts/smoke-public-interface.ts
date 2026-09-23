import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const publicPackages = [
  'packages/esi-client',
  'packages/core-data-contract',
  'packages/core-eve-projections',
  'packages/platform-module-contract',
  'packages/platform-module-server',
  'packages/platform-module-nuxt',
  'packages/platform-module-persistence-policy',
  'packages/platform-module-conformance',
] as const

const temporaryRoot = await mkdtemp(join(tmpdir(), 'eve-space-public-interface-'))

try {
  const archiveRoot = join(temporaryRoot, 'archives')
  const consumerRoot = join(temporaryRoot, 'consumer')
  await Promise.all([mkdir(archiveRoot), mkdir(consumerRoot)])

  const archives = new Map(
    await Promise.all(
      publicPackages.map(async (packagePath) => {
        const packageRoot = join(repositoryRoot, packagePath)
        const packageJson = await readPackageJson(join(packageRoot, 'package.json'))
        requirePublicPackage(packageJson, packagePath, false)
        const packageArchiveRoot = join(archiveRoot, packagePath.replaceAll('/', '-'))
        await mkdir(packageArchiveRoot)
        const archive = await packPackage(packageRoot, packageArchiveRoot)
        requirePublicPackage(await readPackedPackageJson(archive), packagePath, true)
        return [packageJson.name, archive] as const
      }),
    ),
  )

  const rootPackageJson = await readPackageJson(join(repositoryRoot, 'package.json'))
  const registryDependencies = await resolveRegistryDependencies()
  const tarballDependencies = Object.fromEntries(
    [...archives].map(([name, archive]) => [name, `file:${relative(consumerRoot, archive)}`]),
  )
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'eve-space-public-interface-smoke',
        private: true,
        type: 'module',
        packageManager: rootPackageJson.packageManager,
        dependencies: { ...tarballDependencies, ...registryDependencies },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerRoot, 'pnpm-workspace.yaml'),
    `packages:\n  - .\noverrides:\n${Object.entries(tarballDependencies)
      .map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`)
      .join('\n')}\n`,
  )

  await runPackageManager(
    [
      'install',
      '--ignore-scripts',
      '--no-frozen-lockfile',
      '--package-import-method=copy',
      '--reporter=append-only',
    ],
    consumerRoot,
  )
  await verifyInstalledPackages(consumerRoot, archives.keys())
  await writeConsumerFixture(consumerRoot)
  await runPackageManager(['exec', 'tsc6', '--project', 'tsconfig.json'], consumerRoot)
  await runCommand(process.execPath, ['runtime-smoke.mjs'], consumerRoot)
  await runInstalledConformance(consumerRoot)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

interface PackageJson {
  readonly name: string
  readonly version: string
  readonly private?: boolean
  readonly packageManager?: string
  readonly publishConfig?: { readonly access?: string }
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

async function readPackageJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function requirePublicPackage(packageJson: PackageJson, packagePath: string, packed: boolean) {
  if (packageJson.private === true)
    throw new Error(`${packagePath} remains private and cannot be published`)
  if (packageJson.publishConfig?.access !== 'public')
    throw new Error(`${packagePath} must publish with public access`)
  if (!packed) return
  for (const dependencies of [
    packageJson.dependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ])
    for (const [name, specifier] of Object.entries(dependencies ?? {}))
      if (/^(?:catalog:|file:|link:|workspace:)/u.test(specifier))
        throw new Error(`${packagePath} packs non-publishable dependency ${name}@${specifier}`)
}

async function packPackage(packageRoot: string, archiveRoot: string) {
  const before = new Set(await readdir(archiveRoot))
  await runPackageManager(
    ['--config.ignore-scripts=true', 'pack', '--pack-destination', archiveRoot],
    packageRoot,
  )
  const created = (await readdir(archiveRoot)).filter(
    (path) => path.endsWith('.tgz') && !before.has(path),
  )
  if (created.length !== 1)
    throw new Error(`Expected one package archive from ${packageRoot}, received ${created.length}`)
  return join(archiveRoot, created[0]!)
}

async function readPackedPackageJson(archive: string) {
  const { stdout } = await runCommand(
    'tar',
    ['-xOf', archive, 'package/package.json'],
    repositoryRoot,
  )
  return JSON.parse(stdout) as PackageJson
}

async function resolveRegistryDependencies() {
  const dependencyRoots = {
    '@nuxt/kit': 'packages/platform-module-nuxt',
    hono: 'packages/platform-module-server',
    vue: '.',
    zod: 'packages/platform-module-server',
  } as const
  const entries = await Promise.all(
    Object.entries(dependencyRoots).map(async ([name, packagePath]) => {
      const packageJson = await readPackageJson(
        join(repositoryRoot, packagePath, 'node_modules', ...name.split('/'), 'package.json'),
      )
      return [name, packageJson.version] as const
    }),
  )
  const typescript = await readPackageJson(
    join(
      repositoryRoot,
      'packages/platform-module-conformance/node_modules/typescript/package.json',
    ),
  )
  return Object.fromEntries([
    ...entries,
    ['typescript', `npm:${typescript.name}@${typescript.version}`],
  ])
}

async function verifyInstalledPackages(consumerRoot: string, packageNames: Iterable<string>) {
  const consumerPrefix = `${await realpath(resolve(consumerRoot))}${sep}`
  await Promise.all(
    [...packageNames].map(async (packageName) => {
      const installedRoot = await realpath(
        join(consumerRoot, 'node_modules', ...packageName.split('/')),
      )
      if (!`${installedRoot}${sep}`.startsWith(consumerPrefix))
        throw new Error(`${packageName} resolved outside the clean consumer project`)
    }),
  )
}

async function writeConsumerFixture(consumerRoot: string) {
  const sourceRoot = join(consumerRoot, 'src')
  await mkdir(sourceRoot)
  await writeFile(
    join(sourceRoot, 'server.ts'),
    `import type { PublishedTypeDetailsResult } from '@eve-space/core-data-contract'
import { projectAssetSnapshot } from '@eve-space/core-eve-projections/assets'
import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'

export const readOperation = definePlatformPersistenceOperation({
  id: 'read-smoke',
  method: 'readSmoke',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ id: z.string() }),
  outputSchema: z.strictObject({ value: z.string() }),
  maximumInputBytes: 128,
  maximumOutputBytes: 128,
})

const operations = { 'read-smoke': readOperation } as const
type Persistence = PlatformPersistenceMethodsFor<typeof operations, readonly ['read-smoke']>

export function smokeRoutes(capabilities: PlatformModuleRouteCapabilities<Persistence>) {
  return new Hono().get('/', async (context) =>
    context.json(await capabilities.persistence.readSmoke({ id: 'smoke' })),
  )
}

export const projectedAsset = projectAssetSnapshot({
  item_id: 1,
  type_id: 2,
  quantity: 3,
  is_singleton: false,
  location_id: 4,
  location_type: 'station',
  location_flag: 'Hangar',
})

export const typeDetails = undefined as PublishedTypeDetailsResult | undefined
`,
  )
  await writeFile(
    join(sourceRoot, 'resources.ts'),
    `import { platformCoreEsiOperationSdkIdentities } from '@eve-space/platform-module-contract/esi'
import {
  definePlatformBoundedCollectionResource,
  definePlatformSingleRequestResource,
  type PlatformBoundedCollectionResourceImplementation,
  type PlatformCharacterResourceSubject,
  type PlatformResourceImplementationForContract,
  type PlatformResourceOperationContract,
} from '@eve-space/platform-module-contract/resources'
import {
  definePlatformExecutableEsiOperation,
  type PlatformCoreEsiOperationProtocol,
  type PlatformEsiOperationProtocol,
  type PlatformExecutableEsiOperationProtocol,
} from '@eve-space/platform-module-server'

export const statusOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetStatus',
  policy: {
    audit: { reviewedDate: '2026-09-06' },
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'ordered', fields: [] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: { kind: 'none' },
    rateGroup: { kind: 'legacy-only' },
    retry: { kind: 'none' },
    compatibility: { minimumDate: '2026-09-01' },
    responseValidation: { kind: 'enabled' },
  },
})

type ModuleDefinitions = { readonly 'smoke-status': typeof statusOperation }
type StatusProtocol = PlatformExecutableEsiOperationProtocol<ModuleDefinitions, 'smoke-status'>
type CollectionProtocol = StatusProtocol & PlatformCoreEsiOperationProtocol<'universe-resolve-names'>
type HostIdentities = typeof platformCoreEsiOperationSdkIdentities & {
  readonly 'smoke-status': typeof statusOperation.sdkOperationId
}
type ExpectedCollectionProtocol = PlatformEsiOperationProtocol<
  HostIdentities,
  'smoke-status' | 'universe-resolve-names'
>

async function materialize() {}

export const statusResource = definePlatformSingleRequestResource<
  'smoke-status',
  StatusProtocol,
  number
>({
  mode: 'single-request',
  operation: 'smoke-status',
  request: () => ({}),
  map: ({ data }) => data.players,
  materialize,
})

export const collectionResource = definePlatformBoundedCollectionResource<
  'smoke-status',
  CollectionProtocol,
  string | null
>({
  mode: 'bounded-collection',
  operation: 'smoke-status',
  async collect(context) {
    const status = await context.operations['smoke-status']({})
    const names = await context.operations['universe-resolve-names']({
      body: [context.subject.characterId],
    })
    // @ts-expect-error collection capabilities expose no arbitrary operation dispatcher
    void context.execute
    // @ts-expect-error undeclared operations have no callable member
    void context.operations['wallet-balance']
    // @ts-expect-error operation inputs retain their reviewed SDK contract
    void context.operations['universe-resolve-names']({ body: ['one'] })
    return { complete: status.data.players >= 0, data: names.data[0]?.name ?? null }
  },
  materialize,
})

void (statusResource satisfies PlatformResourceImplementationForContract<
  typeof statusResource,
  'smoke-status',
  PlatformEsiOperationProtocol<HostIdentities, 'smoke-status'>,
  readonly [],
  object,
  object
>)
void (collectionResource satisfies PlatformResourceImplementationForContract<
  typeof collectionResource,
  'smoke-status',
  ExpectedCollectionProtocol,
  readonly [],
  object,
  object
>)
// @ts-expect-error a single-request resource cannot satisfy a declaration with dependents
void (statusResource satisfies PlatformResourceImplementationForContract<
  typeof statusResource,
  'smoke-status',
  ExpectedCollectionProtocol,
  readonly [],
  object,
  object
>)

declare const mislabeled: PlatformBoundedCollectionResourceImplementation<
  'smoke-status',
  StatusProtocol & {
    readonly 'universe-resolve-names': PlatformResourceOperationContract<
      { readonly body: string[] },
      unknown
    >
  },
  string | null,
  string,
  unknown,
  PlatformCharacterResourceSubject
>
// @ts-expect-error correct aliases with a wrong operation contract fail the exact constraint
void (mislabeled satisfies PlatformResourceImplementationForContract<
  typeof mislabeled,
  'smoke-status',
  ExpectedCollectionProtocol,
  readonly [],
  object,
  object
>)
`,
  )
  await writeFile(
    join(sourceRoot, 'nuxt.ts'),
    `import { defineNuxtModule } from '@nuxt/kit'
import type { PlatformReviewerNuxtContribution } from '@eve-space/platform-module-contract/nuxt'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'

export const contribution = {
  contributionId: 'smoke-review',
  routeId: 'smoke-review-route',
  routePath: '/api/modules/smoke/review/:userId',
  audience: 'hr',
  requiredPermission: 'smoke.review',
  target: 'managed-organization-account',
  panelExport: './reviewer/smoke',
  label: 'Smoke review',
  description: 'Clean project reviewer contribution',
  icon: 'overview',
  order: 10,
} satisfies PlatformReviewerNuxtContribution

export type ReviewerProps = PlatformReviewerPanelProps

export default defineNuxtModule({ meta: { name: '@example/smoke-nuxt' } })
`,
  )
  await writeFile(
    join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerRoot, 'runtime-smoke.mjs'),
    `import { projectAssetSnapshot } from '@eve-space/core-eve-projections/assets'
import { platformModuleHostContractVersion } from '@eve-space/platform-module-contract/manifest'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import platformNuxtModule from '@eve-space/platform-module-nuxt'
import { z } from 'zod'

const asset = projectAssetSnapshot({
  item_id: 1,
  type_id: 2,
  quantity: 3,
  is_singleton: false,
  location_id: 4,
  location_type: 'station',
  location_flag: 'Hangar',
})
const operation = definePlatformPersistenceOperation({
  id: 'runtime-smoke',
  method: 'runtimeSmoke',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({ ok: z.boolean() }),
  maximumInputBytes: 16,
  maximumOutputBytes: 16,
})
if (asset.itemId !== 1) throw new Error('Core projection package failed at runtime')
if (platformModuleHostContractVersion !== '1.0.0') throw new Error('Contract package failed at runtime')
if (operation.id !== 'runtime-smoke') throw new Error('Server package failed at runtime')
if (typeof platformNuxtModule !== 'function') throw new Error('Nuxt package failed at runtime')
`,
  )
}

async function runInstalledConformance(consumerRoot: string) {
  const releaseRoot = join(consumerRoot, 'release')
  await cp(
    join(repositoryRoot, 'packages/platform-module-conformance/test/fixtures/release'),
    releaseRoot,
    { recursive: true },
  )
  await writeFile(
    join(consumerRoot, 'conformance.json'),
    `${JSON.stringify(
      {
        manifest: { path: 'release/manifest/manifest.json' },
        server: { sourceRoot: 'release/server/dist' },
        nuxt: { sourceRoot: 'release/nuxt/dist' },
      },
      null,
      2,
    )}\n`,
  )
  const binary = join(
    consumerRoot,
    'node_modules/.bin',
    process.platform === 'win32'
      ? 'eve-space-module-conformance.cmd'
      : 'eve-space-module-conformance',
  )
  const { stdout } = await runCommand(binary, ['--json', 'conformance.json'], consumerRoot)
  const report = JSON.parse(stdout) as { readonly ok?: boolean; readonly version?: number }
  if (report.ok !== true || report.version !== 1)
    throw new Error('Installed conformance CLI did not accept the clean-project fixture')
}

async function runPackageManager(arguments_: readonly string[], cwd: string) {
  return runCommand(packageManager, arguments_, cwd)
}

async function runCommand(command: string, arguments_: readonly string[], cwd: string) {
  const environment = { ...process.env }
  delete environment.NODE_PATH
  try {
    return await executeFile(command, arguments_, {
      cwd,
      encoding: 'utf8',
      env: environment,
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(command),
    })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const details = error as Error & { readonly stdout?: string; readonly stderr?: string }
    throw new Error(
      `${command} ${arguments_.join(' ')} failed in ${cwd}\n${details.stdout ?? ''}${details.stderr ?? ''}`,
      { cause: error },
    )
  }
}
