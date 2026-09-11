import { fileURLToPath } from 'node:url'
import type {
  PlatformActivityProviderCapabilities,
  PlatformActivityProviderContext,
  PlatformModuleResourceTransaction,
  PlatformModuleRouteCapabilities,
} from '@eve-space/platform-module-contract'
import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformModuleRouteComposers } from '../../api/src/platform/module-route-composition'
import {
  generateRegistryFiles,
  loadInstalledModuleManifests,
} from '../../scripts/module-registry/generator'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  collectionStatus: { read: vi.fn() },
  createCollectionStatus: vi.fn(),
  createCoreReads: vi.fn(),
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  moduleEnabled: vi.fn(),
}))

vi.mock('../../api/src/auth/character-lifecycle.js', () => ({
  findOwnedCharacter: mocks.findOwnedCharacter,
}))
vi.mock('../../api/src/auth/session-store.js', () => ({
  findSession: mocks.findSession,
}))
vi.mock('../../api/src/platform/module-settings.js', () => ({
  isInstalledModuleEnabled: mocks.moduleEnabled,
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
}))

const fixtureRoot = fileURLToPath(
  new URL('../fixtures/platform-module-conformance', import.meta.url),
)
const organizationDeclaration = {
  audience: 'member',
  requiredPermission: 'conformance.view',
} as const
const organizationSession = {
  organizationVersion: 4,
  state: 'compliant' as const,
  evidenceFreshness: 'fresh' as const,
  reviewDeadline: null,
  accessValidUntil: new Date('2026-09-06T21:00:00Z'),
  blocked: false,
}
const providerContext: PlatformActivityProviderContext = {
  userId: 'user-1',
  organizationVersion: 4,
  requestedAt: '2026-09-06T20:00:00Z',
  signal: new AbortController().signal,
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
}

beforeEach(() => {
  mocks.moduleEnabled.mockResolvedValue(true)
  mocks.findSession.mockResolvedValue({ userId: 'user-1', mainCharacter: null })
  mocks.findOwnedCharacter.mockResolvedValue({
    characterId: 90_000_001,
    subjectLifecycleId: 'lifecycle-1',
  })
  mocks.authorize.mockResolvedValue({
    authorized: true,
    context: {
      organizationVersion: 4,
      audience: 'member',
      requiredPermission: 'conformance.view',
      entitlementScope: 'all',
    },
  })
  mocks.createCollectionStatus.mockReturnValue(mocks.collectionStatus)
  mocks.collectionStatus.read.mockResolvedValue(currentStatus())
  mocks.createCoreReads.mockReturnValue({
    loadAffiliation: vi.fn().mockResolvedValue({ corporationId: 98_000_001 }),
  })
})

describe('production-shaped module conformance', () => {
  it('loads the real fixture root and generates every declared contribution', async () => {
    const manifests = await loadInstalledModuleManifests(fixtureRoot)
    const files = generateRegistryFiles(manifests)

    expect(manifests).toHaveLength(1)
    expect(manifests[0]).toMatchObject({
      id: 'conformance',
      defaultEnabled: true,
      server: {
        package: '@eve-space/conformance-server',
        migrations: [{ name: 'conformance-001-initial.sql' }],
      },
      nuxt: { package: '@eve-space/conformance-nuxt' },
    })
    expect(files).toHaveLength(9)
    expect(files.get('api/src/generated/platform/installed-module-routes.ts')).toContain(
      "platformModuleRouteComposers['owned-character']",
    )
    expect(files.get('api/src/generated/platform/installed-module-worker.ts')).toContain(
      'conformanceStatusResource',
    )
    expect(
      files.get('api/src/generated/platform/installed-module-activity-providers.ts'),
    ).toContain('conformanceActivityProvider')
    expect(files.get('generated/platform/installed-nuxt-contributions.ts')).toContain(
      'ConformanceActivityPage.vue',
    )
  })

  it('composes authorization, ownership, validation, private responses, and safe errors', async () => {
    const server =
      await import('../fixtures/platform-module-conformance/features/conformance/server/src/index')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const capabilities: PlatformModuleRouteCapabilities<unknown> = {
      logger,
      persistence: { transaction: vi.fn() },
      sde: { loadPublishedTypeGroups: vi.fn() },
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
    await expect(conflict.json()).resolves.toEqual({
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

  it('executes the declared resource and activity provider through bounded capabilities', async () => {
    const server =
      await import('../fixtures/platform-module-conformance/features/conformance/server/src/index')
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          character_id: 90_000_001,
          pilots_online: 23,
          validated_at: '2026-09-06T20:00:00Z',
        },
      ])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const capabilities: PlatformActivityProviderCapabilities<PlatformModuleResourceTransaction> = {
      collectionStatus: { read: vi.fn().mockResolvedValue(currentStatus()) },
      logger,
      persistence: {
        transaction: (operation) => operation({ query }),
      },
    }
    const subject = {
      kind: 'character' as const,
      characterId: 90_000_001,
      lifecycleId: 'lifecycle-1',
    }
    const request = server.conformanceStatusResource.request(subject)
    const data = server.conformanceStatusResource.map({ subject, data: { players: 23 } })
    await server.conformanceStatusResource.materialize({
      subject,
      data,
      validatedAt: '2026-09-06T20:00:00Z',
      authorizationGeneration: 2,
      capabilities,
    })
    const provider = server.conformanceActivityProvider(capabilities)
    const result = await provider(providerContext)

    expect(server.conformanceStatusOperation.sdkOperationId).toBe('GetStatus')
    expect(request).toEqual({})
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('insert into conformance_snapshots'),
      [90_000_001, 23, '2026-09-06T20:00:00Z'],
    )
    expect(result).toMatchObject({
      freshness: { state: 'current' },
      activities: [
        {
          id: 'status:90000001',
          title: '23 pilots online',
          linkTarget: { pageId: 'conformance-activity-page', characterId: 90_000_001 },
        },
      ],
    })
  })
})

function conformanceRouteApp(route: Hono) {
  const app = new Hono().route(
    '/api/modules/conformance/characters/:characterId',
    platformModuleRouteComposers['owned-character']('conformance', organizationDeclaration, route),
  )
  app.onError((error, context) => {
    if (error instanceof PlatformModuleHttpError) return context.json(error.body, error.status)
    if (error instanceof HTTPException)
      return context.json({ message: error.message }, error.status)
    return context.json({ message: 'Internal server error' }, 500)
  })
  return app
}

function currentStatus() {
  return {
    status: 'current' as const,
    authorizationGeneration: 2,
    lastFailureClass: null,
    validatedAt: '2026-09-06T20:00:00Z',
  }
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}
