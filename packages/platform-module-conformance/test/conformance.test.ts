import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatPlatformModuleConformanceReport,
  runPlatformModuleConformance,
  verifyInstalledModuleArtifacts,
  type PlatformModuleConformanceInput,
} from '../src/conformance.js'
import {
  fixtureProvider,
  fixtureResource,
  fixtureRoutes,
  readFixtureOperation,
} from './fixtures/src/server.js'
import fixtureNuxtModule, { fixturePanel, fixturePanelModule } from './fixtures/src/nuxt.js'

const fixtureRoot = fileURLToPath(new URL('./fixtures/release', import.meta.url))
const temporaryRoots: string[] = []
const readFixture = async () => ({ value: 'public-contract' })

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('public conformance fixtures', () => {
  it('uses public route, resource, provider, and persistence contracts at runtime', async () => {
    const route = fixtureRoutes({ coreData: {}, logger: logger(), persistence: { readFixture } })
    const response = await route.request('/')
    const provider = fixtureProvider()

    expect(await response.json()).toStrictEqual({ value: 'public-contract' })
    expect(fixtureResource.operation).toBe('fixture-status')
    expect(readFixtureOperation.id).toBe('read-fixture')
    expect(fixturePanel.contributionId).toBe('fixture-review')
    expect(fixturePanelModule.default).toStrictEqual(expect.any(Function))
    expect(fixtureNuxtModule).toStrictEqual(expect.any(Function))
    await expect(
      provider({
        characters: [],
        organizationVersion: 1,
        requestedAt: '2026-09-18T00:00:00Z',
        signal: new AbortController().signal,
        userId: 'user',
      }),
    ).resolves.toMatchObject({ activities: [] })
  })

  it('reports source-only checks separately with logical deterministic paths', async () => {
    const report = await runPlatformModuleConformance(
      {
        manifest: { path: 'manifest/manifest.json' },
        nuxt: { sourceRoot: 'nuxt/dist' },
        server: { sourceRoot: 'server/dist' },
      },
      { baseDirectory: fixtureRoot },
    )

    expect(report.checks).toStrictEqual({ artifact: false, source: true })
    expect(report.issues.every(({ scope }) => scope === 'source')).toBe(true)
    expect(JSON.stringify(report)).not.toContain(fixtureRoot)
  })
})

describe('installed and packed artifact verification', () => {
  it('validates installed package directories and every orphan artifact', async () => {
    const report = await verifyInstalledModuleArtifacts(directoryInput(), {
      baseDirectory: fixtureRoot,
    })

    expect(report).toMatchObject({ checks: { artifact: true, source: false }, ok: true })

    const root = await copyFixture()
    await writeFile(
      join(root, 'server/dist/orphan.js'),
      "import { Client } from 'pg'\nimport { missing } from './missing.js'\nexport const orphanValue = new Client(missing)\n",
    )
    const invalid = await verifyInstalledModuleArtifacts(directoryInput(), { baseDirectory: root })

    expect(invalid.issues).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPORT_NOT_ALLOWED', path: 'server/dist/orphan.js' }),
        expect.objectContaining({
          code: 'RUNTIME_DEPENDENCY_UNDECLARED',
          path: 'server/dist/orphan.js',
        }),
        expect.objectContaining({ code: 'IMPORT_TARGET_MISSING', path: 'server/dist/orphan.js' }),
      ]),
    )
  })

  it('reports dependency, export, release, executable, migration, and Nuxt inventory defects', async () => {
    const root = await copyFixture()
    const serverPackagePath = join(root, 'server/package.json')
    const serverPackage = JSON.parse(await readFile(serverPackagePath, 'utf8'))
    serverPackage.version = '1.2.4'
    serverPackage.dependencies.postgres = '^3.4.9'
    serverPackage.exports['.'].types = './dist/missing.d.ts'
    await writeFile(serverPackagePath, JSON.stringify(serverPackage, null, 2))
    await writeFile(join(root, 'server/dist/index.js'), 'export const unexpected = true\n')
    await writeFile(
      join(root, 'server/migrations/fixture-001.sql'),
      'select * from public.secret_table;\n',
    )
    await writeFile(join(root, 'server/migrations/fixture-999.sql'), 'select 1;\n')
    await rm(join(root, 'nuxt/src/runtime/app/pages/FixturePage.vue'))

    const report = await verifyInstalledModuleArtifacts(directoryInput(), { baseDirectory: root })

    expect(report.issues).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEPENDENCY_NOT_ALLOWED' }),
        expect.objectContaining({ code: 'PACKAGE_EXPORT_TARGET_MISSING' }),
        expect.objectContaining({ code: 'RELEASE_VERSION_MISMATCH' }),
        expect.objectContaining({ code: 'EXECUTABLE_INVENTORY_MISMATCH' }),
        expect.objectContaining({ code: 'MIGRATION_INVENTORY_MISMATCH' }),
        expect.objectContaining({ code: 'MIGRATION_CROSS_SCHEMA' }),
        expect.objectContaining({ code: 'NUXT_PAGE_MISSING' }),
      ]),
    )
  })

  it('rejects collisions with core publisher authorities', async () => {
    const root = await copyFixture()
    const manifestPath = join(root, 'manifest/manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.server.esiOperations = [{ exportName: 'fixtureSkills', id: 'skills' }]
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const report = await verifyInstalledModuleArtifacts(directoryInput(), { baseDirectory: root })

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'MANIFEST_INVALID', path: 'manifest/manifest.json' }),
    )
  })

  it('rejects server and Nuxt package-role contamination', async () => {
    const root = await copyFixture()
    const serverPackagePath = join(root, 'server/package.json')
    const nuxtPackagePath = join(root, 'nuxt/package.json')
    const serverPackage = JSON.parse(await readFile(serverPackagePath, 'utf8'))
    const nuxtPackage = JSON.parse(await readFile(nuxtPackagePath, 'utf8'))
    serverPackage.dependencies['@example/fixture-nuxt'] = '^1.2.3'
    nuxtPackage.dependencies['@example/fixture-server'] = '^1.2.3'
    nuxtPackage.files.push('server', 'migrations')
    await writeFile(serverPackagePath, JSON.stringify(serverPackage, null, 2))
    await writeFile(nuxtPackagePath, JSON.stringify(nuxtPackage, null, 2))
    await writeFile(join(root, 'server/dist/Contaminated.vue'), '<template>server</template>\n')
    await mkdir(join(root, 'nuxt/server'), { recursive: true })
    await mkdir(join(root, 'nuxt/migrations'), { recursive: true })
    await writeFile(join(root, 'nuxt/server/handler.js'), 'export const handler = true\n')
    await writeFile(join(root, 'nuxt/migrations/contaminated.sql'), 'select 1;\n')

    const report = await verifyInstalledModuleArtifacts(directoryInput(), { baseDirectory: root })

    expect(
      report.issues.filter(({ code }) => code === 'PACKAGE_ROLE_DEPENDENCY_CONTAMINATION'),
    ).toHaveLength(2)
    expect(
      report.issues.filter(({ code }) => code === 'PACKAGE_ROLE_FILE_CONTAMINATION'),
    ).toStrictEqual([
      expect.objectContaining({ path: 'nuxt/migrations/contaminated.sql' }),
      expect.objectContaining({ path: 'nuxt/server/handler.js' }),
      expect.objectContaining({ path: 'server/dist/Contaminated.vue' }),
    ])
  })

  it.each(['workspace:*', 'catalog:', 'link:../contract', 'file:../contract.tgz', '   '])(
    'rejects non-publishable artifact dependency specifier %s',
    async (version) => {
      const root = await copyFixture()
      const serverPackagePath = join(root, 'server/package.json')
      const serverPackage = JSON.parse(await readFile(serverPackagePath, 'utf8'))
      serverPackage.dependencies['@eve-space/platform-module-contract'] = version
      await writeFile(serverPackagePath, JSON.stringify(serverPackage, null, 2))

      const report = await verifyInstalledModuleArtifacts(directoryInput(), { baseDirectory: root })

      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: version.trim() ? 'DEPENDENCY_VERSION_LOCAL' : 'DEPENDENCY_VERSION_INVALID',
          path: 'server/package.json',
        }),
      )
    },
  )

  it('reads packed releases without lifecycle execution and emits stable reports', async () => {
    const root = await copyFixture()
    const archives = await packFixture(root)
    const input = archiveInput(archives)
    const first = await verifyInstalledModuleArtifacts(input)
    const second = await verifyInstalledModuleArtifacts(input)

    expect(first.ok).toBe(true)
    expect(first).toStrictEqual(second)
    expect(formatPlatformModuleConformanceReport(first)).toBe(
      'Platform module conformance passed.\nChecks: source=not-run, artifact=run',
    )
    expect(JSON.stringify(first)).not.toContain(root)
  })

  it('rejects linked archive entries without exposing host paths', async () => {
    const root = await copyFixture()
    await symlink('/private/credential', join(root, 'server/dist/unsafe-link'))
    const archives = await packFixture(root)
    const report = await verifyInstalledModuleArtifacts(archiveInput(archives))
    const serialized = JSON.stringify(report)

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'ARCHIVE_ENTRY_UNSAFE', path: 'server' }),
    )
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain('/private/credential')
  })

  it('rejects unsupported special archive entries', async () => {
    const root = await copyFixture()
    const archives = await packFixture(root)
    const pipePath = join(root, 'staging-server/package/dist/unsafe-pipe')
    const fifo = spawnSync('mkfifo', [pipePath], { encoding: 'utf8' })
    if (fifo.status !== 0) {
      throw new Error('Could not create archive FIFO fixture')
    }
    const packed = spawnSync(
      'tar',
      ['-czf', archives.server, '-C', join(root, 'staging-server'), 'package'],
      { encoding: 'utf8' },
    )
    if (packed.status !== 0) {
      throw new Error('Could not repack archive FIFO fixture')
    }

    const report = await verifyInstalledModuleArtifacts(archiveInput(archives))

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'ARCHIVE_ENTRY_UNSAFE', path: 'server' }),
    )
  })

  it('rejects packed files outside the declared release surface', async () => {
    const root = await copyFixture()
    await writeFile(join(root, 'server/.npmrc'), '//registry.example.invalid/:_authToken=secret\n')
    const archives = await packFixture(root)
    const report = await verifyInstalledModuleArtifacts(archiveInput(archives))
    const serialized = JSON.stringify(report)

    expect(report.issues).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PACKED_FILE_UNDECLARED', path: 'server/.npmrc' }),
        expect.objectContaining({ code: 'SENSITIVE_FILE_PACKED', path: 'server/.npmrc' }),
      ]),
    )
    expect(serialized).not.toContain('secret')
  })
})

describe('conformance CLI', () => {
  it('uses stable success, conformance-failure, and configuration-failure statuses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-conformance-cli-'))
    temporaryRoots.push(root)
    const validConfig = join(root, 'valid.json')
    const invalidConfig = join(root, 'invalid.json')
    await writeFile(
      validConfig,
      JSON.stringify({
        manifest: { path: join(fixtureRoot, 'manifest/manifest.json') },
        nuxt: { sourceRoot: join(fixtureRoot, 'nuxt/dist') },
        server: { sourceRoot: join(fixtureRoot, 'server/dist') },
      }),
    )
    await writeFile(
      invalidConfig,
      JSON.stringify({
        manifest: { path: join(root, 'missing.json') },
        nuxt: { sourceRoot: join(fixtureRoot, 'nuxt/dist') },
        server: { sourceRoot: join(fixtureRoot, 'server/dist') },
      }),
    )

    const success = runCli(['--json', validConfig])
    const failure = runCli(['--json', invalidConfig])
    const configurationFailure = runCli([])

    expect(success.status).toBe(0)
    expect(JSON.parse(success.stdout)).toMatchObject({ ok: true, version: 1 })
    expect(failure.status).toBe(1)
    expect(JSON.parse(failure.stdout)).toMatchObject({ ok: false, version: 1 })
    expect(configurationFailure.status).toBe(2)
  })
})

function directoryInput(): PlatformModuleConformanceInput {
  return {
    manifest: { packageRoot: 'manifest' },
    nuxt: { packageRoot: 'nuxt' },
    server: { packageRoot: 'server' },
  }
}

function archiveInput(
  archives: Record<'manifest' | 'server' | 'nuxt', string>,
): PlatformModuleConformanceInput {
  return {
    manifest: { archivePath: archives.manifest },
    nuxt: { archivePath: archives.nuxt },
    server: { archivePath: archives.server },
  }
}

async function copyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eve-space-conformance-'))
  temporaryRoots.push(root)
  await cp(fixtureRoot, root, { recursive: true })
  return root
}

async function packFixture(root: string) {
  const archiveRoot = join(root, 'archives')
  await mkdir(archiveRoot)
  const archives = {} as Record<'manifest' | 'server' | 'nuxt', string>
  for (const kind of ['manifest', 'server', 'nuxt'] as const) {
    const staging = join(root, `staging-${kind}`)
    await mkdir(join(staging, 'package'), { recursive: true })
    await cp(join(root, kind), join(staging, 'package'), { recursive: true })
    const archive = join(archiveRoot, `${kind}.tgz`)
    const result = spawnSync('tar', ['-czf', archive, '-C', staging, 'package'], {
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(`Could not create ${kind} fixture archive`)
    }
    archives[kind] = archive
  }
  return archives
}

function logger() {
  return { error() {}, info() {}, warn() {} }
}

function runCli(arguments_: readonly string[]) {
  const bin = fileURLToPath(new URL('../bin/conformance.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [bin, ...arguments_], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout }
}
