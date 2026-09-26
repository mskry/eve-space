import { fileURLToPath } from 'node:url'
import type { PlatformActivityProviderContext } from '@eve-space/platform-module-contract/activity'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { readCompiledPlatformModules } from '@eve-space/platform-module-contract/compiler'
import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformModuleRouteComposers } from '../../api/src/platform/module-route-composition'
import { executeInstalledResourceOperation } from '../../api/src/platform/resource-operation-executor'
import { readConformanceContinuation } from '../fixtures/platform-module-conformance/features/conformance/server/src/resource'
import {
  generateRegistryFiles,
  generatedRegistryPaths,
  loadInstalledModuleManifests,
} from '../../scripts/module-registry/generator'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  authorizeReviewer: vi.fn(),
  collectionStatus: { read: vi.fn() },
  createCollectionStatus: vi.fn(),
  createCoreReads: vi.fn(),
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  moduleEnabled: vi.fn(),
  resolveReviewerTarget: vi.fn(),
}))

vi.mock('../../api/src/auth/character-lifecycle.js', () => ({
  findOwnedCharacter: mocks.findOwnedCharacter,
}))
vi.mock('../../api/src/auth/session-store.js', () => ({
  findSession: mocks.findSession,
}))
vi.mock('../../api/src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.moduleEnabled,
}))
vi.mock('../../api/src/platform/core-read-capabilities.js', () => ({
  createOwnedCharacterCoreReads: mocks.createCoreReads,
}))
vi.mock('../../api/src/platform/module-collection-status-capabilities.js', () => ({
  createPlatformModuleCollectionStatusReads: mocks.createCollectionStatus,
}))
vi.mock('../../api/src/middleware/organization-session.js', () => ({
  loadOrganizationSession: async (
    context: { set(key: string, value: unknown): void },
    next: () => Promise<void>,
  ) => {
    context.set('organization', organizationSession)
    await next()
  },
}))
vi.mock('../../api/src/organization/module-authorization.js', () => ({
  authorizeOrganizationContribution: mocks.authorize,
  authorizeOrganizationReviewerContribution: mocks.authorizeReviewer,
}))
vi.mock('../../api/src/organization/reviewer-target.js', () => ({
  resolveOrganizationReviewerTarget: mocks.resolveReviewerTarget,
}))
vi.mock('../../api/src/esi-gateway/catalog-interface.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../api/src/esi-gateway/catalog-interface.js')>()
  const { conformanceStatusOperation } =
    await import('../fixtures/platform-module-conformance/features/conformance/server/src/operation')
  const fixtureOperation = 'conformance-status-operation'
  return {
    ...actual,
    assertRegisteredEsiOperation(operation: string) {
      if (operation !== fixtureOperation) {
        actual.assertRegisteredEsiOperation(operation)
      }
    },
    getEsiOperationAuthority(operation: string) {
      if (operation === fixtureOperation) return conformanceStatusOperation.contract.authorization
      actual.assertRegisteredEsiOperation(operation)
      return actual.getEsiOperationAuthority(operation)
    },
    assertPlatformEsiOperation(operation: string) {
      if (operation !== fixtureOperation) {
        actual.assertPlatformEsiOperation(operation)
      }
    },
    getEsiOperationAuthorization(operation: string) {
      return operation === fixtureOperation
        ? { kind: 'public' }
        : actual.getEsiOperationAuthorization(operation as never)
    },
    parsePlatformEsiOperationInputs(operation: string, inputs: unknown) {
      return operation === fixtureOperation
        ? conformanceStatusOperation.descriptor.requestSchema.parse(inputs)
        : actual.parsePlatformEsiOperationInputs(operation as never, inputs)
    },
  }
})

const fixtureRoot = fileURLToPath(
  new URL('../fixtures/platform-module-conformance', import.meta.url),
)
const organizationDeclaration = {
  audience: 'member',
  requiredPermission: 'conformance.view',
} as const
const organizationSession = {
  accessValidUntil: new Date('2026-09-06T21:00:00Z'),
  blocked: false,
  evidenceFreshness: 'fresh' as const,
  organizationVersion: 4,
  reviewDeadline: null,
  state: 'compliant' as const,
}
const providerContext: PlatformActivityProviderContext = {
  characters: [
    {
      characterId: 90_000_001,
      subjectLifecycleId: 'lifecycle-1',
      name: 'Conformance Pilot',
      corporationId: 98_000_001,
      allianceId: null,
      isMain: true,
      membership: 'managed',
      affiliationFreshness: 'fresh',
      affiliationCheckedAt: '2026-09-06T19:59:00Z',
    },
  ],
  organizationVersion: 4,
  requestedAt: '2026-09-06T20:00:00Z',
  signal: new AbortController().signal,
  userId: 'user-1',
}

beforeEach(() => {
  mocks.moduleEnabled.mockResolvedValue(true)
  mocks.findSession.mockResolvedValue({ mainCharacter: null, userId: 'user-1' })
  mocks.findOwnedCharacter.mockResolvedValue({
    characterId: 90_000_001,
    subjectLifecycleId: 'lifecycle-1',
  })
  mocks.authorize.mockResolvedValue({
    authorized: true,
    context: {
      audience: 'member',
      entitlementScope: 'all',
      organizationVersion: 4,
      requiredPermission: 'conformance.view',
    },
  })
  mocks.createCollectionStatus.mockReturnValue(mocks.collectionStatus)
  mocks.collectionStatus.read.mockResolvedValue(currentStatus())
  mocks.createCoreReads.mockReturnValue({
    loadAffiliation: vi.fn().mockResolvedValue({ corporationId: 98_000_001 }),
  })
})

describe('production-shaped module conformance', () => {
  it('retains a positive revision without exposing or resuming mismatched authority progress', () => {
    const binding = `v1:${'a'.repeat(64)}`
    const context = { continuationAuthorityBinding: binding }
    const stored = {
      checkpoint: { authorityBinding: `v1:${'b'.repeat(64)}`, cursor: 'old-private-progress' },
      revision: 9,
    }
    expect(readConformanceContinuation(context, stored)).toStrictEqual({
      checkpoint: null,
      expectedRevision: 9,
      needsReset: true,
    })
    expect(
      readConformanceContinuation(context, {
        checkpoint: { authorityBinding: binding, cursor: 'current-progress' },
        revision: 10,
      }),
    ).toStrictEqual({
      checkpoint: { authorityBinding: binding, cursor: 'current-progress' },
      expectedRevision: 10,
      needsReset: false,
    })
    expect(readConformanceContinuation(context, null)).toStrictEqual({
      checkpoint: null,
      expectedRevision: 0,
      needsReset: false,
    })
    expect(Object.keys(context)).toEqual(['continuationAuthorityBinding'])
    expect(JSON.stringify(context)).not.toContain('sourceId')
    expect(JSON.stringify(context)).not.toContain('roleRevision')
  })
  it('loads the real fixture root and generates every declared contribution', async () => {
    const registry = await loadInstalledModuleManifests(fixtureRoot)
    const files = generateRegistryFiles(
      registry.compiled,
      registry.persistenceRoutines,
      registry.releases,
    )
    const manifests = readCompiledPlatformModules(registry.compiled)

    expect(manifests).toHaveLength(1)
    expect(manifests[0]).toMatchObject({
      defaultEnabled: true,
      id: 'conformance',
      nuxt: { package: '@eve-space/conformance-nuxt' },
      server: {
        migrations: [
          { name: 'conformance-001-initial.sql' },
          { name: 'conformance-002-persistence-operations.sql' },
        ],
        package: '@eve-space/conformance-server',
      },
    })
    expect(files).toHaveLength(generatedRegistryPaths.length)
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "platformModuleRouteComposers['owned-character']",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'conformanceStatusResource',
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'coreDataProducts: ["published-type-groups"] as const',
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "operationId: 'conformance-status-operation'",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      "PlatformEsiOperationProtocol<'conformance-status-operation' | 'universe-resolve-names'>",
    )
    expect(
      files.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain('conformanceActivityProvider')
    const persistenceRegistry = files.get(
      'api/src/generated/platform/installed-module-persistence.ts',
    )!
    expect(persistenceRegistry).toContain('readConformanceSnapshotOperation')
    expect(persistenceRegistry).toContain('upsertConformanceSnapshotOperation')
    const providerFactory = persistenceRegistry.slice(
      persistenceRegistry.indexOf('function createModule0ActivityProvider0Persistence'),
      persistenceRegistry.indexOf('function createModule0Resource0ProjectionPersistence'),
    )
    expect(providerFactory).toContain('readConformanceSnapshot')
    expect(providerFactory).not.toContain('upsertConformanceSnapshot')
    expect(providerFactory).not.toContain('transaction')
    expect(providerFactory).not.toContain('query')
    const materializationFactory = persistenceRegistry.slice(
      persistenceRegistry.indexOf('function createModule0Resource0MaterializationPersistence'),
      persistenceRegistry.indexOf('function createModule0Resource1ProjectionPersistence'),
    )
    expect(materializationFactory).toContain('upsertConformanceSnapshot')
    expect(materializationFactory).not.toContain('readConformanceSnapshot')
    expect(materializationFactory).not.toContain('transaction')
    const collectionProjectionFactory = persistenceRegistry.slice(
      persistenceRegistry.indexOf('function createModule0Resource1ProjectionPersistence'),
      persistenceRegistry.indexOf('function createModule0Resource1MaterializationPersistence'),
    )
    expect(collectionProjectionFactory).toContain('readConformanceSnapshot')
    expect(collectionProjectionFactory).not.toContain('upsertConformanceSnapshot')
    expect(persistenceRegistry).not.toContain('deleteConformanceSnapshot')
    expect(files.get('generated/platform/installed-nuxt-contributions.ts')).toContain(
      'ConformanceActivityPage.vue',
    )
  })

  it('composes authorization, ownership, validation, private responses, and safe errors', async () => {
    const server =
      await import('../fixtures/platform-module-conformance/features/conformance/server/src/index')
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const capabilities: Parameters<typeof server.conformanceRoutes>[0] = {
      coreData: {},
      logger,
      persistence: {},
    }
    const app = conformanceRouteApp(server.conformanceRoutes(capabilities))
    const request = (query: string) =>
      app.request(`/api/modules/conformance/characters/90000001${query}`, {
        headers: { cookie: 'eve_space_session=session-token' },
      })

    const success = await request('?view=summary')
    expect(success.status).toBe(200)
    expectPrivate(success)
    await expect(success.json()).resolves.toMatchObject({
      characterId: 90_000_001,
      corporationId: 98_000_001,
      organizationVersion: 4,
      view: 'summary',
    })
    expect(logger.info).toHaveBeenCalledWith('conformance.route.loaded', {
      characterId: 90_000_001,
    })

    const invalid = await request('?view=invalid')
    expect(invalid.status).toBe(400)
    expectPrivate(invalid)
    await expect(invalid.json()).resolves.toMatchObject({ message: expect.any(String) })

    const conflict = await request('?view=conflict')
    expect(conflict.status).toBe(409)
    expectPrivate(conflict)
    await expect(conflict.json()).resolves.toStrictEqual({
      code: 'CONFORMANCE_CONFLICT',
      message: 'The conformance activity is already current.',
    })

    mocks.authorize.mockResolvedValue({ authorized: false, reason: 'permission' })
    const unauthorized = await request('?view=summary')
    expect(unauthorized.status).toBe(403)
    expectPrivate(unauthorized)
    expect(mocks.findOwnedCharacter).toHaveBeenCalledTimes(3)
    expect(mocks.collectionStatus.read).toHaveBeenCalledTimes(1)

    mocks.moduleEnabled.mockResolvedValue(false)
    const disabled = await request('?view=summary')
    expect(disabled.status).toBe(404)
    expect(mocks.findSession).toHaveBeenCalledTimes(4)
    expect(mocks.collectionStatus.read).toHaveBeenCalledTimes(1)
  })

  it('executes the single-request resource and activity provider through bounded capabilities', async () => {
    const server =
      await import('../fixtures/platform-module-conformance/features/conformance/server/src/index')
    const resources = await conformanceResources(server)
    const readConformanceSnapshot = vi.fn().mockResolvedValue({
      characterId: 90_000_001,
      pilotsOnline: 23,
      validatedAt: '2026-09-06T20:00:00Z',
    })
    const upsertConformanceSnapshot = vi.fn().mockResolvedValue({ applied: true })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const providerCapabilities = {
      collectionStatus: { read: vi.fn().mockResolvedValue(currentStatus()) },
      coreData: {},
      logger,
      persistence: { readConformanceSnapshot },
    }
    const publishedTypeGroups = vi.fn().mockResolvedValue({
      complete: true,
      revision: { buildNumber: 1234, ingestVersion: 2, ingestedAt: '2026-09-06T19:00:00Z' },
      rows: [{ typeId: 34, typeName: 'Tritanium', groupId: 18, groupName: 'Mineral' }],
    })
    const executeEsiOperation = vi.fn().mockResolvedValue(conformanceExecution(statusData))

    const observation = await executeInstalledResourceOperation(
      conformanceIdentity('conformance-status'),
      {
        createMappingCapabilities: vi.fn().mockReturnValue({ coreData: { publishedTypeGroups } }),
        executeEsiOperation,
        guardExecution: conformanceGuard(resources),
        resources,
      },
    )
    if (observation.outcome !== 'loaded') {
      throw new Error('Conformance resource did not load')
    }
    await server.conformanceStatusResource.materialize({
      authorizationGeneration: null,
      capabilities: {
        logger,
        persistence: { upsertConformanceSnapshot },
      },
      data: observation.result.data as { readonly players: number },
      managedAuthority: null,
      organizationVersion: null,
      subject: conformanceSubject,
      validatedAt: observation.result.validatedAt,
    })
    const provider = server.conformanceActivityProvider(providerCapabilities)
    const result = await provider(providerContext)

    expect(server.conformanceStatusResource.mode).toBe('single-request')
    expect(server.conformanceStatusResource).not.toHaveProperty('collect')
    expect(server.conformanceStatusOperation.sdkOperationId).toBe('GetStatus')
    expect(executeEsiOperation).toHaveBeenCalledOnce()
    expect(executeEsiOperation).toHaveBeenCalledWith({
      authorization: { kind: 'public' },
      inputs: {},
      operation: 'conformance-status-operation',
    })
    expect(publishedTypeGroups).toHaveBeenCalledWith({ typeIds: [34] })
    expect(observation.result.data).toStrictEqual({
      players: 23,
      publishedTypeCount: 1,
      sdeBuildNumber: 1234,
    })
    expect(publishedTypeGroups.mock.invocationCallOrder[0]).toBeLessThan(
      upsertConformanceSnapshot.mock.invocationCallOrder[0]!,
    )
    expect(upsertConformanceSnapshot).toHaveBeenCalledWith({
      characterId: 90_000_001,
      pilotsOnline: 23,
      validatedAt: '2026-09-06T20:00:00Z',
    })
    expect(readConformanceSnapshot).toHaveBeenCalledWith({ characterId: 90_000_001 })
    expect(result).toMatchObject({
      activities: [
        {
          id: 'status:90000001',
          title: '23 pilots online',
          linkTarget: { pageId: 'conformance-activity-page', characterId: 90_000_001 },
        },
      ],
      freshness: { state: 'current' },
    })
  })

  it('executes the bounded-collection resource through only its declared typed operations', async () => {
    const server =
      await import('../fixtures/platform-module-conformance/features/conformance/server/src/index')
    const resources = await conformanceResources(server)
    const readConformanceSnapshot = vi.fn().mockResolvedValue({
      characterId: 90_000_001,
      pilotsOnline: 21,
      validatedAt: '2026-09-06T19:00:00Z',
    })
    const executeEsiOperation = vi.fn(async ({ operation }: { readonly operation: string }) =>
      conformanceExecution(
        operation === 'universe-resolve-names'
          ? [{ category: 'character', id: 90_000_001, name: 'Conformance Pilot' }]
          : statusData,
      ),
    )
    const observation = await executeInstalledResourceOperation(
      conformanceIdentity('conformance-collection'),
      {
        createCapabilities: vi.fn().mockReturnValue({
          coreData: {},
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
          persistence: { readConformanceSnapshot },
        }),
        executeEsiOperation,
        guardExecution: conformanceGuard(resources),
        loadCollectionContext: vi
          .fn()
          .mockResolvedValue({ organizationVersion: 4, corporationId: 98_000_001 }),
        resources,
      },
    )
    const operationNames = executeEsiOperation.mock.calls.map(([request]) => request.operation)

    expect(server.conformanceCollectionResource.mode).toBe('bounded-collection')
    expect(server.conformanceCollectionResource).not.toHaveProperty('request')
    expect(server.conformanceCollectionResource).not.toHaveProperty('map')
    expect(observation).toMatchObject({
      complete: true,
      organizationVersion: 4,
      outcome: 'loaded',
      result: {
        data: { characterName: 'Conformance Pilot', players: 23, previousPlayers: 21 },
      },
    })
    expect(operationNames).toStrictEqual(['conformance-status-operation', 'universe-resolve-names'])
    expect(executeEsiOperation).toHaveBeenLastCalledWith({
      authorization: { kind: 'public' },
      inputs: { body: [90_000_001] },
      operation: 'universe-resolve-names',
    })
    expect(readConformanceSnapshot).toHaveBeenCalledWith({ characterId: 90_000_001 })
  })
})

const conformanceSubject = {
  characterId: 90_000_001,
  kind: 'character' as const,
  lifecycleId: 'lifecycle-1',
}
const statusData = { players: 23, server_version: '1', start_time: '2026-09-06T11:00:00Z' }

async function conformanceResources(server: Readonly<Record<string, unknown>>) {
  const registry = await loadInstalledModuleManifests(fixtureRoot)
  const [manifest] = readCompiledPlatformModules(registry.compiled)
  return manifest!.server.resources.map(
    (resource) =>
      ({
        coreDataProducts: resource.coreDataProducts ?? [],
        dependentOperationIds: resource.dependentOperationIds,
        eligibility: resource.eligibility,
        implementation: server[resource.exportName],
        materializationIntervalSeconds: resource.materializationIntervalSeconds,
        moduleId: manifest!.id,
        operationId: resource.operationId,
        persistence: resource.persistence,
        resourceId: resource.id,
        subjectKind: resource.subjectKind,
      }) as PlatformInstalledResourceDescriptor,
  )
}

function conformanceIdentity(resourceId: string) {
  return {
    moduleId: 'conformance',
    resourceId,
    subjectId: String(conformanceSubject.characterId),
    subjectKind: 'character' as const,
    subjectLifecycleId: conformanceSubject.lifecycleId,
  }
}

function conformanceGuard(resources: readonly PlatformInstalledResourceDescriptor[]) {
  return vi.fn(async (identity: { readonly resourceId: string }) => ({
    authorization: null,
    authorizationCharacterId: conformanceSubject.characterId,
    authorizationCharacterLifecycleId: conformanceSubject.lifecycleId,
    characterId: conformanceSubject.characterId,
    managedAuthority: null,
    outcome: 'ready' as const,
    resource: resources.find((resource) => resource.resourceId === identity.resourceId)!,
    subject: conformanceSubject,
  }))
}

function conformanceExecution(data: unknown) {
  return {
    authorizationGeneration: null,
    cachedUntil: '2026-09-06T20:01:00Z',
    data,
    quota: {},
    source: 'esi' as const,
    stale: false,
    validatedAt: '2026-09-06T20:00:00Z',
  }
}

function conformanceRouteApp(route: Hono) {
  const app = new Hono().route(
    '/api/modules/conformance/characters/:characterId',
    platformModuleRouteComposers['owned-character']('conformance', organizationDeclaration, route),
  )
  app.onError((error, context) => {
    if (error instanceof PlatformModuleHttpError) {
      return context.json(error.body, error.status)
    }
    if (error instanceof HTTPException) {
      return context.json({ message: error.message }, error.status)
    }
    return context.json({ message: 'Internal server error' }, 500)
  })
  return app
}

function currentStatus() {
  return {
    authorizationGeneration: 2,
    lastFailureClass: null,
    status: 'current' as const,
    validatedAt: '2026-09-06T20:00:00Z',
  }
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}
