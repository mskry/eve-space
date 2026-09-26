import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compilePlatformModules,
  PlatformModuleCompilationError as PlatformModuleValidationError,
  readCompiledPlatformModules,
  type PlatformModuleCompilationAuthorities,
} from '@eve-space/platform-module-contract/compiler'
import { platformCoreEsiOperationCatalog } from '@eve-space/platform-module-contract/esi'
import {
  definePlatformModuleManifest,
  platformModuleHostContractVersion,
  type PlatformModuleManifest,
} from '@eve-space/platform-module-contract/manifest'
import { canonicalizePlatformModuleManifest } from '@eve-space/platform-module-contract/publisher'
import { platformOrganizationCommandIds } from '@eve-space/platform-module-contract/server'
import { definePlatformExecutableEsiOperation } from '../../packages/platform-module-server/src/index'
import { canonicalizePersistenceRoutineSql } from '../../api/src/db/module-persistence-routine'
import { coreModuleValidationAuthorities } from '../../scripts/module-registry/authorities'
import {
  generateRegistryFiles as renderRegistryFiles,
  loadInstalledModuleManifests,
  type InstalledModuleRegistryInput,
} from '../../scripts/module-registry/generator'
import { moduleServerImportViolations } from '../../scripts/module-registry/server-boundaries'
import { loadFeatureServerSources } from '../../scripts/module-registry/server-sources'
import { moduleNuxtBoundaryViolations } from '../../scripts/module-registry/nuxt-boundaries'
import { moduleServerSourceExtensions } from '../../scripts/module-registry/source-extensions.mjs'
import { resolveInstalledModuleReleases } from '../../scripts/module-registry/resolved-release'
import {
  isPlatformModuleContractSourcePath,
  platformModuleContractImportViolations,
  platformModuleContractModuleSpecifiers,
} from '../../scripts/verify-platform-module-contract-boundaries'

function validatePlatformModuleManifests(
  manifests: readonly PlatformModuleManifest[],
  authorities: PlatformModuleCompilationAuthorities,
) {
  return readCompiledPlatformModules(
    compilePlatformModules(
      manifests.map((declaration) => ({ declaration, expectedModuleId: declaration.id })),
      authorities,
    ),
  )
}

function generateRegistryFiles(
  input:
    | readonly PlatformModuleManifest[]
    | {
        readonly manifests: readonly PlatformModuleManifest[]
        readonly persistenceRoutines: InstalledModuleRegistryInput['persistenceRoutines']
      },
) {
  const manifests = Array.isArray(input) ? input : input.manifests
  const compiled = compilePlatformModules(
    manifests.map((declaration) => ({ declaration, expectedModuleId: declaration.id })),
    coreModuleValidationAuthorities,
  )
  return Array.isArray(input)
    ? renderRegistryFiles(compiled)
    : renderRegistryFiles(compiled, input.persistenceRoutines)
}

describe('platform module declarations', () => {
  it('compiles unknown candidates into stable canonical order without partial output', () => {
    const alpha = manifest('alpha')
    const beta = manifest('beta')
    const compiled = compilePlatformModules(
      [
        { declaration: beta, expectedModuleId: 'beta' },
        { declaration: alpha, expectedModuleId: 'alpha' },
      ],
      coreModuleValidationAuthorities,
    )

    expect(readCompiledPlatformModules(compiled).map(({ id }) => id)).toStrictEqual([
      'alpha',
      'beta',
    ])

    let result: ReturnType<typeof compilePlatformModules> | undefined
    let caught: unknown
    try {
      result = compilePlatformModules(
        [
          { declaration: null, expectedModuleId: 'beta' },
          { declaration: { id: 42 }, expectedModuleId: 'alpha' },
        ],
        coreModuleValidationAuthorities,
      )
    } catch (error) {
      caught = error
    }
    expect(result).toBeUndefined()
    expect(caught).toBeInstanceOf(PlatformModuleValidationError)
    expect((caught as PlatformModuleValidationError).issues).toStrictEqual([
      'installed module alpha defaultEnabled must be a boolean',
      'installed module alpha icon must be a string',
      'installed module alpha id must be a string',
      'installed module alpha nuxt must be an object',
      'installed module alpha release must be an object',
      'installed module alpha server must be an object',
      'installed module beta declaration must be an object',
    ])
  })

  it('isolates compiled state and registry text from later authoring mutation', () => {
    const source = authoringManifest('alpha')
    const compiled = compilePlatformModules(
      [{ declaration: source, expectedModuleId: 'alpha' }],
      coreModuleValidationAuthorities,
    )
    const before = renderRegistryFiles(compiled)

    source.id = 'changed'
    source.release.version = '9.9.9'
    source.permissions![0]!.audiences[0] = 'director'
    source.permissionProfiles![0]!.permissions[0] = 'changed.permission'
    source.reviewerContributions![0]!.label = 'Changed'
    source.server.routes[0]!.namespace = '/changed'
    source.nuxt.pages[0]!.name = 'changed'

    const canonical = readCompiledPlatformModules(compiled)
    expect(canonical[0]!.id).toBe('alpha')
    expect(canonical[0]!.release.version).toBe('0.1.0')
    expect(canonical[0]!.permissions![0]!.audiences).toStrictEqual(['hr'])
    expect(canonical[0]!.permissionProfiles![0]!.permissions).toStrictEqual(['alpha.review'])
    expect(canonical[0]!.reviewerContributions![0]!.label).toBe('Overview')
    expect(canonical[0]!.server.routes[0]!.namespace).toBe('/alpha/accounts/:userId')
    expect(canonical[0]!.nuxt.pages[0]!.name).toBe('eve-alpha-audit')
    expect(renderRegistryFiles(compiled)).toStrictEqual(before)
    expect(Object.isFrozen(compiled)).toBe(true)
    expect(Object.isFrozen(canonical[0]!.server.routes)).toBe(true)
    expect(Object.isFrozen(canonical[0]!.permissions![0]!.audiences)).toBe(true)
  })

  it('validates release identity and semantic compatibility metadata together', () => {
    const invalid = manifest('alpha')
    invalid.release.publisherPackage = '../alpha-manifest'
    invalid.release.version = 'v1'
    invalid.release.hostContractRange = '1.0.0 - nope'
    invalid.server.package = 'HTTPS://registry.test/alpha'

    expect(() =>
      compilePlatformModules(
        [
          {
            declaration: invalid,
            expectedModuleId: 'alpha',
            expectedPublisherPackage: '@example/alpha-manifest',
          },
        ],
        coreModuleValidationAuthorities,
      ),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          'installed module alpha descriptor declares mismatched publisher package ../alpha-manifest; expected @example/alpha-manifest',
          'module alpha publisher package must be a valid npm package name',
          'module alpha release version must be a semantic version',
          'module alpha host contract range must be a semantic version range',
          'module alpha server package must be a valid npm package name',
        ]),
      }),
    )
  })

  it('rejects permission namespace, elevated-audience, and missing-catalog declarations', () => {
    const invalid = authoringManifest('alpha')
    invalid.permissions![0]!.key = 'beta.review'
    invalid.permissionProfiles![0]!.audiences = ['organization_owner' as never]
    invalid.permissionProfiles![0]!.permissions = ['alpha.missing']
    invalid.reviewerContributions![0]!.requiredPermission = 'alpha.missing'

    const message = validationErrorMessage(invalid)
    expect(message).toContain('permission beta.review must belong to module namespace alpha.')
    expect(message).toContain(
      'permission profile alpha/reviewer uses unsupported audience organization_owner',
    )
    expect(message).toContain(
      'permission profile alpha/reviewer references unknown catalog permission alpha.missing',
    )
    expect(message).toContain(
      'reviewer contribution alpha/overview references unknown catalog permission alpha.missing',
    )
  })

  it('rejects duplicate reviewer identities deterministically across publishers', () => {
    const alpha = authoringManifest('alpha')
    const beta = authoringManifest('beta')

    expect(validationErrorMessage([beta, alpha])).toContain(
      'reviewer contribution ID overview conflicts between alpha and beta',
    )
  })

  it('rejects duplicate reviewer route links and panel exports', () => {
    const duplicateRouteLink = authoringManifest('alpha')
    duplicateRouteLink.reviewerContributions!.push({
      ...duplicateRouteLink.reviewerContributions![0]!,
      id: 'details',
      order: 20,
      panelExport: './reviewer/details',
    })

    expect(validationErrorMessage(duplicateRouteLink)).toContain(
      'reviewer route link alpha/alpha-route conflicts',
    )

    const duplicatePanelExport = authoringManifest('alpha')
    duplicatePanelExport.server.routes.push({
      ...duplicatePanelExport.server.routes[0]!,
      exportName: 'alphaDetailsRoutes',
      id: 'alpha-details-route',
      namespace: '/alpha/reviews/:userId',
    })
    duplicatePanelExport.reviewerContributions!.push({
      ...duplicatePanelExport.reviewerContributions![0]!,
      id: 'details',
      order: 20,
      routeId: 'alpha-details-route',
    })

    expect(validationErrorMessage(duplicatePanelExport)).toContain(
      'reviewer panel export @eve-space/alpha-nuxt:./reviewer/overview conflicts',
    )
  })

  it('rejects ambiguous reviewer route identities and global order positions', () => {
    const duplicateRouteId = authoringManifest('alpha')
    duplicateRouteId.server.routes.push({
      ...duplicateRouteId.server.routes[0]!,
      exportName: 'alphaDetailsRoutes',
      namespace: '/alpha/reviews/:userId',
    })
    expect(validationErrorMessage(duplicateRouteId)).toContain(
      'route ID in module alpha alpha-route conflicts between /alpha/accounts/:userId and /alpha/reviews/:userId',
    )

    const alpha = authoringManifest('alpha')
    const beta = authoringManifest('beta')
    alpha.reviewerContributions![0]!.id = 'alpha-overview'
    beta.reviewerContributions![0]!.id = 'beta-overview'
    expect(validationErrorMessage([beta, alpha])).toContain(
      'reviewer contribution order 10 conflicts between alpha/alpha-overview and beta/beta-overview',
    )
  })

  it('requires each reviewer contribution to link one exactly compatible route', () => {
    const unknownRoute = authoringManifest('alpha')
    unknownRoute.reviewerContributions![0]!.routeId = 'missing-route'
    expect(validationErrorMessage(unknownRoute)).toContain(
      'reviewer contribution alpha/overview references unknown route missing-route',
    )

    const wrongTarget = authoringManifest('alpha')
    wrongTarget.reviewerContributions![0]!.target = 'managed-organization-character'
    expect(validationErrorMessage(wrongTarget)).toContain(
      'reviewer contribution alpha/overview target must match route alpha-route',
    )

    const wrongAudience = authoringManifest('alpha')
    wrongAudience.reviewerContributions![0]!.audience = 'director'
    expect(validationErrorMessage(wrongAudience)).toContain(
      'reviewer contribution alpha/overview audience must match route alpha-route',
    )

    const wrongPermission = authoringManifest('alpha')
    wrongPermission.reviewerContributions![0]!.requiredPermission = 'alpha.view'
    expect(validationErrorMessage(wrongPermission)).toContain(
      'reviewer contribution alpha/overview permission must match route alpha-route',
    )

    const hiddenAdditionalPermission = authoringManifest('alpha')
    hiddenAdditionalPermission.server.routes[0]!.additionalRequiredPermissions = ['alpha.view']
    expect(validationErrorMessage(hiddenAdditionalPermission)).toContain(
      'reviewer contribution alpha/overview route alpha-route cannot require additional permissions not represented by the contribution',
    )
  })

  it('normalizes publisher inventories and emits canonical JSON', () => {
    const declaration = authoringManifest('alpha')
    declaration.permissions = declaration.permissions!.toReversed()
    declaration.permissionProfiles![0]!.permissions = ['alpha.view', 'alpha.review']

    const canonical = canonicalizePlatformModuleManifest(
      definePlatformModuleManifest(declaration),
      coreModuleValidationAuthorities,
    )
    const emitted = JSON.parse(canonical) as PlatformModuleManifest

    expect(platformModuleHostContractVersion).toBe('1.0.0')
    expect(canonical.endsWith('\n')).toBe(true)
    expect(emitted.permissions?.map(({ key }) => key)).toStrictEqual(['alpha.review', 'alpha.view'])
    expect(emitted.permissionProfiles?.[0]?.permissions).toStrictEqual([
      'alpha.review',
      'alpha.view',
    ])
    expect(canonicalizePlatformModuleManifest(emitted, coreModuleValidationAuthorities)).toBe(
      canonical,
    )
  })

  it('publishes the versioned core ESI reuse catalog and rejects unknown operations', () => {
    expect(platformCoreEsiOperationCatalog).toMatchObject({
      operationIds: expect.arrayContaining(['skills', 'wallet-balance', 'mail-headers']),
      version: 1,
    })

    const declaration = actionManifest('member-audit')
    const baseResource = declaration.server.resources[0]!
    declaration.server.resources = [
      { ...baseResource, id: 'trained-skills', operationId: 'skills' },
      {
        ...baseResource,
        exportName: 'walletBalanceResource',
        id: 'wallet-balance',
        operationId: 'wallet-balance',
        sectionId: 'wallet',
      },
      {
        ...baseResource,
        exportName: 'mailHeadersResource',
        id: 'mail-headers',
        operationId: 'mail-headers',
        sectionId: 'mail',
      },
    ]

    expect(() => canonicalizePlatformModuleManifest(declaration)).not.toThrow()
    declaration.server.resources[2]!.operationId = 'unknown-core-operation'
    expect(() => canonicalizePlatformModuleManifest(declaration)).toThrow(
      'references unknown ESI operation unknown-core-operation',
    )
  })

  it('selects module policies using the trusted installed candidate identity', () => {
    const declaration = manifest('alpha', { defaultEnabled: true })

    expect(() =>
      compilePlatformModules(
        [{ declaration, expectedModuleId: 'member-audit' }],
        coreModuleValidationAuthorities,
      ),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          'installed module member-audit descriptor declares mismatched ID alpha',
          'module member-audit must default disabled',
        ]),
      }),
    )
  })

  it('rejects unknown keys at every declaration record boundary', () => {
    const declaration = authoringManifest('alpha', {
      exposed: { components: [] },
      persistenceOperation: {},
      resource: {
        batch: { mode: 'complete-observation', operationId: 'alpha-operation' },
      },
    })
    declaration.sections = [{ defaultEnabled: false, id: 'overview', kind: 'workspace' }]

    const route = declaration.server.routes[0]!
    const resource = declaration.server.resources[0]!
    const activityProvider = declaration.server.activityProviders[0]!
    for (const record of [
      declaration,
      declaration.release,
      declaration.permissions![0]!,
      declaration.permissionProfiles![0]!,
      declaration.reviewerContributions![0]!,
      declaration.server,
      declaration.nuxt,
      declaration.sections[0]!,
      route,
      declaration.server.migrations[0]!,
      declaration.server.persistenceOperations[0]!,
      resource,
      resource.eligibility,
      resource.persistence,
      resource.batch!,
      declaration.server.esiOperations[0]!,
      activityProvider,
      activityProvider.freshness,
      declaration.nuxt.pages[0]!,
      declaration.nuxt.navigation[0]!,
      declaration.nuxt.exposed!,
      route.persistenceOperations[0]!,
      resource.persistence.projection[0]!,
    ]) {
      Object.assign(record, { unexpected: true })
    }
    Object.assign(route, {
      additionalRequiredPermission: [],
      exposuer: 'standard',
      targte: 'caller',
    })

    expect(() =>
      compilePlatformModules(
        [{ declaration, expectedModuleId: 'alpha' }],
        coreModuleValidationAuthorities,
      ),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          'installed module alpha declaration.unexpected is not allowed',
          'installed module alpha release.unexpected is not allowed',
          'installed module alpha permissions[0].unexpected is not allowed',
          'installed module alpha permissionProfiles[0].unexpected is not allowed',
          'installed module alpha reviewerContributions[0].unexpected is not allowed',
          'installed module alpha server.unexpected is not allowed',
          'installed module alpha nuxt.unexpected is not allowed',
          'installed module alpha sections[0].unexpected is not allowed',
          'installed module alpha server.routes[0].unexpected is not allowed',
          'installed module alpha server.routes[0].additionalRequiredPermission is not allowed',
          'installed module alpha server.routes[0].targte is not allowed',
          'installed module alpha server.routes[0].exposuer is not allowed',
          'installed module alpha server.migrations[0].unexpected is not allowed',
          'installed module alpha server.persistenceOperations[0].unexpected is not allowed',
          'installed module alpha server.resources[0].unexpected is not allowed',
          'installed module alpha server.resources[0].eligibility.unexpected is not allowed',
          'installed module alpha server.resources[0].persistence.unexpected is not allowed',
          'installed module alpha server.resources[0].batch.unexpected is not allowed',
          'installed module alpha server.esiOperations[0].unexpected is not allowed',
          'installed module alpha server.activityProviders[0].unexpected is not allowed',
          'installed module alpha server.activityProviders[0].freshness.unexpected is not allowed',
          'installed module alpha nuxt.pages[0].unexpected is not allowed',
          'installed module alpha nuxt.navigation[0].unexpected is not allowed',
          'installed module alpha nuxt.exposed.unexpected is not allowed',
          'installed module alpha server.routes[0].persistenceOperations[0].unexpected is not allowed',
          'installed module alpha server.resources[0].persistence.projection[0].unexpected is not allowed',
        ]),
      }),
    )
  })

  it.each([
    ['directoryFields', ['member', 'module-private-value']],
    ['searchRoute', '/api/modules/alpha/members'],
  ])('rejects reviewer contribution %s extensions', (field, value) => {
    const declaration = authoringManifest('alpha')
    Object.assign(declaration.reviewerContributions![0]!, { [field]: value })

    expect(() =>
      compilePlatformModules(
        [{ declaration, expectedModuleId: 'alpha' }],
        coreModuleValidationAuthorities,
      ),
    ).toThrowError(
      expect.objectContaining({
        issues: [`installed module alpha reviewerContributions[0].${field} is not allowed`],
      }),
    )
  })

  it('enforces contract caller roles for hosts, generated registries, scripts, and tests', () => {
    for (const [path, subpath] of [
      ['api/src/admin/routes.ts', 'compiler'],
      ['app/pages/index.vue', 'activity'],
      ['api/src/generated/platform/installed-module-worker.js', 'activity'],
      ['generated/platform/installed-module-navigation.ts', 'installed'],
      ['scripts/verify-core-migrations.ts', 'compiler'],
      ['tests/platform/platform-boundaries.test.ts', 'manifest'],
    ]) {
      expect(
        platformModuleContractImportViolations(
          path!,
          `@eve-space/platform-module-contract/${subpath}`,
        ),
      ).toStrictEqual([expect.stringContaining(`cannot import ${subpath}`)])
    }

    expect(
      platformModuleContractImportViolations(
        'api/src/generated/platform/installed-module-worker.ts',
        '@eve-space/platform-module-contract/resources',
      ),
    ).toStrictEqual([])
    expect(
      platformModuleContractImportViolations(
        'tests/platform/platform-module-registry.test.ts',
        '@eve-space/platform-module-contract/compiler',
      ),
    ).toStrictEqual([])
    expect(
      platformModuleContractImportViolations(
        'tools/new-platform-consumer.ts',
        '@eve-space/platform-module-contract/compiler',
      ),
    ).toStrictEqual([
      'tools/new-platform-consumer.ts: unregistered caller role cannot import compiler',
    ])
  })

  it('scans JavaScript sources and TypeScript import-equals declarations', () => {
    for (const extension of ['js', 'jsx', 'mjs', 'cjs']) {
      expect(isPlatformModuleContractSourcePath(`source.${extension}`)).toBe(true)
      expect(
        platformModuleContractModuleSpecifiers(
          `source.${extension}`,
          "import '@eve-space/platform-module-contract/compiler'",
        ),
      ).toStrictEqual(['@eve-space/platform-module-contract/compiler'])
    }

    expect(
      platformModuleContractModuleSpecifiers(
        'source.cts',
        "import contract = require('@eve-space/platform-module-contract')",
      ),
    ).toStrictEqual(['@eve-space/platform-module-contract'])
  })

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

    expect(violations).toStrictEqual(
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
      policy: executableOperationPolicy(),
      sdkOperationId: 'GetStatus',
    })

    expect(definition.sdkOperationId).toBe('GetStatus')
    expect(definition.contract.audit).toStrictEqual({
      esiOperationId: 'GetStatus',
      reviewedDate: '2026-08-18',
    })
    expect(definition.descriptor).toBeDefined()
    expect(() =>
      definePlatformExecutableEsiOperation({
        policy: executableOperationPolicy(),
        sdkOperationId: 'UnknownOperation' as never,
      }),
    ).toThrow('Unknown ESI SDK operation identity')
  })

  it('accepts and sorts valid environment-specific contributions', () => {
    const alpha = manifest('alpha')
    const beta = manifest('beta')

    expect(
      validatePlatformModuleManifests([beta, alpha], coreModuleValidationAuthorities),
    ).toStrictEqual(validatePlatformModuleManifests([alpha, beta], coreModuleValidationAuthorities))
  })

  it('accepts module-local persistence operations with phase-compatible grants', () => {
    const readDeclaration = manifest('alpha', { persistenceOperation: {} })
    const writeDeclaration = manifest('beta', {
      persistenceOperation: {
        exportName: 'saveSnapshotOperation',
        id: 'save-snapshot',
        method: 'saveSnapshot',
        mode: 'write',
      },
    })
    writeDeclaration.server.routes[0]!.persistenceOperations = []
    writeDeclaration.server.activityProviders[0]!.persistenceOperations = []
    writeDeclaration.server.resources[0]!.persistence = {
      materialization: [{ operationId: 'save-snapshot' }],
      projection: [],
    }

    expect(() =>
      validatePlatformModuleManifests(
        [writeDeclaration, readDeclaration],
        coreModuleValidationAuthorities,
      ),
    ).not.toThrow()
  })

  it('rejects invalid persistence identities, metadata, and migration links', () => {
    const invalid = manifest('alpha', {
      persistenceOperation: {
        exportName: 'read-snapshot',
        id: 'ReadSnapshot',
        method: 'read-snapshot',
        migration: 'alpha-999-missing.sql',
        mode: 'execute' as never,
        revision: 0,
      },
    })
    invalid.server.routes[0]!.persistenceOperations = []
    invalid.server.activityProviders[0]!.persistenceOperations = []
    invalid.server.resources[0]!.persistence = { materialization: [], projection: [] }
    invalid.server.persistenceOperations.push({ ...invalid.server.persistenceOperations[0]! })

    const message = validationErrorMessage(invalid)
    for (const fragment of [
      'must use a bounded lowercase kebab-case ID',
      'is not a valid JavaScript export name',
      'must use a positive whole revision',
      'uses unsupported mode execute',
      'references undeclared migration alpha-999-missing.sql',
    ]) {
      expect(message).toContain(fragment)
    }
  })

  it('rejects duplicate operation IDs while allowing retained operations with zero grants', () => {
    const invalid = manifest('alpha', { persistenceOperation: {} })
    invalid.server.routes[0]!.persistenceOperations = []
    invalid.server.activityProviders[0]!.persistenceOperations = []
    invalid.server.resources[0]!.persistence = { materialization: [], projection: [] }
    invalid.server.persistenceOperations.push({ ...invalid.server.persistenceOperations[0]! })

    const message = validationErrorMessage(invalid)
    expect(message).toContain('persistence operation ID alpha-read is duplicated in alpha')
    expect(message).not.toContain('is not granted to a contribution')
  })

  it('rejects duplicate, unknown, cross-module, and mode-incompatible persistence grants', () => {
    const alpha = manifest('alpha', { persistenceOperation: {} })
    const beta = manifest('beta', {
      persistenceOperation: {
        exportName: 'saveSnapshotOperation',
        id: 'save-snapshot',
        method: 'saveSnapshot',
        mode: 'write',
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
      materialization: [{ operationId: 'save-snapshot' }],
      projection: [{ operationId: 'save-snapshot' }],
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
      exposed: { components: ['Button'] },
      migration: { name: '001.sql' },
      moduleIcon: 'unknown-default' as never,
      navigation: { icon: 'unknown' as never },
      route: { authorization: 'module-admin' as never },
    })

    const message = validationErrorMessage(invalid)
    for (const fragment of [
      'must use alpha-*.sql',
      'uses invalid default icon unknown-default',
      'uses invalid icon unknown',
      'uses unsupported authorization module-admin',
      'must begin with EveAlpha',
    ]) {
      expect(message).toContain(fragment)
    }
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

  it('requires exact section and sensitive reviewer classifications for sectioned modules', () => {
    const invalid = manifest('alpha')
    invalid.sections = [
      { defaultEnabled: false, id: 'overview', kind: 'workspace' },
      {
        defaultEnabled: false,
        disclosureRevision: 1,
        id: 'skills',
        kind: 'sensitive-evidence',
      },
    ]
    invalid.server.routes[0]!.sectionId = 'skills'
    invalid.server.routes[0]!.target = 'caller'
    invalid.server.routes[0]!.exposure = 'sensitive-evidence'

    const message = validationErrorMessage(invalid)
    expect(message).toContain(
      'sensitive route alpha/alpha-route must declare a managed reviewer target',
    )
    expect(message).toContain('resource alpha/alpha-resource must declare exactly one section')
    expect(message).toContain(
      'activity provider alpha/alpha-activity must declare exactly one section',
    )
    expect(message).toContain('page alpha/alpha-page must declare exactly one section')
    expect(message).toContain('navigation alpha/alpha-navigation must declare exactly one section')
  })

  it('retains section and reviewer classifications in every generated registry', () => {
    const declaration = manifest('alpha')
    declaration.sections = [
      {
        defaultEnabled: false,
        disclosureRevision: 2,
        id: 'skills',
        kind: 'sensitive-evidence',
      },
    ]
    Object.assign(declaration.server.routes[0]!, {
      audience: 'hr',
      authorization: 'authenticated-session',
      exposure: 'sensitive-evidence',
      namespace: '/alpha/accounts/:userId/characters/:characterId',
      requiredPermission: 'alpha.skills.read',
      sectionId: 'skills',
      target: 'managed-organization-character',
    })
    declaration.permissions.push(permissionDeclaration('alpha.skills.read', ['hr']))
    declaration.server.resources[0]!.sectionId = 'skills'
    declaration.server.resources[0]!.eligibility = { kind: 'current-managed-member-character' }
    declaration.server.activityProviders[0]!.sectionId = 'overview'
    declaration.sections.push({ defaultEnabled: false, id: 'overview', kind: 'workspace' })
    declaration.nuxt.pages[0]!.sectionId = 'skills'
    declaration.nuxt.navigation[0]!.sectionId = 'skills'

    const files = generateRegistryFiles([declaration])
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "platformModuleRouteComposers['managed-organization-character']",
    )
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "publisherPackage: '@eve-space/alpha-manifest', moduleId: 'alpha', audience: 'hr', requiredPermission: 'alpha.skills.read', sectionId: 'skills', target: 'managed-organization-character', exposure: 'sensitive-evidence'",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "sectionId: 'skills'",
    )
    expect(files.get('api/src/generated/platform/installed-module-runtime.ts')).toContain(
      "moduleId: 'alpha', id: 'skills', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 2",
    )
    expect(files.get('generated/platform/installed-nuxt-contributions.ts')).toContain(
      '"target": "managed-organization-character"',
    )
    expect(files.get('generated/platform/installed-nuxt-contributions.ts')).toContain(
      '"requiredPermission": "alpha.skills.read"',
    )
    expect(files.get('generated/platform/installed-module-navigation.ts')).toContain(
      "sectionId: 'skills'",
    )
  })

  it('requires managed-member eligibility for sensitive character resources', () => {
    const invalid = actionManifest('alpha')
    invalid.server.resources[0]!.eligibility = { kind: 'current-owned-character' }

    expect(validationErrorMessage(invalid)).toContain(
      'resource alpha/alpha-resource in a sensitive-evidence section must use current-managed-member-character eligibility',
    )
  })

  it('rejects sensitive evidence activity providers outside audited reviewer routes', () => {
    const invalid = actionManifest('alpha')
    invalid.server.activityProviders[0]!.sectionId = 'evidence'

    expect(validationErrorMessage(invalid)).toContain(
      'activity provider alpha/alpha-activity cannot expose a sensitive-evidence section outside an audited reviewer route',
    )
  })

  it('retains reviewer classification for a sectionless account-search route', () => {
    const declaration = manifest('alpha')
    Object.assign(declaration.server.routes[0]!, {
      additionalRequiredPermissions: ['alpha.summary.read'],
      audience: 'hr',
      authorization: 'authenticated-session',
      exposure: 'standard',
      namespace: '/alpha/accounts',
      requiredPermission: 'alpha.search',
      target: 'managed-organization-account-search',
    })
    declaration.permissions.push(
      permissionDeclaration('alpha.search', ['hr']),
      permissionDeclaration('alpha.summary.read', ['hr']),
    )

    const routes = generateRegistryFiles([declaration]).get(
      'api/src/generated/platform/installed-module-routes.ts',
    )
    expect(routes).toContain("platformModuleRouteComposers['managed-organization-account-search']")
    expect(routes).toContain(
      "publisherPackage: '@eve-space/alpha-manifest', moduleId: 'alpha', audience: 'hr', requiredPermission: 'alpha.search', additionalRequiredPermissions: [\"alpha.summary.read\"] as const, target: 'managed-organization-account-search', exposure: 'standard'",
    )
  })

  it('requires account-search routes to declare a separate summary permission', () => {
    const invalid = manifest('alpha')
    Object.assign(invalid.server.routes[0]!, {
      audience: 'hr',
      authorization: 'authenticated-session',
      exposure: 'standard',
      namespace: '/alpha/accounts',
      target: 'managed-organization-account-search',
    })

    expect(validationErrorMessage(invalid)).toContain(
      'managed reviewer search route alpha/alpha-route must require a summary permission',
    )
  })

  it('requires exact search, summary, and sensitive section permissions', () => {
    const search = manifest('alpha')
    Object.assign(search.server.routes[0]!, {
      additionalRequiredPermissions: ['alpha.other'],
      audience: 'hr',
      authorization: 'authenticated-session',
      exposure: 'standard',
      namespace: '/alpha/accounts',
      requiredPermission: 'alpha.view',
      target: 'managed-organization-account-search',
    })
    const sensitive = actionManifest('alpha')
    Object.assign(sensitive.server.routes[0]!, {
      exposure: 'sensitive-evidence',
      namespace: '/alpha/accounts/:userId/evidence',
      requiredPermission: 'alpha.summary.read',
      sectionId: 'evidence',
    })

    expect(validationErrorMessage(search)).toContain(
      'managed reviewer search route alpha/alpha-route must require alpha.search',
    )
    expect(validationErrorMessage(search)).toContain(
      'managed reviewer search route alpha/alpha-route must additionally require alpha.summary.read',
    )
    expect(validationErrorMessage(sensitive)).toContain(
      'sensitive route alpha/alpha-route must require alpha.evidence.read',
    )
  })

  it('rejects generic persistence on managed reviewer routes', () => {
    const invalid = manifest('alpha', { persistenceOperation: {} })
    Object.assign(invalid.server.routes[0]!, {
      audience: 'hr',
      authorization: 'authenticated-session',
      exposure: 'standard',
      namespace: '/alpha/accounts/:userId',
      target: 'managed-organization-account',
    })

    expect(validationErrorMessage(invalid)).toContain(
      'managed reviewer route alpha/alpha-route cannot receive generic route persistence',
    )
  })

  it('requires reviewer evidence routes to reference an eligible character resource', () => {
    const invalid = manifest('alpha', { persistenceOperation: {} })
    invalid.sections = [
      {
        defaultEnabled: false,
        disclosureRevision: 1,
        id: 'evidence',
        kind: 'sensitive-evidence',
      },
    ]
    Object.assign(invalid.server.routes[0]!, {
      audience: 'hr',
      authorization: 'authenticated-session',
      exposure: 'sensitive-evidence',
      namespace: '/alpha/accounts/:userId/characters/:characterId/evidence',
      requiredPermission: 'alpha.evidence.read',
      reviewerEvidenceResourceId: 'alpha-resource',
      sectionId: 'evidence',
      target: 'managed-organization-character',
    })
    invalid.server.resources[0]!.sectionId = 'evidence'
    invalid.server.resources[0]!.eligibility = { kind: 'current-owned-character' }

    expect(validationErrorMessage(invalid)).toContain(
      'reviewer evidence route alpha/alpha-route resource alpha-resource must be a character resource with current-managed-member-character eligibility',
    )
  })

  it('requires managed reviewer routes to use reviewer authorization and target parameters', () => {
    const invalid = manifest('alpha')
    invalid.sections = [{ defaultEnabled: false, id: 'overview', kind: 'workspace' }]
    Object.assign(invalid.server.routes[0]!, {
      exposure: 'standard',
      namespace: '/alpha/review',
      sectionId: 'overview',
      target: 'managed-organization-character',
    })

    const message = validationErrorMessage(invalid)
    expect(message).toContain(
      'managed reviewer route alpha/alpha-route must use authenticated-session authorization',
    )
    expect(message).toContain(
      'managed reviewer route alpha/alpha-route must require an HR or director audience',
    )
    expect(message).toContain(
      'managed reviewer route alpha/alpha-route must include :userId in its namespace',
    )
    expect(message).toContain(
      'managed reviewer character route alpha/alpha-route must include :characterId in its namespace',
    )
  })

  it('defines exactly the four bounded organization command identities', () => {
    expect(platformOrganizationCommandIds).toStrictEqual([
      'assign-ordinary-group',
      'revoke-ordinary-group',
      'block-member',
      'unblock-member',
    ])
  })

  it('accepts exact organization commands on an access-management reviewer target route', () => {
    const declaration = actionManifest('member-audit')
    declaration.server.routes[0]!.organizationCommands = [
      'assign-ordinary-group',
      'revoke-ordinary-group',
    ]

    expect(() =>
      validatePlatformModuleManifests([declaration], coreModuleValidationAuthorities),
    ).not.toThrow()
  })

  it('accepts bounded organization commands from an external module', () => {
    const declaration = actionManifest('alpha')
    declaration.server.routes[0]!.organizationCommands = ['assign-ordinary-group']

    expect(() =>
      validatePlatformModuleManifests([declaration], coreModuleValidationAuthorities),
    ).not.toThrow()
  })

  it('enforces Member Audit as a closed reviewer-only section model', () => {
    const caller = actionManifest('member-audit')
    Object.assign(caller.server.routes[0]!, {
      audience: 'member',
      organizationCommands: undefined,
      requiredPermission: 'member-audit.search',
      sectionId: 'overview',
      target: 'caller',
    })
    const summary = actionManifest('member-audit')
    Object.assign(summary.server.routes[0]!, {
      organizationCommands: undefined,
      requiredPermission: 'member-audit.search',
      sectionId: 'overview',
      target: 'managed-organization-account',
    })
    ;(summary.server.resources[0] as { subjectKind: string }).subjectKind = 'organization'

    const callerMessage = validationErrorMessage(caller)
    expect(callerMessage).toContain(
      'Member Audit route member-audit/member-audit-route must declare a managed reviewer target',
    )
    expect(callerMessage).toContain(
      'Member Audit route member-audit/member-audit-route must require an HR or director audience',
    )
    const summaryMessage = validationErrorMessage(summary)
    expect(summaryMessage).toContain(
      'Member Audit account summary route member-audit/member-audit-route must require member-audit.summary.read',
    )
    expect(summaryMessage).toContain(
      'Member Audit sensitive resource member-audit/member-audit-resource must use a character subject',
    )
  })

  it('requires exactly the six reviewed Member Audit sections', () => {
    const valid = actionManifest('member-audit')
    expect(valid.sections?.map(({ id }) => id)).toStrictEqual([
      'overview',
      'skills',
      'assets',
      'wallet',
      'mail',
      'access-management',
    ])
    expect(valid.sections?.every(({ defaultEnabled }) => defaultEnabled === false)).toBe(true)

    const invalid = actionManifest('member-audit')
    invalid.sections = [
      ...invalid.sections!.filter(({ id }) => id !== 'mail'),
      { defaultEnabled: false, disclosureRevision: 1, id: 'contracts', kind: 'sensitive-evidence' },
    ]
    const message = validationErrorMessage(invalid)
    expect(message).toContain('module member-audit must declare section mail')
    expect(message).toContain('module member-audit cannot declare unsupported section contracts')
  })

  it('binds Member Audit resources to reviewed section operations and withholds ungated UI', () => {
    const declaration = actionManifest('member-audit')
    declaration.server.resources[0]!.operationId = 'mail-headers'
    declaration.server.esiOperations.push({
      exportName: 'competingOperation',
      id: 'competing-operation',
    })
    declaration.nuxt.pages.push({
      audience: 'authenticated',
      extensionPoint: 'root',
      file: 'src/runtime/app/pages/MemberAuditWorkspace.vue',
      id: 'workspace',
      name: 'eve-member-audit-workspace',
      path: '/member-audit',
      sectionId: 'overview',
    })

    const message = validationErrorMessage(declaration)
    expect(message).toContain(
      'Member Audit resource member-audit/member-audit-resource cannot use ESI operation mail-headers in section skills',
    )
    expect(message).toContain('module member-audit must reuse core ESI operation identities')
    expect(message).toContain(
      'module member-audit cannot register pages or navigation before a reviewer-aware Nuxt gate is available',
    )
  })

  it('aggregates malformed Member Audit section identities without reading inherited keys', () => {
    const declaration = actionManifest('member-audit')
    declaration.server.resources[0]!.sectionId = 'constructor'

    const message = validationErrorMessage(declaration)
    expect(message).toContain(
      'resource member-audit/member-audit-resource references unknown section constructor',
    )
    expect(message).toContain(
      'Member Audit resource member-audit/member-audit-resource cannot use ESI operation skills in section constructor',
    )
  })

  it('requires Member Audit command routes to use its exact action permission split', () => {
    const mixed = actionManifest('member-audit')
    mixed.server.routes[0]!.organizationCommands = ['assign-ordinary-group', 'block-member']
    const wrongPermission = actionManifest('member-audit')
    wrongPermission.server.routes[0]!.organizationCommands = ['block-member', 'unblock-member']

    expect(validationErrorMessage(mixed)).toContain(
      'route member-audit/member-audit-route cannot mix organization commands with different permissions',
    )
    expect(validationErrorMessage(wrongPermission)).toContain(
      'route member-audit/member-audit-route organization commands require permission member-audit.members.block',
    )
  })

  it('rejects unsupported and duplicate organization commands', () => {
    const invalid = actionManifest('alpha')
    ;(
      invalid.server.routes[0] as { organizationCommands: readonly string[] }
    ).organizationCommands = [
      'assign-ordinary-group',
      'assign-ordinary-group',
      'mutate-restricted-group',
    ]

    const message = validationErrorMessage(invalid)
    expect(message).toContain(
      'route alpha/alpha-route declares duplicate organization command assign-ordinary-group',
    )
    expect(message).toContain(
      'route alpha/alpha-route declares unsupported organization command mutate-restricted-group',
    )
  })

  it('rejects organization commands outside an access-management reviewer target route', () => {
    const callerRoute = manifest('alpha')
    callerRoute.server.routes[0]!.organizationCommands = ['block-member']
    const wrongSection = actionManifest('beta')
    wrongSection.server.routes[0]!.organizationCommands = ['unblock-member']
    wrongSection.sections = [
      { defaultEnabled: false, id: 'access-management', kind: 'workspace' },
      wrongSection.sections![1]!,
    ]

    const message = validationErrorMessage([callerRoute, wrongSection])
    expect(message).toContain(
      'route alpha/alpha-route organization commands require a managed reviewer target',
    )
    expect(message).toContain(
      'route alpha/alpha-route organization commands require an access-management section',
    )
    expect(message).toContain(
      'route beta/beta-route organization commands require an access-management section',
    )
  })

  it('retains exact organization command declarations in generated route metadata', () => {
    const declaration = actionManifest('member-audit')
    declaration.server.routes[0]!.organizationCommands = [
      'assign-ordinary-group',
      'revoke-ordinary-group',
    ]

    const files = generateRegistryFiles([declaration])
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      'organizationCommands: ["assign-ordinary-group","revoke-ordinary-group"] as const',
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

  it('rejects invalid server and Nuxt package coordinates', () => {
    const invalid = manifest('alpha')
    invalid.server.package = '../wrong-server'
    invalid.nuxt.package = 'HTTPS://registry.test/wrong-nuxt'

    const message = validationErrorMessage(invalid)
    for (const fragment of [
      'server package must be a valid npm package name',
      'Nuxt package must be a valid npm package name',
    ]) {
      expect(message).toContain(fragment)
    }
  })

  it('rejects unsupported resource eligibility and scheduling metadata', () => {
    const invalid = manifest('alpha', {
      resource: {
        eligibility: { kind: 'module-callback' } as never,
        materializationIntervalSeconds: 0,
        subjectKind: 'solar-system' as never,
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
        eligibility: { kind: eligibilityKind },
        exportName: 'alphaResource',
        id: 'alpha-resource',
        materializationIntervalSeconds: 900,
        operationId: 'alpha-operation',
        persistence: { materialization: [], projection: [] },
        subjectKind,
      },
    ]

    expect(() =>
      validatePlatformModuleManifests([declaration], coreModuleValidationAuthorities),
    ).not.toThrow()
  })

  it('rejects a legal resource eligibility paired with the wrong subject kind', () => {
    const invalid = manifest('alpha', {
      resource: {
        eligibility: { kind: 'current-owned-character' } as never,
        subjectKind: 'alliance' as never,
      },
    })

    expect(validationErrorMessage(invalid)).toContain(
      'eligibility current-owned-character is incompatible with subject kind alliance; expected current-managed-alliance',
    )
  })

  it('validates and renders a pure batch resource descriptor', () => {
    const declaration = manifest('alpha')
    declaration.server.esiOperations.push({
      exportName: 'alphaBatchOperation',
      id: 'alpha-batch',
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
      resource: { coreDataProducts: ['published-type-groups'] },
      route: { coreDataProducts: ['published-type-groups'] },
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
            route: { authorization: 'authenticated-session', namespace: '/alpha' },
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
        audience: 'member',
        authorization: 'authenticated-session',
        exportName: 'firstRoutes',
        id: 'first-route',
        namespace: '/alpha/items/:id',
        requiredPermission: 'alpha.view',
      },
      {
        audience: 'member',
        authorization: 'authenticated-session',
        exportName: 'secondRoutes',
        id: 'second-route',
        namespace: '/alpha/items/:itemId',
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
      route: { authorization: 'authenticated-session', namespace: first },
    })
    invalid.server.routes.push({
      audience: 'member',
      authorization: 'owned-character',
      exportName: 'ownedCharacterRoutes',
      id: 'owned-character-route',
      namespace: second,
      persistenceOperations: [],
      requiredPermission: 'alpha.view',
    })

    expect(() => generateRegistryFiles([invalid])).toThrow(
      `module route coordinates /api/modules${first} and /api/modules${second} overlap in module alpha`,
    )
  })

  it('allows disjoint authorization namespaces in one module', () => {
    const valid = manifest('alpha', {
      route: { authorization: 'authenticated-session', namespace: '/alpha/profile' },
    })
    valid.server.routes.push({
      audience: 'member',
      authorization: 'owned-character',
      exportName: 'ownedCharacterRoutes',
      id: 'owned-character-route',
      namespace: '/alpha/characters/:characterId',
      persistenceOperations: [],
      requiredPermission: 'alpha.view',
    })

    expect(() => generateRegistryFiles([valid])).not.toThrow()
  })
})

describe('platform module registry generation', () => {
  it('emits stable zero-feature registries', () => {
    const first = generateRegistryFiles([])
    const second = generateRegistryFiles([])

    expect([...first]).toStrictEqual([...second])
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
    expect(first.get('generated/platform/installed-nuxt-contributions.ts')).toContain(
      'installedNuxtContributions =\n  [] as const satisfies readonly PlatformNuxtContributionDescriptor[]',
    )
    expect(first.get('api/src/generated/platform/installed-reviewer-contributions.ts')).toContain(
      'installedReviewerContributions =\n  [] as const satisfies readonly PlatformInstalledReviewerContributionDescriptor[]',
    )
  })

  it('generates an exact path-free reviewer contribution catalog', () => {
    const declaration = authoringManifest('alpha')
    declaration.sections = [
      { defaultEnabled: false, id: 'overview', kind: 'workspace' },
      {
        defaultEnabled: false,
        disclosureRevision: 1,
        id: 'evidence',
        kind: 'sensitive-evidence',
      },
    ]
    declaration.server.routes[0]!.sectionId = 'overview'
    declaration.server.resources[0]!.sectionId = 'evidence'
    declaration.server.resources[0]!.eligibility = { kind: 'current-managed-member-character' }
    declaration.server.activityProviders[0]!.sectionId = 'overview'
    declaration.nuxt.pages[0]!.sectionId = 'overview'
    declaration.nuxt.navigation[0]!.sectionId = 'overview'

    const files = generateRegistryFiles([declaration])
    const catalog = files.get('api/src/generated/platform/installed-reviewer-contributions.ts')
    const nuxtCatalog = files.get('generated/platform/installed-nuxt-contributions.ts')
    const routes = files.get('api/src/generated/platform/installed-module-routes.ts')

    expect(catalog).toContain(
      JSON.stringify(
        [
          {
            audience: 'hr',
            contributionId: 'overview',
            description: 'Review a managed member.',
            icon: 'overview',
            label: 'Overview',
            moduleId: 'alpha',
            order: 10,
            panelExport: './reviewer/overview',
            panelPackage: '@eve-space/alpha-nuxt',
            publisherPackage: '@eve-space/alpha-manifest',
            requiredPermission: 'alpha.review',
            routeId: 'alpha-route',
            routePath: '/api/modules/alpha/accounts/:userId',
            sectionId: 'overview',
            target: 'managed-organization-account',
          },
        ],
        undefined,
        2,
      ),
    )
    expect(catalog).not.toContain("from '@eve-space/alpha-nuxt'")
    expect(catalog).not.toContain("from '@eve-space/alpha-server'")
    expectInOrder(nuxtCatalog, [
      '"reviewerContributions": [',
      '"audience": "hr"',
      '"contributionId": "overview"',
      '"description": "Review a managed member."',
      '"icon": "overview"',
      '"label": "Overview"',
      '"order": 10',
      '"panelExport": "./reviewer/overview"',
      '"requiredPermission": "alpha.review"',
      '"routeId": "alpha-route"',
      '"routePath": "/api/modules/alpha/accounts/:userId"',
      '"sectionId": "overview"',
      '"target": "managed-organization-account"',
    ])
    expect(nuxtCatalog).toContain('"queryAdmissionScopes": [')
    expect(routes).toContain('createPlatformReviewerContributionRouteCapabilities(')
    expect(routes).toContain('composePlatformReviewerContributionRoute(')
    expect(routes).toContain('installedReviewerContributions[0]!')
    expect(routes).toContain("routeId: 'alpha-route', namespace: '/alpha/accounts/:userId'")
    expect(routes).not.toContain("platformModuleRouteComposers['managed-organization-account']")
  })

  it('sorts reviewer contributions by order and stable identity', () => {
    const alpha = authoringManifest('alpha')
    const beta = authoringManifest('beta')
    alpha.reviewerContributions![0]!.id = 'alpha-overview'
    alpha.reviewerContributions![0]!.order = 20
    beta.reviewerContributions![0]!.id = 'beta-overview'

    const catalog = generateRegistryFiles([alpha, beta]).get(
      'api/src/generated/platform/installed-reviewer-contributions.ts',
    )

    expectInOrder(catalog, [
      '"contributionId": "beta-overview"',
      '"contributionId": "alpha-overview"',
    ])
    expect(
      generateRegistryFiles([beta, alpha]).get(
        'api/src/generated/platform/installed-reviewer-contributions.ts',
      ),
    ).toBe(catalog)
    const routes = generateRegistryFiles([alpha, beta]).get(
      'api/src/generated/platform/installed-module-routes.ts',
    )
    expect(routes).toContain(
      'createPlatformReviewerContributionRouteCapabilities(installedReviewerContributions[1]!',
    )
    expect(routes).toContain(
      'createPlatformReviewerContributionRouteCapabilities(installedReviewerContributions[0]!',
    )
    expect(routes).not.toContain('dispatch')
  })

  it('generates canonical persistence bindings and exact contribution grants', async () => {
    const declaration = manifest('alpha', { persistenceOperation: {} })
    const routine = await canonicalizePersistenceRoutineSql({
      mode: 'read',
      moduleId: 'alpha',
      operationId: 'alpha-read',
      revision: 1,
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
      'grants: {"activityProviders":["alpha-activity"],"resourceMaterializations":[],"resourceProjections":["alpha-resource"],"routes":["alpha-route"]}',
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
    expect(persistence).toContain('export type InstalledModuleResourceProjectionPersistence<')
    expect(persistence).toContain('export type InstalledModuleResourceMaterializationPersistence<')
    expect(persistence).not.toContain("'saveSnapshot': bindPlatformPersistenceOperation")
    expect(persistence).not.toContain('operationId: string')
  })

  it('sorts modules and navigation independently of input order', () => {
    const alpha = manifest('alpha', { navigation: { order: 20 } })
    const beta = manifest('beta', { navigation: { order: 10 } })

    expect([...generateRegistryFiles([alpha, beta])]).toStrictEqual([
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
    expect(api).toContain(
      "{ publisherPackage: '@eve-space/alpha-manifest', moduleId: 'alpha', audience: 'member', requiredPermission: 'alpha.view' }",
    )
    expectInOrder(api, [
      "platformModuleRouteComposers['owned-character'](",
      "'alpha'",
      "{ publisherPackage: '@eve-space/alpha-manifest', moduleId: 'alpha', audience: 'member', requiredPermission: 'alpha.view' }",
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
      audience: 'hr',
      authorization: 'authenticated-session',
      exportName: 'alphaSummaryRoutes',
      id: 'alpha-summary',
      namespace: '/alpha/summary',
      persistenceOperations: [],
      requiredPermission: 'alpha.summary',
    })
    alpha.permissions.push(permissionDeclaration('alpha.summary', ['hr']))

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
      "{ publisherPackage: '@eve-space/alpha-manifest', moduleId: 'alpha', audience: 'hr', requiredPermission: 'alpha.summary' }",
      'module0Route1',
    ])
  })

  it('emits each contribution exact core-data product declaration', () => {
    const declaration = manifest('alpha', {
      resource: { coreDataProducts: ['published-type-groups'] },
      route: { coreDataProducts: ['published-type-groups'] },
    })
    const files = generateRegistryFiles([declaration])

    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "createPlatformModuleRouteCapabilities('alpha', 'alpha-route', [\"published-type-groups\"] as const)",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'coreDataProducts: ["published-type-groups"] as const',
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "implementation: module0Resource0 satisfies PlatformResourceImplementationForContract<typeof module0Resource0, 'alpha-operation', PlatformEsiOperationProtocol<'alpha-operation'>, readonly [\"published-type-groups\"], InstalledModuleResourceProjectionPersistence<'alpha/alpha-resource'>, InstalledModuleResourceMaterializationPersistence<'alpha/alpha-resource'>>",
    )
    expect(
      files.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain('coreDataProducts: [] as const')
  })

  it('binds each resource to its exact catalog-derived root and dependent protocol', () => {
    const declaration = manifest('alpha', {
      resource: { dependentOperationIds: ['universe-resolve-names', 'alpha-operation'] },
    })
    const worker = generateRegistryFiles([declaration]).get(
      'api/src/generated/platform/installed-module-worker.ts',
    )

    expect(worker).toContain(
      "import type { PlatformEsiOperationProtocol } from '../../esi-gateway/catalog-interface.js'",
    )
    expect(worker).toContain(
      "implementation: module0Resource0 satisfies PlatformResourceImplementationForContract<typeof module0Resource0, 'alpha-operation', PlatformEsiOperationProtocol<'alpha-operation' | 'universe-resolve-names'>, readonly [], ",
    )
    expect(worker).not.toContain('PlatformResourceImplementationForCapabilities')
    expect(
      generateRegistryFiles([declaration]).get(
        'api/src/generated/platform/installed-module-worker.ts',
      ),
    ).toBe(worker)
  })

  it('generates lazy activity providers with authorization and same-module pages', () => {
    const providers = generateRegistryFiles([manifest('alpha')]).get(
      'api/src/generated/platform/installed-module-activity-providers.ts',
    )

    expect(providers).toContain(
      "import { alphaActivityProvider as module0ActivityProvider0Factory } from '@eve-space/alpha-server'",
    )
    expect(providers).toContain("moduleId: 'alpha', providerId: 'alpha-activity'")
    expect(providers).toContain("publisherPackage: '@eve-space/alpha-manifest'")
    expect(providers).toContain("audience: 'member', requiredPermission: 'alpha.view'")
    expect(providers).toContain("pageIds: ['alpha-page']")
    expect(providers).toContain(
      "invoke: (context) => module0ActivityProvider0Factory(createPlatformModuleActivityProviderCapabilities('alpha', 'alpha-activity', context, [] as const, undefined))(context)",
    )
  })

  it('generates deduplicated organization admission scopes from routes and activity providers', () => {
    const runtime = generateRegistryFiles([manifest('alpha')]).get(
      'api/src/generated/platform/installed-module-runtime.ts',
    )

    expect(runtime).toContain('installedModuleOrganizationAdmissionScopes')
    expect(runtime?.match(/organization:v1:alpha:member:alpha\.view/g)).toHaveLength(1)
  })

  it('combines ESI operation imports from the same server package', () => {
    const declaration = manifest('alpha')
    declaration.server.esiOperations.push({
      exportName: 'alphaSecondaryOperation',
      id: 'alpha-secondary-operation',
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
      audience: 'member',
      authorization: 'authenticated-session',
      exportName: 'alphaSecondaryRoutes',
      id: 'alpha-secondary-route',
      namespace: '/alpha/secondary',
      persistenceOperations: [],
      requiredPermission: 'alpha.view',
    })
    declaration.server.resources.push({
      dependentOperationIds: [],
      eligibility: { kind: 'current-owned-character' },
      exportName: 'alphaSecondaryResource',
      id: 'alpha-secondary-resource',
      materializationIntervalSeconds: 900,
      operationId: 'alpha-operation',
      persistence: { materialization: [], projection: [] },
      subjectKind: 'character',
    })
    declaration.server.activityProviders.push({
      audience: 'member',
      exportName: 'alphaSecondaryActivityProvider',
      freshness: { staleAfterSeconds: 900 },
      id: 'alpha-secondary-activity',
      persistenceOperations: [],
      requiredPermission: 'alpha.view',
    })

    const files = generateRegistryFiles([declaration])
    for (const path of [
      'api/src/generated/platform/installed-module-routes.ts',
      'api/src/generated/platform/installed-module-worker.ts',
      'api/src/generated/platform/installed-module-activity-providers.ts',
      'api/src/generated/platform/installed-module-esi.ts',
    ]) {
      expect(files.get(path)?.match(/from '@eve-space\/alpha-server'/g)).toHaveLength(1)
    }
  })

  it('aliases repeated package export names in every generated server registry', () => {
    const alpha = manifest('alpha', {
      activityProvider: { exportName: 'activityProvider' },
      operation: { exportName: 'operation' },
      resource: { exportName: 'resource' },
      route: { exportName: 'routes' },
    })
    const beta = manifest('beta', {
      activityProvider: { exportName: 'activityProvider' },
      operation: { exportName: 'operation' },
      resource: { exportName: 'resource' },
      route: { exportName: 'routes' },
    })
    const files = generateRegistryFiles([beta, alpha])

    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "import { routes as module0Route0Factory } from '@eve-space/alpha-server'",
    )
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "import { routes as module1Route0Factory } from '@eve-space/beta-server'",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "({ moduleId: 'alpha', resourceId: 'alpha-resource', operationId: 'alpha-operation', coreDataProducts: [] as const, subjectKind: 'character', materializationIntervalSeconds: 900, eligibility: { kind: 'current-owned-character' }, persistence: {\"materialization\":[],\"projection\":[]} as const, implementation: module0Resource0 satisfies PlatformResourceImplementationForContract<typeof module0Resource0, 'alpha-operation', PlatformEsiOperationProtocol<'alpha-operation'>, readonly [], InstalledModuleResourceProjectionPersistence<'alpha/alpha-resource'>, InstalledModuleResourceMaterializationPersistence<'alpha/alpha-resource'>> } as const)",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "({ moduleId: 'beta', resourceId: 'beta-resource', operationId: 'beta-operation', coreDataProducts: [] as const, subjectKind: 'character', materializationIntervalSeconds: 900, eligibility: { kind: 'current-owned-character' }, persistence: {\"materialization\":[],\"projection\":[]} as const, implementation: module1Resource0 satisfies PlatformResourceImplementationForContract<typeof module1Resource0, 'beta-operation', PlatformEsiOperationProtocol<'beta-operation'>, readonly [], InstalledModuleResourceProjectionPersistence<'beta/beta-resource'>, InstalledModuleResourceMaterializationPersistence<'beta/beta-resource'>> } as const)",
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

describe('resolved module releases', () => {
  it('resolves package exports and emits deterministic path-free provenance', async () => {
    const root = await createResolvedReleaseFixture()
    try {
      const { compiled, releases } = resolveInstalledModuleReleases(root)
      const files = renderRegistryFiles(compiled, [], releases)
      const inventory = files.get('api/src/generated/platform/installed-module-inventory.ts') ?? ''

      expect(releases).toHaveLength(1)
      expect(releases[0]).toMatchObject({
        manifestExport: './manifest',
        moduleId: 'alpha',
        packages: {
          manifest: { integrity: 'workspace', name: '@example/alpha-manifest', version: '1.2.3' },
          nuxt: { integrity: 'workspace', name: '@example/alpha-nuxt', version: '1.2.3' },
          server: { integrity: 'workspace', name: '@example/alpha-server', version: '1.2.3' },
        },
        publisherPackage: '@example/alpha-manifest',
        version: '1.2.3',
      })
      expect(inventory).toContain('"publisherPackage": "@example/alpha-manifest"')
      expect(inventory).toContain('"releaseVersion": "1.2.3"')
      expect(inventory).not.toContain(root)
      expect(inventory).not.toContain('node_modules')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('forwards a custom manifest export into host artifact verification', async () => {
    const root = await createResolvedReleaseFixture({
      manifestPackageExport: './release-manifest',
      selectionExport: './release-manifest',
    })
    try {
      const registry = await loadInstalledModuleManifests(root)

      expect(registry.releases[0]?.manifestExport).toBe('./release-manifest')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('uses installed artifacts rather than publisher source as host acceptance authority', async () => {
    const root = await createResolvedReleaseFixture({ sourceOnlyViolation: true })
    try {
      await expect(loadInstalledModuleManifests(root)).resolves.toMatchObject({
        releases: [expect.objectContaining({ moduleId: 'alpha' })],
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('rejects artifact defects during host loading', async () => {
    const root = await createResolvedReleaseFixture({ serverSideEffects: true })
    try {
      await expect(loadInstalledModuleManifests(root)).rejects.toThrow(
        'PACKAGE_SIDE_EFFECTS_INVALID',
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it.each([
    ['unresolved manifest export', { selectionExport: './missing' }, 'does not export ./missing'],
    [
      'manifest export escape',
      { manifestExportTarget: '../manifest.json' },
      'escapes its package root',
    ],
    [
      'package-version skew',
      { serverVersion: '1.2.4' },
      'does not match @example/alpha-server@1.2.4',
    ],
    [
      'lockfile skew',
      { serverLockTarget: '../features/alpha/nuxt' },
      'differs from the resolved package',
    ],
    ['missing artifact', { omitMigration: true }, 'is missing migration alpha-001-initial.sql'],
    ['extra artifact', { extraMigration: true }, 'migration artifacts differ from its manifest'],
    [
      'changed package ownership',
      { declaredServerName: '@example/changed-server' },
      'declares changed ownership',
    ],
    [
      'duplicate module IDs',
      { duplicateSelection: true },
      'Duplicate installed module selection alpha',
    ],
    [
      'cross-role dependency',
      { apiIncludesNuxt: true },
      'API dependencies must not include module package @example/alpha-nuxt',
    ],
  ] as const)('rejects %s', async (_label, options, expected) => {
    const root = await createResolvedReleaseFixture(options)
    try {
      expect(() => resolveInstalledModuleReleases(root)).toThrow(expected)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it.each(['9.0', '11.0'] as const)(
    'resolves local file archives from pnpm %s lock identities',
    async (lockfileVersion) => {
      const root = await createResolvedReleaseFixture({ lockfileVersion, serverArchive: true })
      try {
        const { compiled, releases } = resolveInstalledModuleReleases(root)
        const inventory =
          renderRegistryFiles(compiled, [], releases).get(
            'api/src/generated/platform/installed-module-inventory.ts',
          ) ?? ''

        expect(releases[0]?.packages.server).toMatchObject({
          integrity: 'sha512-file-archive-fixture',
          version: '1.2.3',
          workspace: false,
        })
        expect(inventory).not.toContain('alpha-server.tgz')
        expect(inventory).not.toContain(root)
      } finally {
        await rm(root, { force: true, recursive: true })
      }
    },
  )

  it.each([
    [
      'missing file archive integrity',
      { omitArchiveIntegrity: true, serverArchive: true },
      'Lockfile integrity for @example/alpha-server@1.2.3 is missing',
    ],
    [
      'file archive release-version skew',
      { serverArchive: true, serverVersion: '1.2.4' },
      'does not match @example/alpha-server@1.2.4',
    ],
  ] as const)('rejects %s without exposing archive paths', async (_label, options, expected) => {
    const root = await createResolvedReleaseFixture(options)
    try {
      let message = ''
      try {
        resolveInstalledModuleReleases(root)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain(expected)
      expect(message).not.toContain('alpha-server.tgz')
      expect(message).not.toContain(root)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('feature server import boundaries', () => {
  it('allows package-local and shared platform imports', () => {
    expect(
      moduleServerImportViolations([
        {
          path: 'features/alpha/server/src/index.ts',
          source: `
            import type { OwnedCharacterCoreReads } from '@eve-space/platform-module-contract/server'
            export { loadSnapshot } from './snapshot.js'
          `,
        },
      ]),
    ).toStrictEqual([])
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

  it('discovers every executable server source extension and rejects CommonJS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-module-boundaries-'))
    const sourceDirectory = join(root, 'features', 'alpha', 'server', 'src')
    expect(moduleServerSourceExtensions).toStrictEqual([
      '.cjs',
      '.cts',
      '.js',
      '.jsx',
      '.mjs',
      '.mts',
      '.ts',
      '.tsx',
    ])
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
      ).toStrictEqual(
        extensions
          .map((extension) => `features/alpha/server/src/forbidden.${extension}`)
          .toSorted((left, right) => left.localeCompare(right)),
      )
      expect(
        moduleServerImportViolations(sources).filter((violation) =>
          violation.includes('feature server code cannot import core API source'),
        ),
      ).toHaveLength(extensions.length)
      expect(
        moduleServerImportViolations(sources).filter((violation) =>
          violation.includes('must use ESM source files'),
        ),
      ).toHaveLength(2)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})

interface ResolvedReleaseFixtureOptions {
  readonly selectionExport?: string
  readonly manifestPackageExport?: string
  readonly manifestExportTarget?: string
  readonly serverVersion?: string
  readonly serverLockTarget?: string
  readonly omitMigration?: boolean
  readonly extraMigration?: boolean
  readonly declaredServerName?: string
  readonly duplicateSelection?: boolean
  readonly apiIncludesNuxt?: boolean
  readonly serverArchive?: boolean
  readonly omitArchiveIntegrity?: boolean
  readonly lockfileVersion?: '9.0' | '11.0'
  readonly serverSideEffects?: boolean
  readonly sourceOnlyViolation?: boolean
}

async function createResolvedReleaseFixture(options: ResolvedReleaseFixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eve-space-resolved-release-'))
  const manifestRoot = join(root, 'features/alpha/manifest')
  const serverRoot = join(root, 'features/alpha/server')
  const nuxtRoot = join(root, 'features/alpha/nuxt')
  const selection = {
    manifest: {
      export: options.selectionExport ?? './manifest',
      package: '@example/alpha-manifest',
    },
    moduleId: 'alpha',
  }
  const manifestArtifact = {
    defaultEnabled: true,
    icon: 'corporation',
    id: 'alpha',
    nuxt: { navigation: [], package: '@example/alpha-nuxt', pages: [] },
    release: {
      hostContractRange: '^1.0.0',
      publisherPackage: '@example/alpha-manifest',
      version: '1.2.3',
    },
    server: {
      activityProviders: [],
      esiOperations: [],
      migrations: [{ name: 'alpha-001-initial.sql' }],
      package: '@example/alpha-server',
      persistenceOperations: [],
      resources: [],
      routes: [],
    },
  }
  const rootDependencies = {
    '@example/alpha-manifest': 'workspace:*',
    '@example/alpha-nuxt': 'workspace:*',
  }
  const archiveReference = 'file:archives/alpha-server.tgz'
  const apiDependencies = {
    '@example/alpha-server': options.serverArchive ? archiveReference : 'workspace:*',
    ...(options.apiIncludesNuxt && { '@example/alpha-nuxt': 'workspace:*' }),
  }

  const files = new Map(
    Object.entries({
      'api/package.json': `${JSON.stringify(
        { name: 'fixture-api', private: true, dependencies: apiDependencies },
        null,
        2,
      )}\n`,
      'features/alpha/manifest/manifest.json': `${JSON.stringify(manifestArtifact, null, 2)}\n`,
      'features/alpha/manifest/package.json': `${JSON.stringify(
        {
          name: '@example/alpha-manifest',
          version: '1.2.3',
          type: 'module',
          sideEffects: false,
          exports: {
            [options.manifestPackageExport ?? './manifest']:
              options.manifestExportTarget ?? './manifest.json',
          },
          files: ['manifest.json'],
        },
        null,
        2,
      )}\n`,
      'features/alpha/nuxt/dist/module.d.ts':
        'declare const module: object\nexport default module\n',
      'features/alpha/nuxt/dist/module.js': 'export default {}\n',
      'features/alpha/nuxt/package.json': `${JSON.stringify(
        {
          name: '@example/alpha-nuxt',
          version: '1.2.3',
          type: 'module',
          sideEffects: ['**/*.vue'],
          exports: {
            '.': { types: './dist/module.d.ts', import: './dist/module.js' },
          },
          files: ['dist'],
        },
        null,
        2,
      )}\n`,
      'features/alpha/server/dist/index.d.ts': 'export {}\n',
      'features/alpha/server/dist/index.js': '',
      'features/alpha/server/package.json': `${JSON.stringify(
        {
          name: options.declaredServerName ?? '@example/alpha-server',
          version: options.serverVersion ?? '1.2.3',
          type: 'module',
          sideEffects: options.serverSideEffects ?? false,
          exports: {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './migrations/*': './migrations/*',
          },
          files: ['dist', 'migrations'],
        },
        null,
        2,
      )}\n`,
      'features/installed-modules.json': `${JSON.stringify(
        { modules: options.duplicateSelection ? [selection, selection] : [selection] },
        null,
        2,
      )}\n`,
      'package.json': `${JSON.stringify(
        { name: 'fixture-host', private: true, dependencies: rootDependencies },
        null,
        2,
      )}\n`,
      'pnpm-lock.yaml': resolvedReleaseLockfile(options, archiveReference),
    }),
  )
  if (!options.omitMigration) {
    files.set('features/alpha/server/migrations/alpha-001-initial.sql', 'select 1;\n')
  }
  if (options.extraMigration) {
    files.set('features/alpha/server/migrations/alpha-002-extra.sql', 'select 2;\n')
  }
  if (options.sourceOnlyViolation) {
    files.set('features/alpha/server/src/unsafe.ts', "import postgres from 'postgres'\n")
  }

  await Promise.all(
    [...files].map(async ([path, source]) => {
      const output = join(root, path)
      await mkdir(join(output, '..'), { recursive: true })
      await writeFile(output, source)
    }),
  )
  await Promise.all([
    linkFixturePackage(root, manifestRoot, '@example/alpha-manifest'),
    linkFixturePackage(root, nuxtRoot, '@example/alpha-nuxt'),
    linkFixturePackage(join(root, 'api'), serverRoot, '@example/alpha-server'),
  ])
  return root
}

function resolvedReleaseLockfile(options: ResolvedReleaseFixtureOptions, archiveReference: string) {
  const serverSpecifier = options.serverArchive ? archiveReference : 'workspace:*'
  const linkedServer = `link:${options.serverLockTarget ?? '../features/alpha/server'}`
  const serverVersion = options.serverArchive ? archiveReference : linkedServer
  const nuxtDependency = options.apiIncludesNuxt
    ? "      '@example/alpha-nuxt':\n        specifier: workspace:*\n        version: link:../features/alpha/nuxt\n"
    : ''
  const integrity = options.omitArchiveIntegrity
    ? ''
    : '      integrity: sha512-file-archive-fixture\n'
  const archiveEntries = options.serverArchive
    ? `packages:
  '@example/alpha-server@${archiveReference}':
    resolution:
${integrity}      tarball: ${archiveReference}
    version: ${options.serverVersion ?? '1.2.3'}
snapshots:
  '@example/alpha-server@${archiveReference}': {}
`
    : ''
  return `lockfileVersion: '${options.lockfileVersion ?? '9.0'}'
importers:
  .:
    dependencies:
      '@example/alpha-manifest':
        specifier: workspace:*
        version: link:features/alpha/manifest
      '@example/alpha-nuxt':
        specifier: workspace:*
        version: link:features/alpha/nuxt
  api:
    dependencies:
      '@example/alpha-server':
        specifier: ${serverSpecifier}
        version: ${serverVersion}
${nuxtDependency}${archiveEntries}`
}

async function linkFixturePackage(hostRoot: string, packageRoot: string, packageName: string) {
  const link = join(hostRoot, 'node_modules', ...packageName.split('/'))
  await mkdir(join(link, '..'), { recursive: true })
  await symlink(packageRoot, link, 'dir')
}

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
        exportName: `${camelCase(id)}ReadOperation`,
        id: `${id}-read`,
        method: `${camelCase(id)}Read`,
        migration: `${id}-001-initial.sql`,
        mode: 'read' as const,
        revision: 1,
        ...overrides.persistenceOperation,
      }
    : undefined
  return {
    defaultEnabled: overrides.defaultEnabled ?? false,
    icon: overrides.moduleIcon ?? 'character',
    id,
    nuxt: {
      exposed: overrides.exposed,
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
    },
    permissions: [
      {
        key: `${id}.view`,
        label: 'View module data',
        purpose: 'View module data made available to the selected audience.',
        audiences: ['member', 'hr', 'director'],
        sensitivity: 'standard',
        reviewAllowed: false,
      },
    ],
    release: {
      hostContractRange: '^1.0.0',
      publisherPackage: `@eve-space/${id}-manifest`,
      version: '0.1.0',
    },
    server: {
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
      esiOperations: [
        {
          id: operationId,
          exportName: `${camelCase(id)}Operation`,
          ...overrides.operation,
        },
      ],
      migrations: [{ name: `${id}-001-initial.sql`, ...overrides.migration }],
      package: `@eve-space/${id}-server`,
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
    },
  }
}

function authoringManifest(id: string, overrides: ManifestOverrides = {}): PlatformModuleManifest {
  const declaration = manifest(id, overrides)
  Object.assign(declaration.server.routes[0]!, {
    audience: 'hr',
    authorization: 'authenticated-session',
    exposure: 'standard',
    namespace: `/${id}/accounts/:userId`,
    requiredPermission: `${id}.review`,
    target: 'managed-organization-account',
  })
  declaration.permissions = [
    {
      audiences: ['hr'],
      key: 'member-audit.groups.manage',
      label: 'Manage ordinary groups',
      purpose: 'Assign and revoke ordinary groups for managed members.',
      reviewAllowed: false,
      sensitivity: 'sensitive',
    },
    ...(id === 'member-audit'
      ? []
      : [
          {
            audiences: ['member' as const],
            key: `${id}.view`,
            label: 'View module data',
            purpose: 'View module data made available to members.',
            reviewAllowed: false,
            sensitivity: 'standard' as const,
          },
        ]),
  ]
  declaration.permissions = [
    {
      audiences: ['member', 'hr'],
      key: `${id}.view`,
      label: 'View activity',
      purpose: 'View member-safe activity.',
      reviewAllowed: true,
      sensitivity: 'standard',
    },
    {
      audiences: ['hr'],
      key: `${id}.review`,
      label: 'Review members',
      purpose: 'Review one managed member.',
      reviewAllowed: false,
      sensitivity: 'sensitive',
    },
  ]
  declaration.permissionProfiles = [
    {
      audiences: ['hr'],
      description: 'Suggested least-privilege reviewer access.',
      id: 'reviewer',
      label: 'Reviewer',
      permissions: [`${id}.review`],
    },
  ]
  declaration.reviewerContributions = [
    {
      audience: 'hr',
      description: 'Review a managed member.',
      icon: 'overview',
      id: 'overview',
      label: 'Overview',
      order: 10,
      panelExport: './reviewer/overview',
      requiredPermission: `${id}.review`,
      routeId: `${id}-route`,
      target: 'managed-organization-account',
    },
  ]
  return declaration
}

function actionManifest(id: string) {
  const declaration = manifest(id)
  if (id === 'member-audit') {
    declaration.permissions.push(
      permissionDeclaration('member-audit.groups.manage', ['hr'], 'sensitive'),
    )
  }
  declaration.sections =
    id === 'member-audit'
      ? [
          { defaultEnabled: false, id: 'overview', kind: 'workspace' },
          {
            defaultEnabled: false,
            disclosureRevision: 1,
            id: 'skills',
            kind: 'sensitive-evidence',
          },
          {
            defaultEnabled: false,
            disclosureRevision: 1,
            id: 'assets',
            kind: 'sensitive-evidence',
          },
          {
            defaultEnabled: false,
            disclosureRevision: 1,
            id: 'wallet',
            kind: 'sensitive-evidence',
          },
          {
            defaultEnabled: false,
            disclosureRevision: 1,
            id: 'mail',
            kind: 'sensitive-evidence',
          },
          { defaultEnabled: false, id: 'access-management', kind: 'access-management' },
        ]
      : [
          { defaultEnabled: false, id: 'access-management', kind: 'access-management' },
          {
            defaultEnabled: false,
            disclosureRevision: 1,
            id: 'evidence',
            kind: 'sensitive-evidence',
          },
        ]
  Object.assign(declaration.server.routes[0]!, {
    audience: 'hr',
    authorization: 'authenticated-session',
    exposure: 'standard',
    namespace: `/${id}/accounts/:userId/actions`,
    requiredPermission: id === 'member-audit' ? 'member-audit.groups.manage' : `${id}.view`,
    sectionId: 'access-management',
    target: 'managed-organization-account',
  })
  declaration.server.resources[0]!.sectionId = id === 'member-audit' ? 'skills' : 'evidence'
  declaration.server.resources[0]!.eligibility = { kind: 'current-managed-member-character' }
  declaration.server.activityProviders[0]!.sectionId = 'access-management'
  declaration.nuxt.pages[0]!.sectionId = 'access-management'
  declaration.nuxt.navigation[0]!.sectionId = 'access-management'
  if (id === 'member-audit') {
    declaration.server.activityProviders = []
    declaration.server.esiOperations = []
    declaration.server.resources[0]!.operationId = 'skills'
    declaration.nuxt.pages = []
    declaration.nuxt.navigation = []
  }
  return declaration
}

function permissionDeclaration(
  key: string,
  audiences: ('member' | 'hr' | 'director')[],
  sensitivity: 'standard' | 'sensitive' = 'standard',
) {
  return {
    audiences,
    key,
    label: `Use ${key}`,
    purpose: `Use the ${key} capability.`,
    reviewAllowed: false,
    sensitivity,
  }
}

function executableOperationPolicy() {
  return {
    audit: { reviewedDate: '2026-08-18' },
    cache: {
      collapse: true,
      kind: 'shared',
      retentionMilliseconds: 60_000,
      stale: { kind: 'none' },
    },
    identity: { fields: ['subjectId'], kind: 'ordered' },
    representationVersion: 'v1',
    retry: { kind: 'none' },
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
    if (error instanceof PlatformModuleValidationError) {
      return error.message
    }
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
