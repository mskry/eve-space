import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PlatformModuleValidationError,
  validatePlatformModuleManifests,
  type PlatformModuleManifest,
} from '../../packages/platform-module-contract/src/index'
import { definePlatformExecutableEsiOperation } from '../../packages/platform-module-server/src/index'
import { canonicalizePersistenceRoutineSql } from '../../api/src/db/module-persistence-routine'
import { coreModuleValidationAuthorities } from '../../scripts/module-registry/authorities'
import { generateRegistryFiles } from '../../scripts/module-registry/generator'
import { moduleServerImportViolations } from '../../scripts/module-registry/server-boundaries'
import { loadFeatureServerSources } from '../../scripts/module-registry/server-sources'
import { moduleNuxtBoundaryViolations } from '../../scripts/module-registry/nuxt-boundaries'
import { moduleServerSourceExtensions } from '../../scripts/module-registry/source-extensions.mjs'

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

  it('accepts module-local persistence operations with phase-compatible grants', () => {
    const readDeclaration = manifest('alpha', { persistenceOperation: {} })
    const writeDeclaration = manifest('beta', {
      persistenceOperation: {
        id: 'save-snapshot',
        method: 'saveSnapshot',
        mode: 'write',
        exportName: 'saveSnapshotOperation',
      },
    })
    writeDeclaration.server.routes[0]!.persistenceOperations = []
    writeDeclaration.server.activityProviders[0]!.persistenceOperations = []
    writeDeclaration.server.resources[0]!.persistence = {
      projection: [],
      materialization: [{ operationId: 'save-snapshot' }],
    }

    expect(() =>
      validatePlatformModuleManifests(
        [writeDeclaration, readDeclaration],
        coreModuleValidationAuthorities,
      ),
    ).not.toThrow()
  })

  it('rejects invalid persistence identities, metadata, migration links, and unused definitions', () => {
    const invalid = manifest('alpha', {
      persistenceOperation: {
        id: 'ReadSnapshot',
        method: 'read-snapshot',
        revision: 0,
        mode: 'execute' as never,
        exportName: 'read-snapshot',
        migration: 'alpha-999-missing.sql',
      },
    })
    invalid.server.routes[0]!.persistenceOperations = []
    invalid.server.activityProviders[0]!.persistenceOperations = []
    invalid.server.resources[0]!.persistence = { projection: [], materialization: [] }
    invalid.server.persistenceOperations.push({ ...invalid.server.persistenceOperations[0]! })

    const message = validationErrorMessage(invalid)
    for (const fragment of [
      'must use a bounded lowercase kebab-case ID',
      'is not a valid JavaScript export name',
      'must use a positive whole revision',
      'uses unsupported mode execute',
      'references undeclared migration alpha-999-missing.sql',
    ])
      expect(message).toContain(fragment)
  })

  it('rejects duplicate operation IDs and unused definitions', () => {
    const invalid = manifest('alpha', { persistenceOperation: {} })
    invalid.server.routes[0]!.persistenceOperations = []
    invalid.server.activityProviders[0]!.persistenceOperations = []
    invalid.server.resources[0]!.persistence = { projection: [], materialization: [] }
    invalid.server.persistenceOperations.push({ ...invalid.server.persistenceOperations[0]! })

    const message = validationErrorMessage(invalid)
    expect(message).toContain('persistence operation ID alpha-read is duplicated in alpha')
    expect(message).toContain(
      'persistence operation alpha/alpha-read is not granted to a contribution',
    )
  })

  it('rejects duplicate, unknown, cross-module, and mode-incompatible persistence grants', () => {
    const alpha = manifest('alpha', { persistenceOperation: {} })
    const beta = manifest('beta', {
      persistenceOperation: {
        id: 'save-snapshot',
        method: 'saveSnapshot',
        mode: 'write',
        exportName: 'saveSnapshotOperation',
      },
    })
    alpha.server.routes[0]!.persistenceOperations = [
      { operationId: 'alpha-read' },
      { operationId: 'alpha-read' },
      { operationId: 'save-snapshot' },
      { operationId: 'missing-operation' },
    ]
    beta.server.activityProviders[0]!.persistenceOperations = [{ operationId: 'save-snapshot' }]
    beta.server.resources[0]!.persistence = {
      projection: [{ operationId: 'save-snapshot' }],
      materialization: [{ operationId: 'save-snapshot' }],
    }

    const message = validationErrorMessage([alpha, beta])
    expect(message).toContain('declares duplicate persistence operation alpha-read')
    expect(message).toContain(
      'references cross-module persistence operation save-snapshot owned by beta',
    )
    expect(message).toContain('references unknown persistence operation missing-operation')
    expect(message).toContain(
      'activity provider beta/beta-activity cannot use write persistence operation save-snapshot; expected read',
    )
    expect(message).toContain(
      'resource projection beta/beta-resource cannot use write persistence operation save-snapshot; expected read',
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

  it('requires organization authorization metadata on every server contribution', () => {
    const invalid = manifest('alpha')
    invalid.server.routes[0]!.audience = undefined as never
    invalid.server.routes[0]!.requiredPermission = undefined as never
    invalid.server.activityProviders[0]!.audience = 'leadership' as never
    invalid.server.activityProviders[0]!.requiredPermission = 'Alpha.*'

    const message = validationErrorMessage(invalid)
    expect(message).toContain('route alpha/alpha-route uses unsupported organization audience')
    expect(message).toContain('route alpha/alpha-route must declare a valid required permission')
    expect(message).toContain(
      'activity provider alpha/alpha-activity uses unsupported organization audience leadership',
    )
    expect(message).toContain(
      'activity provider alpha/alpha-activity must declare a valid required permission',
    )
  })

  it('rejects duplicate activity providers and invalid freshness policies', () => {
    const invalid = manifest('alpha', {
      activityProvider: { freshness: { staleAfterSeconds: 0 } },
    })
    invalid.server.activityProviders.push({ ...invalid.server.activityProviders[0]! })

    const message = validationErrorMessage(invalid)
    expect(message).toContain(
      'activity provider identity alpha/alpha-activity conflicts between alpha and alpha',
    )
    expect(message).toContain(
      'activity provider alpha/alpha-activity must use a positive whole stale interval',
    )
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
        subjectKind: 'solar-system' as never,
        materializationIntervalSeconds: 0,
        eligibility: { kind: 'module-callback' } as never,
      },
    })

    const message = validationErrorMessage(invalid)
    expect(message).toContain('uses unsupported eligibility module-callback')
    expect(message).toContain('must use a positive whole interval')
    expect(message).toContain('uses unsupported subject kind solar-system')
  })

  it.each([
    ['alliance', 'current-managed-alliance'],
    ['corporation', 'current-managed-corporation-source'],
  ] as const)('accepts scalar %s resource eligibility', (subjectKind, eligibilityKind) => {
    const declaration = manifest('alpha')
    declaration.server.resources = [
      {
        id: 'alpha-resource',
        operationId: 'alpha-operation',
        subjectKind,
        materializationIntervalSeconds: 900,
        eligibility: { kind: eligibilityKind },
        persistence: { projection: [], materialization: [] },
        exportName: 'alphaResource',
      },
    ]

    expect(() =>
      validatePlatformModuleManifests([declaration], coreModuleValidationAuthorities),
    ).not.toThrow()
  })

  it('rejects a legal resource eligibility paired with the wrong subject kind', () => {
    const invalid = manifest('alpha', {
      resource: {
        subjectKind: 'alliance' as never,
        eligibility: { kind: 'current-owned-character' } as never,
      },
    })

    expect(validationErrorMessage(invalid)).toContain(
      'eligibility current-owned-character is incompatible with subject kind alliance; expected current-managed-alliance',
    )
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
      "operationId: 'alpha-operation', coreDataProducts: [] as const, batch: { mode: 'complete-observation', operationId: 'alpha-batch' }, subjectKind: 'character'",
    )
  })

  it('rejects core-data products on batched resources', () => {
    const declaration = manifest('alpha', {
      resource: {
        batch: { mode: 'complete-observation', operationId: 'alpha-operation' },
        coreDataProducts: ['published-type-groups'],
      },
    })

    expect(validationErrorMessage(declaration)).toContain(
      'resource alpha/alpha-resource cannot declare core-data products with batch execution',
    )
  })

  it('validates contribution-scoped core-data product declarations', () => {
    const valid = manifest('alpha', {
      route: { coreDataProducts: ['published-type-groups'] },
      resource: { coreDataProducts: ['published-type-groups'] },
    })
    expect(() =>
      validatePlatformModuleManifests([valid], coreModuleValidationAuthorities),
    ).not.toThrow()

    const unknown = manifest('alpha', {
      route: { coreDataProducts: ['unknown-product' as never] },
    })
    expect(validationErrorMessage(unknown)).toContain('references unknown core-data product')

    const duplicate = manifest('alpha', {
      resource: {
        coreDataProducts: ['published-type-groups', 'published-type-groups'],
      },
    })
    expect(validationErrorMessage(duplicate)).toContain('declares duplicate core-data product')

    const provider = manifest('alpha', {
      activityProvider: { coreDataProducts: ['published-type-groups'] },
    })
    expect(validationErrorMessage(provider)).toContain(
      'cannot use core-data product published-type-groups in activity-provider',
    )

    const malformed = manifest('alpha')
    ;(malformed.server.routes[0] as { coreDataProducts: unknown }).coreDataProducts = 'invalid'
    expect(validationErrorMessage(malformed)).toContain('core-data products must be an array')
  })

  it('rejects protected and audience-incompatible product policies', () => {
    const declaration = manifest('alpha', {
      route: { coreDataProducts: ['future-product' as never] },
    })
    const basePolicy = {
      permittedContexts: ['route'] as const,
    }
    const protectedAuthorities = {
      ...coreModuleValidationAuthorities,
      coreDataProductContracts: {
        'future-product': {
          ...basePolicy,
          audience: 'installed-module' as const,
          sensitivity: 'protected' as const,
        },
      },
    }
    expect(() => validatePlatformModuleManifests([declaration], protectedAuthorities)).toThrow(
      'cannot declare protected core-data product future-product',
    )

    const coreOnlyAuthorities = {
      ...coreModuleValidationAuthorities,
      coreDataProductContracts: {
        'future-product': {
          ...basePolicy,
          audience: 'core' as const,
          sensitivity: 'public' as const,
        },
      },
    }
    expect(() => validatePlatformModuleManifests([declaration], coreOnlyAuthorities)).toThrow(
      'has incompatible audience for core-data product future-product',
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
        audience: 'member',
        requiredPermission: 'alpha.view',
      },
      {
        id: 'second-route',
        namespace: '/alpha/items/:itemId',
        exportName: 'secondRoutes',
        authorization: 'authenticated-session',
        audience: 'member',
        requiredPermission: 'alpha.view',
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
      audience: 'member',
      requiredPermission: 'alpha.view',
      persistenceOperations: [],
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
      audience: 'member',
      requiredPermission: 'alpha.view',
      persistenceOperations: [],
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
      'installedModuleResources =\n  [] as const satisfies readonly PlatformInstalledResourceDescriptor[]',
    )
    expect(
      first.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain(
      'installedModuleActivityProviders =\n  [] as const satisfies readonly PlatformInstalledActivityProviderDescriptor[]',
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
    expect(first.get('api/src/generated/platform/installed-module-persistence.ts')).toContain(
      '[] as const satisfies readonly PlatformInstalledPersistenceOperationDescriptor[]',
    )
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      '[] as const satisfies readonly PlatformInstalledModuleDefinition[]',
    )
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      "navigationId: 'core-character-skills'",
    )
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      "navigationId: 'core-character-clones'",
    )
    expectInOrder(first.get('api/src/generated/platform/installed-module-runtime.ts'), [
      "navigationId: 'core-character-finance'",
      "navigationId: 'core-character-assets'",
      "navigationId: 'core-character-history'",
      "navigationId: 'core-character-mail'",
    ])
    expect(first.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      "navigationId: 'core-character-mail'",
    )
    expect(first.get('generated/platform/installed-nuxt-modules.ts')).toContain(
      'installedNuxtModules = [] as const',
    )
  })

  it('generates canonical persistence bindings and exact contribution grants', async () => {
    const declaration = manifest('alpha', { persistenceOperation: {} })
    const routine = await canonicalizePersistenceRoutineSql({
      moduleId: 'alpha',
      operationId: 'alpha-read',
      revision: 1,
      mode: 'read',
      sql: `
        create function eve_module_alpha.persist_alpha_read(input jsonb)
        returns jsonb language sql stable parallel unsafe return input
      `,
    })
    const persistence = generateRegistryFiles({
      manifests: [declaration],
      persistenceRoutines: [{ ...routine, migration: 'alpha-001-initial.sql' }],
    }).get('api/src/generated/platform/installed-module-persistence.ts')

    expect(persistence).toContain(
      "import { alphaReadOperation as module0PersistenceOperation0 } from '@eve-space/alpha-server'",
    )
    expect(persistence).toContain("routineName: 'persist_alpha_read'")
    expect(persistence).toContain(`definitionFingerprint: '${routine.definitionFingerprint}'`)
    expect(persistence).toMatch(/installedModulePersistenceContractFingerprint = '[0-9a-f]{64}'/)
    expect(persistence).toContain(
      'grants: {"routes":["alpha-route"],"activityProviders":["alpha-activity"],"resourceProjections":["alpha-resource"],"resourceMaterializations":[]}',
    )
    expect(persistence).toContain("'alpha/alpha-read': installedModulePersistenceOperations[0]!")
    expect(persistence).toContain(
      'export function createModule0Route0Persistence(invoke: PlatformPersistenceOperationInvoker)',
    )
    expect(persistence).toContain(
      "'alphaRead': bindPlatformPersistenceOperation(installedModulePersistenceOperations[0]!, invoke)",
    )
    expect(persistence).toContain(
      'export function createModule0Resource0MaterializationPersistence(_invoke: PlatformPersistenceOperationInvoker) {\n  return {}',
    )
    expect(persistence).toContain("'alpha/alpha-route': createModule0Route0Persistence")
    expect(persistence).toContain(
      "'alpha/alpha-resource': createModule0Resource0ProjectionPersistence",
    )
    expect(persistence).not.toContain("'saveSnapshot': bindPlatformPersistenceOperation")
    expect(persistence).not.toContain('operationId: string')
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
    expect(api).toContain(
      "module0Route0Factory(createPlatformModuleRouteCapabilities('alpha', 'alpha-route', [] as const))",
    )
    expect(api).toContain("{ audience: 'member', requiredPermission: 'alpha.view' }")
    expectInOrder(api, [
      "platformModuleRouteComposers['owned-character'](",
      "'alpha'",
      "{ audience: 'member', requiredPermission: 'alpha.view' }",
      'module0Route0',
    ])
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
      audience: 'hr',
      requiredPermission: 'alpha.summary',
      persistenceOperations: [],
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
      "platformModuleRouteComposers['authenticated-session'](",
      "{ audience: 'hr', requiredPermission: 'alpha.summary' }",
      'module0Route1',
    ])
  })

  it('emits each contribution exact core-data product declaration', () => {
    const declaration = manifest('alpha', {
      route: { coreDataProducts: ['published-type-groups'] },
      resource: { coreDataProducts: ['published-type-groups'] },
    })
    const files = generateRegistryFiles([declaration])

    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "createPlatformModuleRouteCapabilities('alpha', 'alpha-route', [\"published-type-groups\"] as const)",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'coreDataProducts: ["published-type-groups"] as const',
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'implementation: module0Resource0 satisfies PlatformResourceImplementationForProducts<typeof module0Resource0, readonly ["published-type-groups"]>',
    )
    expect(
      files.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain('coreDataProducts: [] as const')
  })

  it('generates lazy activity providers with authorization and same-module pages', () => {
    const providers = generateRegistryFiles([manifest('alpha')]).get(
      'api/src/generated/platform/installed-module-activity-providers.ts',
    )

    expect(providers).toContain(
      "import { alphaActivityProvider as module0ActivityProvider0Factory } from '@eve-space/alpha-server'",
    )
    expect(providers).toContain("moduleId: 'alpha', providerId: 'alpha-activity'")
    expect(providers).toContain("audience: 'member', requiredPermission: 'alpha.view'")
    expect(providers).toContain("pageIds: ['alpha-page']")
    expect(providers).toContain(
      "invoke: (context) => module0ActivityProvider0Factory(createPlatformModuleActivityProviderCapabilities('alpha', 'alpha-activity', context, [] as const))(context)",
    )
  })

  it('combines ESI operation imports from the same server package', () => {
    const declaration = manifest('alpha')
    declaration.server.esiOperations.push({
      id: 'alpha-secondary-operation',
      exportName: 'alphaSecondaryOperation',
    })

    const esi = generateRegistryFiles([declaration]).get(
      'api/src/generated/platform/installed-module-esi.ts',
    )

    expect(esi).toContain(
      "import {\n  alphaOperation as module0EsiOperation0,\n  alphaSecondaryOperation as module0EsiOperation1,\n} from '@eve-space/alpha-server'",
    )
    expect(esi?.match(/from '@eve-space\/alpha-server'/g)).toHaveLength(1)
  })

  it('combines same-package imports in every server registry', () => {
    const declaration = manifest('alpha')
    declaration.server.routes.push({
      id: 'alpha-secondary-route',
      namespace: '/alpha/secondary',
      exportName: 'alphaSecondaryRoutes',
      authorization: 'authenticated-session',
      audience: 'member',
      requiredPermission: 'alpha.view',
      persistenceOperations: [],
    })
    declaration.server.resources.push({
      id: 'alpha-secondary-resource',
      operationId: 'alpha-operation',
      dependentOperationIds: [],
      subjectKind: 'character',
      materializationIntervalSeconds: 900,
      eligibility: { kind: 'current-owned-character' },
      persistence: { projection: [], materialization: [] },
      exportName: 'alphaSecondaryResource',
    })
    declaration.server.activityProviders.push({
      id: 'alpha-secondary-activity',
      exportName: 'alphaSecondaryActivityProvider',
      audience: 'member',
      requiredPermission: 'alpha.view',
      persistenceOperations: [],
      freshness: { staleAfterSeconds: 900 },
    })

    const files = generateRegistryFiles([declaration])
    for (const path of [
      'api/src/generated/platform/installed-module-routes.ts',
      'api/src/generated/platform/installed-module-worker.ts',
      'api/src/generated/platform/installed-module-activity-providers.ts',
      'api/src/generated/platform/installed-module-esi.ts',
    ])
      expect(files.get(path)?.match(/from '@eve-space\/alpha-server'/g)).toHaveLength(1)
  })

  it('aliases repeated package export names in every generated server registry', () => {
    const alpha = manifest('alpha', {
      route: { exportName: 'routes' },
      resource: { exportName: 'resource' },
      operation: { exportName: 'operation' },
      activityProvider: { exportName: 'activityProvider' },
    })
    const beta = manifest('beta', {
      route: { exportName: 'routes' },
      resource: { exportName: 'resource' },
      operation: { exportName: 'operation' },
      activityProvider: { exportName: 'activityProvider' },
    })
    const files = generateRegistryFiles([beta, alpha])

    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "import { routes as module0Route0Factory } from '@eve-space/alpha-server'",
    )
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "import { routes as module1Route0Factory } from '@eve-space/beta-server'",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "({ moduleId: 'alpha', resourceId: 'alpha-resource', operationId: 'alpha-operation', coreDataProducts: [] as const, subjectKind: 'character', materializationIntervalSeconds: 900, eligibility: { kind: 'current-owned-character' }, persistence: {\"projection\":[],\"materialization\":[]} as const, implementation: module0Resource0 satisfies PlatformResourceImplementationForProducts<typeof module0Resource0, readonly []> } as const)",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "({ moduleId: 'beta', resourceId: 'beta-resource', operationId: 'beta-operation', coreDataProducts: [] as const, subjectKind: 'character', materializationIntervalSeconds: 900, eligibility: { kind: 'current-owned-character' }, persistence: {\"projection\":[],\"materialization\":[]} as const, implementation: module1Resource0 satisfies PlatformResourceImplementationForProducts<typeof module1Resource0, readonly []> } as const)",
    )
    expect(files.get('api/src/generated/platform/installed-module-esi.ts')).toContain(
      "'alpha-operation': module0EsiOperation0.contract,\n  'beta-operation': module1EsiOperation0.contract,",
    )
    expect(
      files.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain(
      "import { activityProvider as module0ActivityProvider0Factory } from '@eve-space/alpha-server'",
    )
    expect(
      files.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain(
      "import { activityProvider as module1ActivityProvider0Factory } from '@eve-space/beta-server'",
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
      "export { findOwnedCharacter } from '../../../../api/src/auth/character-lifecycle.js'",
      '../../../../api/src/auth/character-lifecycle.js',
    ],
    [
      "const token = import('../../../../api/src/auth/tokens.js')",
      '../../../../api/src/auth/tokens.js',
    ],
    ["import routes from '@eve-space/api/routes/admin'", '@eve-space/api/routes/admin'],
  ])('rejects core API imports: %s', (source, specifier) => {
    expect(
      moduleServerImportViolations([{ path: 'features/alpha/server/src/index.ts', source }]),
    ).toContain(
      `features/alpha/server/src/index.ts: feature server code cannot import core API source ${specifier}`,
    )
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
      expect(
        moduleServerImportViolations(sources).filter((violation) =>
          violation.includes('feature server code cannot import core API source'),
        ),
      ).toHaveLength(extensions.length)
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
  persistenceOperation?: Partial<PlatformModuleManifest['server']['persistenceOperations'][number]>
  resource?: Partial<PlatformModuleManifest['server']['resources'][number]>
  operation?: Partial<PlatformModuleManifest['server']['esiOperations'][number]>
  activityProvider?: Partial<PlatformModuleManifest['server']['activityProviders'][number]>
  page?: Partial<PlatformModuleManifest['nuxt']['pages'][number]>
  navigation?: Partial<PlatformModuleManifest['nuxt']['navigation'][number]>
  exposed?: PlatformModuleManifest['nuxt']['exposed']
}

function manifest(id: string, overrides: ManifestOverrides = {}): PlatformModuleManifest {
  const pageName = overrides.page?.name ?? `eve-${id}-audit`
  const operationId = overrides.operation?.id ?? `${id}-operation`
  const persistenceOperation = overrides.persistenceOperation
    ? {
        id: `${id}-read`,
        method: `${camelCase(id)}Read`,
        revision: 1,
        mode: 'read' as const,
        exportName: `${camelCase(id)}ReadOperation`,
        migration: `${id}-001-initial.sql`,
        ...overrides.persistenceOperation,
      }
    : undefined
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
          audience: 'member',
          requiredPermission: `${id}.view`,
          persistenceOperations: persistenceOperation
            ? [{ operationId: persistenceOperation.id }]
            : [],
          ...overrides.route,
        },
      ],
      migrations: [{ name: `${id}-001-initial.sql`, ...overrides.migration }],
      persistenceOperations: persistenceOperation ? [persistenceOperation] : [],
      resources: [
        {
          id: `${id}-resource`,
          operationId,
          subjectKind: 'character',
          materializationIntervalSeconds: 900,
          eligibility: { kind: 'current-owned-character' },
          persistence: {
            projection: persistenceOperation ? [{ operationId: persistenceOperation.id }] : [],
            materialization: [],
          },
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
      activityProviders: [
        {
          id: `${id}-activity`,
          exportName: `${camelCase(id)}ActivityProvider`,
          audience: 'member',
          requiredPermission: `${id}.view`,
          persistenceOperations: persistenceOperation
            ? [{ operationId: persistenceOperation.id }]
            : [],
          freshness: { staleAfterSeconds: 300 },
          ...overrides.activityProvider,
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

function validationErrorMessage(
  moduleManifest: PlatformModuleManifest | readonly PlatformModuleManifest[],
) {
  try {
    validatePlatformModuleManifests(
      Array.isArray(moduleManifest) ? moduleManifest : [moduleManifest],
      coreModuleValidationAuthorities,
    )
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
