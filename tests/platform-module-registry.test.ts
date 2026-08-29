import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PlatformModuleValidationError,
  validatePlatformModuleManifests,
  type PlatformModuleManifest,
} from '../packages/platform-module-contract/src/index'
import { definePlatformExecutableEsiOperation } from '../packages/platform-module-server/src/index'
import { coreModuleValidationAuthorities } from '../scripts/module-registry/authorities'
import { generateRegistryFiles } from '../scripts/module-registry/generator'
import { moduleServerImportViolations } from '../scripts/module-registry/server-boundaries'
import { loadFeatureServerSources } from '../scripts/module-registry/server-sources'
import { moduleNuxtBoundaryViolations } from '../scripts/module-registry/nuxt-boundaries'
import { moduleServerSourceExtensions } from '../scripts/module-registry/source-extensions.mjs'

describe('platform module declarations', () => {
  it('rejects Nuxt source that performs runtime or server work', () => {
    const violations = moduleNuxtBoundaryViolations([
      {
        moduleId: 'alpha',
        path: 'features/alpha/nuxt/src/module.ts',
        source: 'fetch("https://example.test")',
      },
      {
        moduleId: 'alpha',
        path: 'features/alpha/nuxt/src/runtime/app/composables/useAlpha.ts',
        source:
          "import { $fetch } from '#imports'\nawait import('node:fs/promises')\nawait import('drizzle-orm/node-postgres')\naddServerHandler({})",
      },
    ])

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must not call fetch'),
        expect.stringContaining('must not call addServerHandler'),
        expect.stringContaining('node:fs/promises'),
        expect.stringContaining('drizzle-orm/node-postgres'),
      ]),
    )
  })

  it('derives an executable operation contract from one SDK identity', async () => {
    const definition = definePlatformExecutableEsiOperation({
      sdkOperationId: 'GetStatus',
      policy: executableOperationPolicy(),
    })

    expect(definition.sdkOperationId).toBe('GetStatus')
    expect(definition.contract.audit).toEqual({
      esiOperationId: 'GetStatus',
      reviewedDate: '2026-08-18',
    })
    expect(definition.descriptor).toBeDefined()
    expect(() =>
      definePlatformExecutableEsiOperation({
        sdkOperationId: 'UnknownOperation' as never,
        policy: executableOperationPolicy(),
      }),
    ).toThrow('Unknown ESI SDK operation identity')
  })

  it('accepts and sorts valid environment-specific contributions', () => {
    const alpha = manifest('alpha')
    const beta = manifest('beta')

    expect(validatePlatformModuleManifests([beta, alpha], coreModuleValidationAuthorities)).toEqual(
      [alpha, beta],
    )
  })

  it.each([
    ['reserved module ID', () => manifest('core')],
    ['duplicate module ID', () => [manifest('alpha'), manifest('alpha')]],
    [
      'navigation ID',
      () => manifest('alpha', { navigation: { id: 'shared-navigation' } }),
      () => manifest('beta', { navigation: { id: 'shared-navigation' } }),
    ],
    [
      'resource ID',
      () => manifest('alpha', { resource: { id: 'shared-resource' } }),
      () => manifest('beta', { resource: { id: 'shared-resource' } }),
    ],
    [
      'ESI operation ID',
      () => manifest('alpha', { operation: { id: 'shared-operation' } }),
      () => manifest('beta', { operation: { id: 'shared-operation' } }),
    ],
    [
      'migration identity',
      () => {
        const declaration = manifest('alpha')
        declaration.server.migrations = [
          { name: 'alpha-001-initial.sql' },
          { name: 'alpha-001-initial.sql' },
        ]
        return declaration
      },
    ],
  ])('rejects a conflicting %s', (_name, first, second) => {
    const declarations = Array.isArray(first()) ? first() : [first(), ...(second ? [second()] : [])]
    expect(() =>
      validatePlatformModuleManifests(declarations, coreModuleValidationAuthorities),
    ).toThrow(PlatformModuleValidationError)
  })

  it('leaves page and exposed-import collisions to the resolved Nuxt graph', () => {
    const declaration = manifest('alpha', {
      exposed: { components: ['EveAlphaCard', 'EveAlphaCard'] },
    })
    declaration.nuxt.pages.push({ ...declaration.nuxt.pages[0]! })

    expect(() =>
      validatePlatformModuleManifests([declaration], coreModuleValidationAuthorities),
    ).not.toThrow()
  })

  it('rejects contribution page files that escape the feature runtime pages directory', () => {
    const invalid = manifest('alpha')
    invalid.nuxt.pages[0]!.file = 'src/runtime/app/pages/../../../../../app/pages/admin/index.vue'

    expect(validationErrorMessage(invalid)).toContain(
      'file must be a Vue file under src/runtime/app/pages',
    )
  })

  it('rejects migration, icon, authorization, and exposed-import violations together', () => {
    const invalid = manifest('alpha', {
      moduleIcon: 'unknown-default' as never,
      route: { authorization: 'module-admin' as never },
      migration: { name: '001.sql' },
      navigation: { icon: 'unknown' as never },
      exposed: { components: ['Button'] },
    })

    const message = validationErrorMessage(invalid)
    for (const fragment of [
      'must use alpha-*.sql',
      'uses invalid default icon unknown-default',
      'uses invalid icon unknown',
      'uses unsupported authorization module-admin',
      'must begin with EveAlpha',
    ])
      expect(message).toContain(fragment)
  })

  it('rejects server and Nuxt package identity mismatches', () => {
    const invalid = manifest('alpha')
    invalid.server.package = '@eve-space/wrong-server'
    invalid.nuxt.package = '@eve-space/wrong-nuxt'

    const message = validationErrorMessage(invalid)
    for (const fragment of [
      'server package must be @eve-space/alpha-server',
      'Nuxt package must be @eve-space/alpha-nuxt',
    ])
      expect(message).toContain(fragment)
  })

  it('rejects unsupported resource eligibility and scheduling metadata', () => {
    const invalid = manifest('alpha', {
      resource: {
        subjectKind: 'corporation' as never,
        materializationIntervalSeconds: 0,
        eligibility: { kind: 'module-callback' } as never,
      },
    })

    const message = validationErrorMessage(invalid)
    expect(message).toContain('uses unsupported initial subject kind corporation')
    expect(message).toContain('must use a positive whole interval')
    expect(message).toContain('uses unsupported eligibility module-callback')
  })

  it('validates and renders a pure batch resource descriptor', () => {
    const declaration = manifest('alpha')
    declaration.server.esiOperations.push({
      id: 'alpha-batch',
      exportName: 'alphaBatchOperation',
    })
    declaration.server.resources[0]!.batch = {
      mode: 'complete-observation',
      operationId: 'alpha-batch',
    }

    expect(() =>
      validatePlatformModuleManifests([declaration], coreModuleValidationAuthorities),
    ).not.toThrow()
    expect(
      generateRegistryFiles([declaration]).get(
        'api/src/generated/platform/installed-module-worker.ts',
      ),
    ).toContain(
      "operationId: 'alpha-operation', batch: { mode: 'complete-observation', operationId: 'alpha-batch' }, subjectKind: 'character'",
    )
  })

  it('rejects unknown batch operations and unsupported batch modes', () => {
    const declaration = manifest('alpha')
    declaration.server.resources[0]!.batch = {
      mode: 'delta' as never,
      operationId: 'missing-batch-operation',
    }

    const message = validationErrorMessage(declaration)
    expect(message).toContain('uses unsupported batch mode delta')
    expect(message).toContain('references unknown batch ESI operation missing-batch-operation')
  })

  it('rejects migration filenames with package URL metacharacters', () => {
    const invalid = manifest('alpha', { migration: { name: 'alpha-001?alias.sql' } })

    expect(validationErrorMessage(invalid)).toContain('must be a package-local filename')
  })

  it('rejects module IDs that exceed the PostgreSQL role-name boundary', () => {
    const id = `a${'b'.repeat(44)}`

    expect(validationErrorMessage(manifest(id))).toContain('must be at most 44 characters')
  })

  it('requires route namespaces to stay inside the module path segment', () => {
    const invalid = manifest('alpha', {
      route: { namespace: '/alphabet/characters/:characterId' },
    })

    expect(validationErrorMessage(invalid)).toContain(
      'namespace must be /alpha or begin with /alpha/',
    )
    expect(() =>
      validatePlatformModuleManifests(
        [
          manifest('alpha', {
            route: { namespace: '/alpha', authorization: 'authenticated-session' },
          }),
          manifest('beta', { route: { namespace: '/beta/characters/:characterId' } }),
        ],
        coreModuleValidationAuthorities,
      ),
    ).not.toThrow()
  })

  it('rejects Hono route namespaces that differ only by parameter name', () => {
    const invalid = manifest('alpha')
    invalid.server.routes = [
      {
        id: 'first-route',
        namespace: '/alpha/items/:id',
        exportName: 'firstRoutes',
        authorization: 'authenticated-session',
      },
      {
        id: 'second-route',
        namespace: '/alpha/items/:itemId',
        exportName: 'secondRoutes',
        authorization: 'authenticated-session',
      },
    ]

    expect(validationErrorMessage(invalid)).toContain(
      'module route coordinate /api/modules/alpha/items/:parameter conflicts between alpha and alpha',
    )
  })

  it('requires an exact characterId segment for owned-character authorization', () => {
    const invalid = manifest('alpha', {
      route: { namespace: '/alpha/characters/:characterIds' },
    })

    expect(validationErrorMessage(invalid)).toContain('must include :characterId in its namespace')
  })

  it.each([
    ['/alpha', '/alpha/characters/:characterId'],
    ['/alpha/:section', '/alpha/characters/:characterId'],
    ['/alpha/:section/settings', '/alpha/characters/:characterId'],
    ['/alpha/*', '/alpha/characters/:characterId'],
  ])('rejects intersecting route namespaces %s and %s before generation', (first, second) => {
    const invalid = manifest('alpha', {
      route: { namespace: first, authorization: 'authenticated-session' },
    })
    invalid.server.routes.push({
      id: 'owned-character-route',
      namespace: second,
      exportName: 'ownedCharacterRoutes',
      authorization: 'owned-character',
    })

    expect(() => generateRegistryFiles([invalid])).toThrow(
      `module route coordinates /api/modules${first} and /api/modules${second} overlap in module alpha`,
    )
  })

  it('allows disjoint authorization namespaces in one module', () => {
    const valid = manifest('alpha', {
      route: { namespace: '/alpha/profile', authorization: 'authenticated-session' },
    })
    valid.server.routes.push({
      id: 'owned-character-route',
      namespace: '/alpha/characters/:characterId',
      exportName: 'ownedCharacterRoutes',
      authorization: 'owned-character',
    })

    expect(() => generateRegistryFiles([valid])).not.toThrow()
  })
})

describe('platform module registry generation', () => {
  it('emits stable zero-feature registries', () => {
    const first = generateRegistryFiles([])
    const second = generateRegistryFiles([])

    expect([...first]).toEqual([...second])
    const routes = first.get('api/src/generated/platform/installed-module-routes.ts')
    expect(routes).toContain('export const installedModuleRoutes = new Hono()')
    expect(routes).not.toContain('requireInstalledModuleEnabled')
    expect(first.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'installedModuleResources =\n  [] as const satisfies readonly PlatformInstalledResourceDescriptor<PlatformResourceOperationImplementation>[]',
    )
    expect(first.get('api/src/generated/platform/installed-module-migrations.ts')).toContain(
      'installedModuleIds = [] as const',
    )
    expect(first.get('api/src/generated/platform/installed-module-esi.ts')).toContain(
      'installedModuleEsiOperationCatalog = {} as const satisfies Record<',
    )
    expect(first.get('api/src/generated/platform/installed-module-esi.ts')).toContain(
      'installedModuleEsiOperationDefinitions = {} as const satisfies Record<',
    )
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      '[] as const satisfies readonly PlatformInstalledModuleDefinition[]',
    )
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      "navigationId: 'core-character-skills'",
    )
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      "navigationId: 'core-character-mail'",
    )
    expect(first.get('generated/platform/installed-nuxt-modules.ts')).toContain(
      'installedNuxtModules = [] as const',
    )
  })

  it('sorts modules and navigation independently of input order', () => {
    const alpha = manifest('alpha', { navigation: { order: 20 } })
    const beta = manifest('beta', { navigation: { order: 10 } })

    expect([...generateRegistryFiles([alpha, beta])]).toEqual([
      ...generateRegistryFiles([beta, alpha]),
    ])
    const api = generateRegistryFiles([beta, alpha]).get(
      'api/src/generated/platform/installed-module-routes.ts',
    )
    expect(api?.indexOf("from '@eve-space/alpha-server'")).toBeLessThan(
      api?.indexOf("from '@eve-space/beta-server'") ?? -1,
    )
    expect(api).toContain("module0Route0Factory(createPlatformModuleRouteCapabilities('alpha'))")
    expect(api).toContain("platformModuleRouteComposers['owned-character']('alpha', module0Route0)")
    expect(api?.indexOf(".route(\n    '/alpha/characters/:characterId'")).toBeLessThan(
      api?.indexOf(".route(\n    '/beta/characters/:characterId'") ?? -1,
    )
    expect(api).not.toMatch(/forEach|reduce|for \(/)
    expect(
      generateRegistryFiles([beta, alpha]).get(
        'api/src/generated/platform/installed-module-migrations.ts',
      ),
    ).toContain("installedModuleIds = ['alpha', 'beta'] as const")
    expect(
      generateRegistryFiles([
        manifest('beta', { defaultEnabled: true }),
        manifest('alpha', { defaultEnabled: false }),
      ]).get('api/src/generated/platform/installed-module-runtime.ts'),
    ).toContain(
      "{ moduleId: 'alpha', defaultEnabled: false },\n  { moduleId: 'beta', defaultEnabled: true }",
    )
    expect(
      generateRegistryFiles([alpha]).get('generated/platform/installed-module-navigation.ts'),
    ).toContain("icon: 'character'")
  })

  it('wraps every contributed route in its owning module enablement guard', () => {
    const alpha = manifest('alpha')
    alpha.server.routes.push({
      id: 'alpha-summary',
      namespace: '/alpha/summary',
      exportName: 'alphaSummaryRoutes',
      authorization: 'authenticated-session',
    })

    const routes = generateRegistryFiles([alpha]).get(
      'api/src/generated/platform/installed-module-routes.ts',
    )

    expect(routes).toContain(
      "import { platformModuleRouteComposers } from '../../platform/module-route-composition.js'",
    )
    expect(routes).not.toContain(".use('*'")
    expectInOrder(routes, [
      "'/alpha/summary'",
      "platformModuleRouteComposers['authenticated-session']('alpha', module0Route1)",
    ])
  })

  it('aliases repeated package export names in every generated server registry', () => {
    const alpha = manifest('alpha', {
      route: { exportName: 'routes' },
      resource: { exportName: 'resource' },
      operation: { exportName: 'operation' },
    })
    const beta = manifest('beta', {
      route: { exportName: 'routes' },
      resource: { exportName: 'resource' },
      operation: { exportName: 'operation' },
    })
    const files = generateRegistryFiles([beta, alpha])

    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "import { routes as module0Route0Factory } from '@eve-space/alpha-server'",
    )
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "import { routes as module1Route0Factory } from '@eve-space/beta-server'",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "{ moduleId: 'alpha', resourceId: 'alpha-resource', operationId: 'alpha-operation', subjectKind: 'character', materializationIntervalSeconds: 900, eligibility: { kind: 'current-owned-character' }, implementation: module0Resource0 }",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "{ moduleId: 'beta', resourceId: 'beta-resource', operationId: 'beta-operation', subjectKind: 'character', materializationIntervalSeconds: 900, eligibility: { kind: 'current-owned-character' }, implementation: module1Resource0 }",
    )
    expect(files.get('api/src/generated/platform/installed-module-esi.ts')).toContain(
      "'alpha-operation': module0EsiOperation0.contract,\n  'beta-operation': module1EsiOperation0.contract,",
    )
    expect(files.get('api/src/generated/platform/installed-module-esi.ts')).toContain(
      'installedModuleEsiOperationCatalog = {',
    )
    expect(files.get('api/src/generated/platform/installed-module-esi.ts')).toContain(
      "installedModuleEsiSdkOperationIds = {\n  'alpha-operation': module0EsiOperation0.sdkOperationId,\n  'beta-operation': module1EsiOperation0.sdkOperationId,",
    )
  })
})

describe('feature server import boundaries', () => {
  it('allows package-local and shared platform imports', () => {
    expect(
      moduleServerImportViolations([
        {
          path: 'features/alpha/server/src/index.ts',
          source: `
            import type { OwnedCharacterCoreReads } from '@eve-space/platform-module-contract'
            export { loadSnapshot } from './snapshot.js'
          `,
        },
      ]),
    ).toEqual([])
  })

  it.each([
    ["import { sql } from '../../../../api/src/db/client.js'", '../../../../api/src/db/client.js'],
    [
      "export { findOwnedCharacter } from '../../../../api/src/auth/store.js'",
      '../../../../api/src/auth/store.js',
    ],
    [
      "const token = import('../../../../api/src/auth/tokens.js')",
      '../../../../api/src/auth/tokens.js',
    ],
    ["import routes from '@eve-space/api/routes/admin'", '@eve-space/api/routes/admin'],
  ])('rejects core API imports: %s', (source, specifier) => {
    expect(
      moduleServerImportViolations([{ path: 'features/alpha/server/src/index.ts', source }]),
    ).toEqual([
      `features/alpha/server/src/index.ts: feature server code cannot import core API source ${specifier}`,
    ])
  })

  it('discovers every permitted ESM server source extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-module-boundaries-'))
    const sourceDirectory = join(root, 'features', 'alpha', 'server', 'src')
    expect(moduleServerSourceExtensions).toEqual(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
    const extensions = moduleServerSourceExtensions.map((extension) => extension.slice(1))

    try {
      await mkdir(sourceDirectory, { recursive: true })
      await Promise.all(
        extensions.map((extension) =>
          writeFile(
            join(sourceDirectory, `forbidden.${extension}`),
            "import '@eve-space/api/db/client'",
          ),
        ),
      )
      await writeFile(join(sourceDirectory, 'ignored.json'), "import '@eve-space/api/db/client'")

      const sources = await loadFeatureServerSources(root)
      expect(
        sources.map(({ path }) => path).toSorted((left, right) => left.localeCompare(right)),
      ).toEqual(
        extensions
          .map((extension) => `features/alpha/server/src/forbidden.${extension}`)
          .toSorted((left, right) => left.localeCompare(right)),
      )
      expect(moduleServerImportViolations(sources)).toHaveLength(extensions.length)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

interface ManifestOverrides {
  defaultEnabled?: boolean
  moduleIcon?: PlatformModuleManifest['icon']
  route?: Partial<PlatformModuleManifest['server']['routes'][number]>
  migration?: Partial<PlatformModuleManifest['server']['migrations'][number]>
  resource?: Partial<PlatformModuleManifest['server']['resources'][number]>
  operation?: Partial<PlatformModuleManifest['server']['esiOperations'][number]>
  page?: Partial<PlatformModuleManifest['nuxt']['pages'][number]>
  navigation?: Partial<PlatformModuleManifest['nuxt']['navigation'][number]>
  exposed?: PlatformModuleManifest['nuxt']['exposed']
}

function manifest(id: string, overrides: ManifestOverrides = {}): PlatformModuleManifest {
  const pageName = overrides.page?.name ?? `eve-${id}-audit`
  const operationId = overrides.operation?.id ?? `${id}-operation`
  return {
    id,
    icon: overrides.moduleIcon ?? 'character',
    defaultEnabled: overrides.defaultEnabled ?? false,
    server: {
      package: `@eve-space/${id}-server`,
      routes: [
        {
          id: `${id}-route`,
          namespace: `/${id}/characters/:characterId`,
          exportName: `${camelCase(id)}Routes`,
          authorization: 'owned-character',
          ...overrides.route,
        },
      ],
      migrations: [{ name: `${id}-001-initial.sql`, ...overrides.migration }],
      resources: [
        {
          id: `${id}-resource`,
          operationId,
          subjectKind: 'character',
          materializationIntervalSeconds: 900,
          eligibility: { kind: 'current-owned-character' },
          exportName: `${camelCase(id)}Resource`,
          ...overrides.resource,
        },
      ],
      esiOperations: [
        {
          id: operationId,
          exportName: `${camelCase(id)}Operation`,
          ...overrides.operation,
        },
      ],
    },
    nuxt: {
      package: `@eve-space/${id}-nuxt`,
      pages: [
        {
          id: `${id}-page`,
          name: pageName,
          path: `/characters/:characterId/${id}`,
          file: `src/runtime/app/pages/${id}.vue`,
          extensionPoint: 'character-shell',
          audience: 'owned-character',
          ...overrides.page,
        },
      ],
      navigation: [
        {
          id: `${id}-navigation`,
          label: `${pascalCase(id)} audit`,
          description: `${pascalCase(id)} audit details`,
          to: `/characters/:characterId/${id}`,
          audience: 'owned-character',
          placement: 'character',
          order: 10,
          pageName,
          ...overrides.navigation,
        },
      ],
      exposed: overrides.exposed,
    },
  }
}

function executableOperationPolicy() {
  return {
    audit: { reviewedDate: '2026-08-18' },
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'ordered', fields: ['subjectId'] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: {
      kind: 'shared',
      collapse: true,
      revalidate: true,
      stale: { kind: 'none' },
      retentionMilliseconds: 60_000,
    },
    rateGroup: { kind: 'legacy-only' },
    retry: { kind: 'none' },
    compatibility: { minimumDate: '2026-01-01' },
    responseValidation: { kind: 'enabled' },
  } as const
}

function validationErrorMessage(moduleManifest: PlatformModuleManifest) {
  try {
    validatePlatformModuleManifests([moduleManifest], coreModuleValidationAuthorities)
    throw new Error('Expected validation to fail')
  } catch (error) {
    if (error instanceof PlatformModuleValidationError) return error.message
    throw error
  }
}

function expectInOrder(source: string | undefined, fragments: readonly string[]) {
  let previous = -1
  for (const fragment of fragments) {
    const position = source?.indexOf(fragment, previous + 1) ?? -1
    expect(position, `expected ${fragment} after position ${previous}`).toBeGreaterThan(previous)
    previous = position
  }
}

function camelCase(value: string) {
  const pascal = pascalCase(value)
  return `${pascal[0]?.toLowerCase() ?? ''}${pascal.slice(1)}`
}

function pascalCase(value: string) {
  return value
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')
}
