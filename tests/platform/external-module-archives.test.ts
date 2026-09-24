import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  access,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyInstalledModuleArtifacts } from '@eve-space/platform-module-conformance'
import {
  generateRegistryFiles,
  loadInstalledModuleManifests,
} from '../../scripts/module-registry/generator'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// Synthetic hosts install with the package manager this repository supports, never a stale pin.
const packageManager = requiredPackageManager()
const moduleId = 'synthetic'
const version = '1.2.3'
const packageNames = {
  manifest: '@example/synthetic-manifest',
  nuxt: '@example/synthetic-nuxt',
  server: '@example/synthetic-server',
} as const
const packageRoles = ['manifest', 'server', 'nuxt'] as const

type PackageRole = (typeof packageRoles)[number]
type JsonRecord = Record<string, unknown>

interface PackedRelease {
  readonly archives: Readonly<Record<PackageRole, string>>
  readonly lifecycleMarker: string
  readonly roots: Readonly<Record<PackageRole, string>>
}

interface InstalledHost {
  readonly root: string
  readonly apiPackageName: string
  readonly lifecycleMarker: string
  readonly packages: Readonly<Record<PackageRole, string>>
}

let suiteRoot = ''
let baseRelease: PackedRelease

beforeAll(async () => {
  // Resolved so hosts sit on the same path pnpm resolves the workspace to; a symlinked
  // temporary directory reads as outside it and deploys are refused.
  suiteRoot = await realpath(await mkdtemp(join(tmpdir(), 'eve-space-external-archives-')))
  baseRelease = await createPackedRelease(join(suiteRoot, 'base-release'))
}, 120_000)

afterAll(async () => {
  if (suiteRoot) {
    await rm(suiteRoot, { force: true, recursive: true })
  }
})

describe.sequential('external module archives', () => {
  it('installs three non-workspace archives and composes path-free server and Nuxt registries', async () => {
    const host = await installHost(baseRelease, 'success')
    const registry = await loadInstalledModuleManifests(host.root)
    const files = generateRegistryFiles(
      registry.compiled,
      registry.persistenceRoutines,
      registry.releases,
    )
    const release = registry.releases[0]!
    const inventory = files.get('api/src/generated/platform/installed-module-inventory.ts') ?? ''
    const reviewerCatalog =
      files.get('api/src/generated/platform/installed-reviewer-contributions.ts') ?? ''
    const generatedOutput = [...files.values()].join('\n')
    const generatedBrowserOutput = [...files]
      .filter(([path]) => path.startsWith('generated/'))
      .map(([, source]) => source)
      .join('\n')
    const serverModule = (await import(pathToFileURL(release.packages.server.entryPath).href)) as {
      syntheticRoutes(): { readonly source: string }
    }
    const nuxtModule = (await import(pathToFileURL(release.packages.nuxt.entryPath).href)) as {
      readonly default: { readonly source: string }
    }

    expect(release).toMatchObject({
      moduleId,
      packages: {
        manifest: { name: packageNames.manifest, version, workspace: false },
        nuxt: { name: packageNames.nuxt, version, workspace: false },
        server: { name: packageNames.server, version, workspace: false },
      },
      publisherPackage: packageNames.manifest,
      version,
    })
    for (const artifact of Object.values(release.packages)) {
      expect(artifact.integrity).toMatch(/^sha512-/)
    }
    expect(serverModule.syntheticRoutes()).toStrictEqual({ source: 'external-server' })
    expect(nuxtModule.default).toBeTypeOf('function')
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      `from '${packageNames.server}'`,
    )
    expect(files.get('generated/platform/installed-nuxt-modules.ts')).toContain(
      `from '${packageNames.nuxt}'`,
    )
    expect(files.get('generated/platform/installed-nuxt-contributions.ts')).toContain(
      `"packageName": "${packageNames.nuxt}"`,
    )
    expect(reviewerCatalog).toContain(
      JSON.stringify(
        [
          {
            audience: 'hr',
            contributionId: 'overview',
            description: 'Review a synthetic managed member.',
            icon: 'overview',
            label: 'Synthetic overview',
            moduleId,
            order: 10,
            panelExport: './reviewer/overview',
            panelPackage: packageNames.nuxt,
            publisherPackage: packageNames.manifest,
            requiredPermission: 'synthetic.review',
            routeId: 'synthetic-route',
            routePath: '/api/modules/synthetic/accounts/:userId',
            target: 'managed-organization-account',
          },
        ],
        undefined,
        2,
      ),
    )
    expect(inventory).toContain(`"publisherPackage": "${packageNames.manifest}"`)
    expect(inventory).toContain('"integrity": "sha512-')
    expect(inventory).not.toContain(host.root)
    expect(inventory).not.toContain(suiteRoot)
    expect(inventory).not.toContain('.tgz')
    expect(reviewerCatalog).not.toContain(host.root)
    expect(reviewerCatalog).not.toContain(suiteRoot)
    expect(reviewerCatalog).not.toContain('.tgz')
    expect(generatedOutput).not.toMatch(/(?:_authToken|NPM_TOKEN|NODE_AUTH_TOKEN|\.npmrc)/)
    expect(generatedOutput).not.toContain('SYNTHETIC_LIFECYCLE_MARKER')
    expect(generatedBrowserOutput).not.toContain('integrity')
    expect(generatedBrowserOutput).not.toContain(packageNames.server)
    await expect(access(baseRelease.lifecycleMarker)).rejects.toThrow('ENOENT')
    await expect(access(host.lifecycleMarker)).rejects.toThrow('ENOENT')
  }, 120_000)

  it('deploys API and worker artifacts and builds Nuxt with an external panel', async () => {
    const host = await installHost(baseRelease, 'production')
    const deploymentRoot = join(host.root, 'production-api')
    runPnpm(
      host.root,
      [
        '--config.ignore-scripts=true',
        '--filter',
        host.apiPackageName,
        '--prod',
        'deploy',
        deploymentRoot,
      ],
      host.lifecycleMarker,
    )

    expect(runNode(deploymentRoot, 'dist/server.js')).toStrictEqual({
      artifact: 'api',
      migration: 'select 1;',
      source: 'external-server',
    })
    expect(runNode(deploymentRoot, 'dist/worker.js')).toStrictEqual({
      artifact: 'worker',
      migration: 'select 1;',
      source: 'external-server',
    })

    const nuxtApplication = join(host.root, 'nuxt-application')
    await writeFiles(nuxtApplication, {
      'app.vue': `<script setup lang="ts">
import SyntheticReviewerPanel from '${packageNames.nuxt}/reviewer/overview'
</script>

<template>
  <SyntheticReviewerPanel />
</template>
`,
      'nuxt.config.ts': `import syntheticModule from '${packageNames.nuxt}'

export default defineNuxtConfig({
  modules: [syntheticModule],
  typescript: { typeCheck: false },
})
`,
    })
    await mkdir(join(nuxtApplication, 'node_modules'), { recursive: true })
    await symlink(
      await realpath(join(repositoryRoot, 'node_modules/nuxt')),
      join(nuxtApplication, 'node_modules/nuxt'),
      'junction',
    )
    runNuxtBuild(nuxtApplication)

    expect(
      await directoryContainsText(
        join(nuxtApplication, '.output'),
        'Synthetic external reviewer panel',
      ),
    ).toBe(true)
    await expect(access(baseRelease.lifecycleMarker)).rejects.toThrow('ENOENT')
    await expect(access(host.lifecycleMarker)).rejects.toThrow('ENOENT')
  }, 180_000)

  it('rejects forbidden dependencies and imports from every inspectable orphan artifact', async () => {
    const host = await installHost(baseRelease, 'forbidden-imports')
    await updateJson(join(host.packages.server, 'package.json'), (packageJson) => {
      packageJson.devDependencies = { postgres: '^3.4.9' }
    })
    await updateJson(join(host.packages.nuxt, 'package.json'), (packageJson) => {
      packageJson.devDependencies = { postgres: '^3.4.9' }
    })
    await writeFile(
      join(host.packages.server, 'dist/orphan.js'),
      "import postgres from 'postgres'\nimport { missing } from './missing.js'\nexport const orphan = postgres(missing)\n",
    )
    await writeFile(
      join(host.packages.nuxt, 'dist/orphan.js'),
      "import postgres from 'postgres'\nexport const orphan = postgres\n",
    )

    const message = await rejectedHostMessage(host.root)
    expect(message).toContain('DEPENDENCY_NOT_ALLOWED')
    expect(message).toContain('IMPORT_NOT_ALLOWED')
    expect(message).toContain('RUNTIME_DEPENDENCY_UNDECLARED')
    expect(message).toContain('IMPORT_TARGET_MISSING')
    expect(message).toContain('server/dist/orphan.js')
    expect(message).toContain('nuxt/dist/orphan.js')
  }, 120_000)

  it.each([
    [
      'selection identity',
      async (host: InstalledHost) => {
        await writeInstalledSelection(host.root, 'forged-selection', packageNames.manifest)
      },
      'installed module forged-selection descriptor declares mismatched ID synthetic',
    ],
    [
      'module identity',
      async (host: InstalledHost) => {
        await updateManifest(host, (manifest) => {
          manifest.id = 'forged-module'
        })
      },
      'installed module synthetic descriptor declares mismatched ID forged-module',
    ],
    [
      'publisher identity',
      async (host: InstalledHost) => {
        await updateManifest(host, (manifest) => {
          objectField(manifest, 'release').publisherPackage = '@example/forged-manifest'
        })
      },
      'declares mismatched publisher package @example/forged-manifest',
    ],
    [
      'server identity',
      async (host: InstalledHost) => {
        await updateJson(join(host.packages.server, 'package.json'), (packageJson) => {
          packageJson.name = '@example/forged-server'
        })
      },
      'declares changed ownership @example/forged-server',
    ],
    [
      'Nuxt identity',
      async (host: InstalledHost) => {
        await updateJson(join(host.packages.nuxt, 'package.json'), (packageJson) => {
          packageJson.name = '@example/forged-nuxt'
        })
      },
      'declares changed ownership @example/forged-nuxt',
    ],
  ] as const)(
    'rejects forged %s from installed archive contents',
    async (label, mutate, expected) => {
      const host = await installHost(baseRelease, `forged-${label.replaceAll(' ', '-')}`)
      await mutate(host)

      expect(await rejectedHostMessage(host.root)).toContain(expected)
    },
    120_000,
  )

  it.each([
    [
      'manifest release version',
      async (host: InstalledHost) => {
        await updateManifest(host, (manifest) => {
          objectField(manifest, 'release').version = '1.2.4'
        })
      },
      `release 1.2.4 does not match ${packageNames.manifest}@${version}`,
    ],
    [
      'package version',
      async (host: InstalledHost) => {
        await updateJson(join(host.packages.server, 'package.json'), (packageJson) => {
          packageJson.version = '1.2.4'
        })
      },
      `Lockfile archive version for ${packageNames.server} does not match package version 1.2.4`,
    ],
  ] as const)(
    'rejects %s skew',
    async (label, mutate, expected) => {
      const host = await installHost(baseRelease, `version-${label.replaceAll(' ', '-')}`)
      await mutate(host)

      expect(await rejectedHostMessage(host.root)).toContain(expected)
    },
    120_000,
  )

  it.each([
    [
      'manifest export',
      async (host: InstalledHost) => {
        await updateJson(join(host.packages.manifest, 'package.json'), (packageJson) => {
          packageJson.exports = {}
        })
      },
      `does not export ./manifest`,
    ],
    [
      'server runtime',
      async (host: InstalledHost) => rm(join(host.packages.server, 'dist/index.js')),
      `Package ${packageNames.server} is missing root export`,
    ],
    [
      'Nuxt runtime',
      async (host: InstalledHost) => rm(join(host.packages.nuxt, 'dist/module.js')),
      `Package ${packageNames.nuxt} is missing root export`,
    ],
    [
      'migration',
      async (host: InstalledHost) => {
        await updateManifest(host, (manifest) => {
          objectField(manifest, 'server').migrations = [{ name: 'synthetic-missing.sql' }]
        })
      },
      `is missing migration synthetic-missing.sql`,
    ],
    [
      'Nuxt page',
      async (host: InstalledHost) =>
        rm(join(host.packages.nuxt, 'src/runtime/app/pages/SyntheticPage.vue')),
      `is missing Nuxt page synthetic-page`,
    ],
    [
      'reviewer panel',
      async (host: InstalledHost) => rm(join(host.packages.nuxt, 'dist/reviewer/overview.js')),
      'REVIEWER_PANEL_MISSING',
    ],
  ] as const)(
    'rejects a missing %s file',
    async (label, mutate, expected) => {
      const host = await installHost(baseRelease, `missing-${label.replaceAll(' ', '-')}`)
      await mutate(host)

      expect(await rejectedHostMessage(host.root)).toContain(expected)
    },
    120_000,
  )

  it('rejects conflicting reviewer declarations from an installed archive', async () => {
    const host = await installHost(baseRelease, 'conflicting-reviewer-declarations')
    await updateManifest(host, (manifest) => {
      const contributions = manifest.reviewerContributions
      if (!Array.isArray(contributions) || !isRecord(contributions[0])) {
        throw new Error('reviewerContributions must contain a declaration')
      }
      manifest.reviewerContributions = [contributions[0], { ...contributions[0], id: 'details' }]
    })

    const message = await rejectedHostMessage(host.root)
    expect(message).toContain('reviewer route link synthetic/synthetic-route conflicts')
    expect(message).toContain(
      'reviewer panel export @example/synthetic-nuxt:./reviewer/overview conflicts',
    )
    expect(message).toContain('reviewer contribution order 10 conflicts')
  }, 120_000)

  it('rejects a reviewer panel without a default component export', async () => {
    const host = await installHost(baseRelease, 'missing-reviewer-default-export')
    await writeFile(
      join(host.packages.nuxt, 'dist/reviewer/overview.js'),
      "export const syntheticPanel = { contributionId: 'overview' }\n",
    )

    expect(await rejectedHostMessage(host.root)).toContain('REVIEWER_PANEL_DEFAULT_EXPORT_MISSING')
  }, 120_000)

  it('rejects extra migration and executable inventory', async () => {
    const migrationHost = await installHost(baseRelease, 'extra-migration')
    await mkdir(join(migrationHost.packages.server, 'migrations'), { recursive: true })
    await writeFile(
      join(migrationHost.packages.server, 'migrations/synthetic-999.sql'),
      'select 1;\n',
    )

    expect(await rejectedHostMessage(migrationHost.root)).toContain(
      'migration artifacts differ from its manifest',
    )

    const executableHost = await installHost(baseRelease, 'extra-executable')
    await writeFile(
      join(executableHost.packages.server, 'dist/index.js'),
      "export function syntheticRoutes() { return { source: 'external-server' } }\nexport const undeclaredExecutable = true\n",
    )

    expect(await rejectedHostMessage(executableHost.root)).toContain(
      'server exports differ from its executable inventory',
    )
  }, 120_000)

  it('treats a stale publisher conformance report as inert after a defective artifact is repacked', async () => {
    const variantRoot = join(suiteRoot, 'stale-report-release')
    await cp(dirname(baseRelease.roots.manifest), variantRoot, { recursive: true })
    const roots = packageRoots(variantRoot)
    const priorReport = await verifyInstalledModuleArtifacts({
      manifest: { export: './manifest', packageRoot: roots.manifest },
      nuxt: { packageRoot: roots.nuxt },
      server: { packageRoot: roots.server },
    })
    expect(priorReport.ok).toBe(true)
    await writeFile(
      join(roots.server, 'dist/orphan.js'),
      "import postgres from 'postgres'\nexport const staleArtifactDefect = postgres\n",
    )
    const release = await packRelease(variantRoot, roots)
    const host = await installHost(release, 'stale-report')
    await writeFile(
      join(host.root, 'publisher-conformance-report.json'),
      `${JSON.stringify(priorReport, null, 2)}\n`,
    )

    const message = await rejectedHostMessage(host.root)
    expect(message).toContain('IMPORT_NOT_ALLOWED')
    expect(message).toContain('RUNTIME_DEPENDENCY_UNDECLARED')
    expect(message).not.toContain('publisher-conformance-report.json')
  }, 120_000)

  it('rejects server and Nuxt contamination in dependencies, imports, and inspectable files', async () => {
    const host = await installHost(baseRelease, 'role-contamination')
    await updateJson(join(host.packages.server, 'package.json'), (packageJson) => {
      packageJson.dependencies = { [packageNames.nuxt]: version }
    })
    await updateJson(join(host.packages.nuxt, 'package.json'), (packageJson) => {
      packageJson.dependencies = { [packageNames.server]: version }
      packageJson.files = ['dist', 'src/runtime/app', 'server', 'migrations']
    })
    await writeFile(
      join(host.packages.server, 'dist/orphan.js'),
      `import nuxtModule from '${packageNames.nuxt}'\nexport const serverContamination = nuxtModule\n`,
    )
    await writeFile(
      join(host.packages.server, 'dist/Contaminated.vue'),
      '<template>server</template>\n',
    )
    await writeFile(
      join(host.packages.nuxt, 'dist/orphan.js'),
      `import { syntheticRoutes } from '${packageNames.server}'\nexport const nuxtContamination = syntheticRoutes\n`,
    )
    await mkdir(join(host.packages.nuxt, 'server'), { recursive: true })
    await mkdir(join(host.packages.nuxt, 'migrations'), { recursive: true })
    await writeFile(join(host.packages.nuxt, 'server/handler.js'), 'export const handler = true\n')
    await writeFile(join(host.packages.nuxt, 'migrations/contaminated.sql'), 'select 1;\n')

    const message = await rejectedHostMessage(host.root)
    expect(message).toContain('PACKAGE_ROLE_DEPENDENCY_CONTAMINATION')
    expect(message.match(/PACKAGE_ROLE_DEPENDENCY_CONTAMINATION/g)).toHaveLength(2)
    expect(message.match(/PACKAGE_ROLE_FILE_CONTAMINATION/g)).toHaveLength(3)
    expect(message).toContain(`Import ${packageNames.nuxt} is not allowed for server module code.`)
    expect(message).toContain(`Import ${packageNames.server} is not allowed for nuxt module code.`)
    expect(message).toContain('server/dist/Contaminated.vue')
    expect(message).toContain('nuxt/server/handler.js')
    expect(message).toContain('nuxt/migrations/contaminated.sql')
  }, 120_000)
})

async function createPackedRelease(root: string) {
  const roots = packageRoots(root)
  const lifecycleScript =
    "node -e \"require('node:fs').writeFileSync(process.env.SYNTHETIC_LIFECYCLE_MARKER, 'ran')\""
  const scripts = {
    install: lifecycleScript,
    postpack: lifecycleScript,
    prepack: lifecycleScript,
    prepare: lifecycleScript,
  }
  const manifest = {
    defaultEnabled: false,
    icon: 'overview',
    id: moduleId,
    nuxt: {
      navigation: [
        {
          id: 'synthetic-navigation',
          label: 'Synthetic',
          description: 'Synthetic external module',
          to: '/synthetic',
          audience: 'authenticated',
          placement: 'dashboard',
          order: 90,
          pageName: 'eve-synthetic-page',
        },
      ],
      package: packageNames.nuxt,
      pages: [
        {
          id: 'synthetic-page',
          name: 'eve-synthetic-page',
          path: '/synthetic',
          file: 'src/runtime/app/pages/SyntheticPage.vue',
          extensionPoint: 'root',
          audience: 'authenticated',
        },
      ],
    },
    permissions: [
      {
        key: 'synthetic.review',
        label: 'Review synthetic records',
        purpose: 'Review one synthetic managed member.',
        audiences: ['hr'],
        sensitivity: 'sensitive',
        reviewAllowed: false,
      },
    ],
    release: {
      hostContractRange: '^1.0.0',
      publisherPackage: packageNames.manifest,
      version,
    },
    reviewerContributions: [
      {
        id: 'overview',
        routeId: 'synthetic-route',
        audience: 'hr',
        requiredPermission: 'synthetic.review',
        target: 'managed-organization-account',
        panelExport: './reviewer/overview',
        label: 'Synthetic overview',
        description: 'Review a synthetic managed member.',
        icon: 'overview',
        order: 10,
      },
    ],
    server: {
      activityProviders: [],
      esiOperations: [],
      migrations: [{ name: 'synthetic-001.sql' }],
      package: packageNames.server,
      persistenceOperations: [],
      resources: [],
      routes: [
        {
          id: 'synthetic-route',
          namespace: '/synthetic/accounts/:userId',
          exportName: 'syntheticRoutes',
          authorization: 'authenticated-session',
          audience: 'hr',
          requiredPermission: 'synthetic.review',
          target: 'managed-organization-account',
          exposure: 'standard',
          persistenceOperations: [],
        },
      ],
    },
  }

  await writeFiles(roots.manifest, {
    'manifest.json': json(manifest),
    'package.json': json({
      name: packageNames.manifest,
      version,
      packageManager,
      type: 'module',
      sideEffects: false,
      exports: { './manifest': './manifest.json' },
      files: ['manifest.json'],
      scripts,
    }),
  })
  await writeFiles(roots.server, {
    'dist/index.d.ts':
      "export declare function syntheticRoutes(): { readonly source: 'external-server' }\n",
    'dist/index.js': "export function syntheticRoutes() { return { source: 'external-server' } }\n",
    'migrations/synthetic-001.sql': 'select 1;\n',
    'package.json': json({
      name: packageNames.server,
      version,
      packageManager,
      type: 'module',
      sideEffects: false,
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './migrations/*': './migrations/*',
      },
      files: ['dist', 'migrations'],
      scripts,
    }),
  })
  await writeFiles(roots.nuxt, {
    'dist/module.d.ts': 'export default function syntheticNuxtModule(): void\n',
    'dist/module.js': 'export default function () {}\n',
    'dist/reviewer/overview.js':
      "export default { name: 'SyntheticReviewerPanel', render() { return 'Synthetic external reviewer panel' } }\nexport const syntheticPanel = { contributionId: 'overview' }\n",
    'package.json': json({
      name: packageNames.nuxt,
      version,
      packageManager,
      type: 'module',
      sideEffects: ['**/*.vue'],
      exports: {
        '.': { types: './dist/module.d.ts', import: './dist/module.js' },
        './reviewer/overview': './dist/reviewer/overview.js',
      },
      files: ['dist', 'src/runtime/app'],
      scripts,
    }),
    'src/runtime/app/pages/SyntheticPage.vue':
      '<template><main><h1>Synthetic external module</h1></main></template>\n',
  })
  return packRelease(root, roots)
}

async function packRelease(
  root: string,
  roots: Readonly<Record<PackageRole, string>>,
): Promise<PackedRelease> {
  const archiveRoot = join(root, 'archives')
  const lifecycleMarker = join(root, 'pack-lifecycle-ran')
  await mkdir(archiveRoot, { recursive: true })
  const archives = {} as Record<PackageRole, string>
  for (const role of packageRoles) {
    const destination = join(archiveRoot, role)
    await mkdir(destination, { recursive: true })
    runPnpm(
      roots[role],
      [
        '--config.ignore-scripts=true',
        'pack',
        '--skip-manifest-obfuscation',
        '--pack-destination',
        destination,
      ],
      lifecycleMarker,
    )
    const packed = (await readdir(destination)).filter((path) => path.endsWith('.tgz'))
    if (packed.length !== 1) {
      throw new Error(`Expected one packed ${role} archive`)
    }
    archives[role] = join(destination, packed[0]!)
  }
  return { archives, lifecycleMarker, roots }
}

async function installHost(release: PackedRelease, name: string): Promise<InstalledHost> {
  const root = join(suiteRoot, 'hosts', name)
  const archiveRoot = join(root, 'archives')
  const lifecycleMarker = join(root, 'lifecycle-ran')
  const apiPackageName = `external-module-api-${name}`
  await mkdir(join(root, 'api'), { recursive: true })
  await mkdir(join(root, 'features'), { recursive: true })
  await mkdir(archiveRoot, { recursive: true })
  for (const role of packageRoles) {
    await copyFile(release.archives[role], join(archiveRoot, `${role}.tgz`))
  }
  await writeFile(
    join(root, 'package.json'),
    json({
      dependencies: {
        [packageNames.manifest]: `file:${join(archiveRoot, 'manifest.tgz')}`,
        [packageNames.nuxt]: `file:${join(archiveRoot, 'nuxt.tgz')}`,
      },
      name: `external-module-host-${name}`,
      packageManager,
      private: true,
    }),
  )
  await writeFile(
    join(root, 'api/package.json'),
    json({
      dependencies: { [packageNames.server]: `file:${join(archiveRoot, 'server.tgz')}` },
      name: apiPackageName,
      private: true,
      scripts: {
        start: 'node dist/server.js',
        'start:worker': 'node dist/worker.js',
      },
      type: 'module',
    }),
  )
  const productionArtifact = (
    artifact: 'api' | 'worker',
  ) => `import { readFile } from 'node:fs/promises'
import { syntheticRoutes } from '${packageNames.server}'

const migration = await readFile(new URL(import.meta.resolve('${packageNames.server}/migrations/synthetic-001.sql')), 'utf8')
console.log(JSON.stringify({ artifact: '${artifact}', migration: migration.trim(), source: syntheticRoutes().source }))
`
  await writeFiles(join(root, 'api/dist'), {
    'server.js': productionArtifact('api'),
    'worker.js': productionArtifact('worker'),
  })
  await writeFile(
    join(root, 'pnpm-workspace.yaml'),
    // `pmOnFail: ignore` mirrors the repository and keeps the env document out of the lockfile.
    "packages:\n  - 'api'\npmOnFail: ignore\n",
  )
  await writeInstalledSelection(root, moduleId, packageNames.manifest)
  runPnpm(
    root,
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-frozen-lockfile',
      '--package-import-method=copy',
      '--reporter=silent',
      '--store-dir',
      join(suiteRoot, 'pnpm-store'),
    ],
    lifecycleMarker,
  )
  return {
    apiPackageName,
    lifecycleMarker,
    packages: {
      manifest: await realpath(join(root, 'node_modules', ...packageNames.manifest.split('/'))),
      nuxt: await realpath(join(root, 'node_modules', ...packageNames.nuxt.split('/'))),
      server: await realpath(join(root, 'api/node_modules', ...packageNames.server.split('/'))),
    },
    root,
  }
}

async function writeInstalledSelection(root: string, selectedId: string, publisherPackage: string) {
  await writeFile(
    join(root, 'features/installed-modules.json'),
    json({
      modules: [
        {
          manifest: { export: './manifest', package: publisherPackage },
          moduleId: selectedId,
        },
      ],
    }),
  )
}

async function updateManifest(host: InstalledHost, mutate: (manifest: JsonRecord) => void) {
  await updateJson(join(host.packages.manifest, 'manifest.json'), mutate)
}

async function updateJson(path: string, mutate: (value: JsonRecord) => void) {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isRecord(value)) {
    throw new Error(`${path} must contain an object`)
  }
  mutate(value)
  await writeFile(path, json(value))
}

async function rejectedHostMessage(root: string) {
  try {
    await loadInstalledModuleManifests(root)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(root) || message.includes(suiteRoot)) {
      throw new Error('Host validation failure exposed a temporary filesystem path', {
        cause: error,
      })
    }
    return message
  }
  throw new Error('Expected installed module host validation to fail')
}

function requiredPackageManager(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  if (!isRecord(manifest) || typeof manifest.packageManager !== 'string') {
    throw new Error('The repository manifest must declare a packageManager')
  }
  return manifest.packageManager
}

function packageRoots(root: string): Record<PackageRole, string> {
  return {
    manifest: join(root, 'manifest'),
    nuxt: join(root, 'nuxt'),
    server: join(root, 'server'),
  }
}

async function writeFiles(root: string, files: Readonly<Record<string, string>>) {
  await Promise.all(
    Object.entries(files).map(async ([path, source]) => {
      const output = join(root, path)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, source)
    }),
  )
}

function runPnpm(cwd: string, arguments_: readonly string[], lifecycleMarker: string) {
  const result = spawnSync('corepack', ['pnpm', ...arguments_], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      SYNTHETIC_LIFECYCLE_MARKER: lifecycleMarker,
    },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0 || result.error) {
    throw new Error(
      `pnpm ${arguments_[0] ?? 'command'} failed: ${result.stderr || result.stdout || result.error?.message || 'unknown error'}`,
    )
  }
}

function runNode(cwd: string, path: string) {
  const result = spawnSync(process.execPath, [path], { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'node failed')
  }
  return JSON.parse(result.stdout.trim()) as unknown
}

function runNuxtBuild(root: string) {
  const result = spawnSync(join(repositoryRoot, 'node_modules/.bin/nuxt'), ['build', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1' },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'Nuxt build failed')
  }
}

async function directoryContainsText(root: string, expected: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory() && (await directoryContainsText(path, expected))) {
      return true
    }
    if (entry.isFile() && (await readFile(path, 'utf8')).includes(expected)) {
      return true
    }
  }
  return false
}

function objectField(value: JsonRecord, key: string) {
  const nested = value[key]
  if (!isRecord(nested)) {
    throw new Error(`${key} must contain an object`)
  }
  return nested
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
