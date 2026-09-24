import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CharacterTokenNotFoundError extends Error {}
  class CharacterOwnershipConflictError extends Error {}
  class TokenRefreshLockUnavailableError extends Error {}
  return {
    CharacterOwnershipConflictError,
    CharacterTokenNotFoundError,
    TokenRefreshLockUnavailableError,
    authorizeOrganizationContribution: vi.fn(),
    collectionStatus: { read: vi.fn() },
    createOwnedCharacterCoreReads: vi.fn(),
    createPlatformModuleCollectionStatusReads: vi.fn(),
    enabled: true,
    events: [] as string[],
    findAdminSession: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    hasOrganizationContext: true,
    isInstalledModuleContributionEnabled: vi.fn(),
    loadModuleRuntimeState: vi.fn(),
    organizationContext: {
      accessValidUntil: new Date(Date.now() + 60_000) as Date | null,
      blocked: false,
      evidenceFreshness: 'fresh' as 'fresh' | 'stale' | 'unavailable',
      organizationVersion: 7,
      reviewDeadline: null as Date | null,
      state: 'compliant' as 'pending' | 'compliant' | 'review_required' | 'suspended',
    },
    ownedHandler: vi.fn(),
    saveInstalledShellNavigationOrder: vi.fn(),
    sessionHandler: vi.fn(),
    unexpectedError: new Error('refresh-token private-host'),
  }
})

vi.mock('../../src/env.js', () => ({
  env: {
    ADMIN_SETUP_SECRET: undefined,
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  },
  getSsoConfig: vi.fn(),
  isSsoConfigured: () => false,
}))

vi.mock('../../src/auth/character-lifecycle.js', () => ({
  CharacterOwnershipConflictError: mocks.CharacterOwnershipConflictError,
  attachCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  listUserCharacters: vi.fn(),
  reauthorizeCharacter: vi.fn(),
  saveLogin: vi.fn(),
  setMainCharacter: vi.fn(),
}))
vi.mock('../../src/auth/oauth-state-store.js', () => ({
  consumeOAuthState: vi.fn(),
  storeOAuthState: vi.fn(),
}))
vi.mock('../../src/auth/session-store.js', () => ({
  deleteSession: vi.fn(),
  findSession: mocks.findSession,
}))
vi.mock('../../src/auth/character-token-store.js', () => ({
  CharacterTokenNotFoundError: mocks.CharacterTokenNotFoundError,
  TokenRefreshLockUnavailableError: mocks.TokenRefreshLockUnavailableError,
  findCharacterToken: vi.fn(),
  updateCharacterToken: vi.fn(),
  withCharacterTokenRefreshLock: vi.fn(),
}))

vi.mock('../../src/admin/store.js', () => ({
  DeploymentAlreadyConfiguredError: class extends Error {},
  createAdminSession: vi.fn(),
  createDeployment: vi.fn(),
  deleteAdminSession: vi.fn(),
  findAdminCredentials: vi.fn(),
  findAdminSession: mocks.findAdminSession,
  isDeploymentConfigured: vi.fn(),
  updateDeploymentOrganization: vi.fn(),
}))

vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.isInstalledModuleContributionEnabled,
  listInstalledModuleSettings: vi.fn(),
  loadInstalledShellNavigationOrder: vi.fn(),
  loadModuleRuntimeState: mocks.loadModuleRuntimeState,
  saveInstalledShellNavigationOrder: mocks.saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled: vi.fn(),
  setInstalledModuleSectionEnabled: vi.fn(),
}))
vi.mock('../../src/platform/module-navigation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isCompleteShellNavigationOrder: () => true,
}))

vi.mock('../../src/platform/core-read-capabilities.js', () => ({
  createOwnedCharacterCoreReads: mocks.createOwnedCharacterCoreReads,
}))
vi.mock('../../src/platform/module-collection-status-capabilities.js', () => ({
  createPlatformModuleCollectionStatusReads: mocks.createPlatformModuleCollectionStatusReads,
}))

vi.mock('../../src/middleware/organization-session.js', () => ({
  loadOrganizationSession: async (
    context: { set(key: string, value: unknown): void },
    next: () => Promise<void>,
  ) => {
    mocks.events.push('organization')
    if (mocks.hasOrganizationContext) {
      context.set('organization', mocks.organizationContext)
    }
    await next()
  },
}))

vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationContribution: mocks.authorizeOrganizationContribution,
  resolveOrganizationEntitlementScope: (organization: typeof mocks.organizationContext) =>
    organization.blocked || !organization.accessValidUntil ? null : 'all',
}))

vi.mock('../../src/generated/platform/installed-module-routes.js', async () => {
  const { Hono } = await import('hono')
  const { z } = await import('zod')
  const { platformModuleError, zValidator } = await import('@eve-space/platform-module-server')
  const { platformModuleRouteComposers } =
    await import('../../src/platform/module-route-composition.js')
  const organization = {
    audience: 'member',
    moduleId: 'alpha',
    publisherPackage: '@example/alpha-manifest',
    requiredPermission: 'alpha.view',
  } as const

  const sessionRoutes = new Hono<PlatformAuthenticatedSessionRouteEnv>()
    .get('/', (context) => {
      mocks.events.push('session-handler')
      mocks.sessionHandler(context.var.platform)
      return context.json(
        {
          platform: {
            authorization: context.var.platform.authorization,
            organization: context.var.platform.organization,
          },
        },
        200,
      )
    })
    .post(
      '/validated',
      zValidator('json', z.object({ name: z.string().min(1, 'Name is required.') })),
      (context) => {
        mocks.sessionHandler(context.req.valid('json'))
        return context.json({ ok: true as const })
      },
    )
    .get('/expected-error', () => {
      throw platformModuleError(409, {
        code: 'ACTIVITY_ALREADY_EXISTS',
        message: 'The activity already exists.',
      })
    })
    .get('/unexpected-error', () => {
      throw mocks.unexpectedError
    })
  const ownedRoutes = new Hono<PlatformOwnedCharacterRouteEnv>().get('/', (context) => {
    mocks.events.push('owned-handler')
    mocks.ownedHandler(context.var.platform)
    return context.json({
      authorization: context.var.platform.authorization,
      hasCoreReads: Boolean(context.var.platform.coreReads),
    })
  })

  return {
    installedModuleRoutes: new Hono()
      .route(
        '/alpha/profile',
        platformModuleRouteComposers['authenticated-session']('alpha', organization, sessionRoutes),
      )
      .route(
        '/alpha/hr',
        platformModuleRouteComposers['authenticated-session'](
          'alpha',
          { ...organization, audience: 'hr' },
          sessionRoutes,
        ),
      )
      .route(
        '/alpha/characters/:characterId',
        platformModuleRouteComposers['owned-character']('alpha', organization, ownedRoutes),
      ),
  }
})

import { app } from '../../src/index.js'
import { apiLogger } from '../../src/logging.js'

const session = {
  mainCharacter: {
    allianceId: null,
    characterId: 90_000_001,
    corporationId: 98_000_001,
    isMain: true,
    name: 'Main Character',
  },
  userId: 'user-1',
}
const ownedCharacter = {
  ...session.mainCharacter,
  isMain: false,
  subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
}
const sessionCookie = { Cookie: 'eve_space_session=session-token' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.events = []
  mocks.enabled = true
  mocks.unexpectedError = new Error('refresh-token private-host')
  mocks.hasOrganizationContext = true
  mocks.findAdminSession.mockResolvedValue(null)
  mocks.isInstalledModuleContributionEnabled.mockImplementation(async () => {
    mocks.events.push('enablement')
    return mocks.enabled
  })
  mocks.findSession.mockImplementation(async () => {
    mocks.events.push('session')
    return session
  })
  mocks.findOwnedCharacter.mockImplementation(async (_userId, characterId) => {
    mocks.events.push('ownership')
    return characterId === ownedCharacter.characterId ? ownedCharacter : null
  })
  mocks.createOwnedCharacterCoreReads.mockReturnValue({ loadAffiliation: vi.fn() })
  mocks.createPlatformModuleCollectionStatusReads.mockReturnValue(mocks.collectionStatus)
  mocks.organizationContext = {
    accessValidUntil: new Date(Date.now() + 60_000),
    blocked: false,
    evidenceFreshness: 'fresh',
    organizationVersion: 7,
    reviewDeadline: null,
    state: 'compliant',
  }
  mocks.authorizeOrganizationContribution.mockImplementation(async () => {
    mocks.events.push('authorization')
    return {
      authorized: true,
      context: {
        audience: 'member',
        entitlementScope: 'all',
        organizationVersion: 7,
        requiredPermission: 'alpha.view',
      },
    }
  })
})

describe('full-root platform module authorization', () => {
  test('checks disablement before authentication, validation, ownership, and module code', async () => {
    mocks.enabled = false

    const response = await app.request('/api/modules/alpha/characters/not-an-id')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toStrictEqual({ message: 'Route not found' })
    expect(mocks.events).toStrictEqual(['enablement'])
  })

  test('authenticates before validating an owned-character path', async () => {
    const anonymous = await app.request('/api/modules/alpha/characters/not-an-id')
    expect(anonymous.status).toBe(401)

    const authenticated = await app.request('/api/modules/alpha/characters/not-an-id', {
      headers: sessionCookie,
    })
    expect(authenticated.status).toBe(400)
    await expect(authenticated.json()).resolves.toStrictEqual({
      message: 'Character ID must be a positive integer.',
    })
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.ownedHandler).not.toHaveBeenCalled()
  })

  test('returns indistinguishable outcomes for unknown and non-owned characters', async () => {
    const responses = await Promise.all(
      [90_000_002, 90_000_003].map((characterId) =>
        app.request(`/api/modules/alpha/characters/${characterId}`, { headers: sessionCookie }),
      ),
    )

    expect(responses.map(({ status }) => status)).toStrictEqual([404, 404])
    expect(await Promise.all(responses.map((response) => response.json()))).toStrictEqual([
      { code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' },
      { code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' },
    ])
    expect(mocks.ownedHandler).not.toHaveBeenCalled()
  })

  test('passes only narrow authorized context after successful ownership', async () => {
    const response = await app.request(
      `/api/modules/alpha/characters/${ownedCharacter.characterId}`,
      { headers: sessionCookie },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({
      authorization: {
        characterId: ownedCharacter.characterId,
        strategy: 'owned-character',
        subjectLifecycleId: ownedCharacter.subjectLifecycleId,
        userId: session.userId,
      },
      hasCoreReads: true,
    })
    expect(mocks.events).toStrictEqual([
      'enablement',
      'session',
      'organization',
      'authorization',
      'ownership',
      'owned-handler',
    ])
    expect(mocks.createOwnedCharacterCoreReads).toHaveBeenCalledWith({
      characterId: ownedCharacter.characterId,
      subjectLifecycleId: ownedCharacter.subjectLifecycleId,
      userId: session.userId,
    })
    expect(Object.keys(mocks.ownedHandler.mock.calls[0]?.[0] ?? {})).toStrictEqual([
      'authorization',
      'collectionStatus',
      'organization',
      'coreReads',
    ])
  })

  test('passes only user identity to authenticated-session routes', async () => {
    const response = await app.request('/api/modules/alpha/profile', { headers: sessionCookie })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({
      platform: {
        authorization: { strategy: 'authenticated-session', userId: session.userId },
        organization: {
          audience: 'member',
          entitlementScope: 'all',
          organizationVersion: 7,
          requiredPermission: 'alpha.view',
        },
      },
    })
    expect(Object.keys(mocks.sessionHandler.mock.calls[0]?.[0] ?? {})).toStrictEqual([
      'authorization',
      'collectionStatus',
      'organization',
    ])
  })

  test('uses public canonical validation and safe module error contracts', async () => {
    const invalid = await app.request('/api/modules/alpha/profile/validated', {
      body: JSON.stringify({ name: '' }),
      headers: { ...sessionCookie, 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toStrictEqual({ message: 'Name is required.' })
    expect(invalid.headers.get('cache-control')).toBe('private, no-store')
    expect(invalid.headers.get('vary')).toContain('Cookie')
    expect(mocks.sessionHandler).not.toHaveBeenCalled()

    const expected = await app.request('/api/modules/alpha/profile/expected-error', {
      headers: sessionCookie,
    })
    expect(expected.status).toBe(409)
    await expect(expected.json()).resolves.toStrictEqual({
      code: 'ACTIVITY_ALREADY_EXISTS',
      message: 'The activity already exists.',
    })
    expect(expected.headers.get('cache-control')).toBe('private, no-store')
    expect(expected.headers.get('vary')).toContain('Cookie')
  })

  test('sanitizes unexpected module failures in responses and logs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    apiLogger.enableLogging()

    try {
      const response = await app.request('/api/modules/alpha/profile/unexpected-error', {
        headers: sessionCookie,
      })

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toStrictEqual({ message: 'Internal server error' })
      expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/refresh-token|private-host/)
      expect(consoleError).toHaveBeenCalledOnce()
      const completionEvent = JSON.parse(String(consoleInfo.mock.calls[0]?.[0]))
      expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toStrictEqual(
        expect.objectContaining({
          correlationId: completionEvent.requestId,
          event: 'api.request.failed',
          failureCategory: 'unexpected-failure',
          level: 'error',
          method: 'GET',
          msg: 'Runtime diagnostic',
          path: '/api/modules/alpha/profile/unexpected-error',
          thrownType: 'object',
        }),
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('vary')).toContain('Cookie')
    } finally {
      apiLogger.disableLogging()
      consoleError.mockRestore()
      consoleInfo.mockRestore()
    }
  })

  test('never serializes arbitrary API error content', async () => {
    const sentinels = {
      cause: 'cause-private-sentinel',
      message: 'message-private-sentinel',
      property: 'property-private-sentinel',
      stack: 'stack-private-sentinel',
    }
    const cause = new Error(sentinels.cause)
    cause.stack = `Error: ${sentinels.cause}\n    at cause (file:///workspace/${sentinels.cause}.ts:10:2)`
    mocks.unexpectedError = Object.assign(new Error(sentinels.message, { cause }), {
      authorization: sentinels.property,
      response: { body: sentinels.property, headers: { cookie: sentinels.property } },
    })
    mocks.unexpectedError.stack = `Error: ${sentinels.message}\n    at handler (file:///workspace/${sentinels.stack}.ts?token=${sentinels.stack}:20:4)`
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    apiLogger.enableLogging()
    try {
      const response = await app.request('/api/modules/alpha/profile/unexpected-error', {
        headers: sessionCookie,
      })

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toStrictEqual({ message: 'Internal server error' })
      const serialized = JSON.stringify(consoleError.mock.calls)
      for (const sentinel of Object.values(sentinels)) {
        expect(serialized).not.toContain(sentinel)
      }
      expect(consoleError).toHaveBeenCalledOnce()
      const loggedEvent = JSON.parse(String(consoleError.mock.calls[0]?.[0]))
      const completionEvent = JSON.parse(String(consoleInfo.mock.calls[0]?.[0]))
      expect(loggedEvent).toStrictEqual(
        expect.objectContaining({
          correlationId: completionEvent.requestId,
          event: 'api.request.failed',
          failureCategory: 'unexpected-failure',
          thrownType: 'object',
        }),
      )
      expect(loggedEvent).not.toHaveProperty('cause')
      expect(loggedEvent).not.toHaveProperty('stack')
      expect(loggedEvent).not.toHaveProperty('authorization')
      expect(loggedEvent).not.toHaveProperty('response')
    } finally {
      apiLogger.disableLogging()
      consoleError.mockRestore()
      consoleInfo.mockRestore()
    }
  })

  test.each([
    ['blocked', 'ORGANIZATION_MEMBER_BLOCKED'],
    ['compliance', 'ORGANIZATION_COMPLIANCE_REQUIRED'],
    ['audience', 'ORGANIZATION_MANAGER_REQUIRED'],
    ['permission', 'ORGANIZATION_PERMISSION_REQUIRED'],
  ] as const)('rejects module access denied for %s', async (reason, code) => {
    mocks.authorizeOrganizationContribution.mockResolvedValue({ authorized: false, reason })

    const response = await app.request('/api/modules/alpha/profile', { headers: sessionCookie })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code })
    expect(mocks.sessionHandler).not.toHaveBeenCalled()
  })

  test('rejects module access without current organization context', async () => {
    mocks.hasOrganizationContext = false

    const response = await app.request('/api/modules/alpha/profile', { headers: sessionCookie })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
      state: 'pending',
    })
    expect(mocks.authorizeOrganizationContribution).not.toHaveBeenCalled()
  })

  test('returns an HR-specific audience denial', async () => {
    mocks.authorizeOrganizationContribution.mockResolvedValue({
      authorized: false,
      reason: 'audience',
    })

    const response = await app.request('/api/modules/alpha/hr', { headers: sessionCookie })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'ORGANIZATION_HR_REQUIRED' })
  })
})

describe('full-root platform shell boundaries', () => {
  test('serves resolved defaults with new entries appended and unavailable owners omitted', async () => {
    const { resolveShellNavigationOrder } = await vi.importActual<
      typeof import('../../src/platform/module-navigation.js')
    >('../../src/platform/module-navigation.js')
    const defaults = [
      { navigationId: 'overview', order: 10, ownerId: 'core', placement: 'dashboard' },
      { navigationId: 'saved', order: 20, ownerId: 'alpha', placement: 'dashboard' },
      { navigationId: 'new', order: 30, ownerId: 'alpha', placement: 'dashboard' },
      { navigationId: 'disabled', order: 40, ownerId: 'beta', placement: 'dashboard' },
    ] as const
    const shellNavigationOrder = resolveShellNavigationOrder(
      defaults,
      [
        { navigation_id: 'saved', owner_id: 'alpha', position: 0 },
        { navigation_id: 'overview', owner_id: 'core', position: 1 },
        { navigation_id: 'retained', owner_id: 'removed', position: 0 },
      ],
      new Set(['core', 'alpha']),
    )
    mocks.loadModuleRuntimeState.mockResolvedValue({
      enabledModuleIds: ['alpha'],
      enabledSections: [],
      shellNavigationOrder,
    })

    const response = await app.request('/api/modules', { headers: sessionCookie })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({
      enabledModuleIds: ['alpha'],
      enabledSections: [],
      shellNavigationOrder: {
        character: [],
        dashboard: [
          { ownerId: 'alpha', navigationId: 'saved' },
          { ownerId: 'core', navigationId: 'overview' },
          { ownerId: 'alpha', navigationId: 'new' },
        ],
      },
    })
  })

  test('allows only the deployment administrator to rearrange shared navigation', async () => {
    const shellNavigationOrder = {
      character: [],
      dashboard: [{ ownerId: 'core', navigationId: 'overview' }],
    }
    mocks.saveInstalledShellNavigationOrder.mockResolvedValue(shellNavigationOrder)
    const request = {
      body: JSON.stringify({ shellNavigationOrder }),
      headers: {
        ...sessionCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      method: 'PUT',
    }

    const ordinaryResponse = await app.request('/api/admin/shell-navigation-order', request)
    expect(ordinaryResponse.status).toBe(401)
    expect(mocks.saveInstalledShellNavigationOrder).not.toHaveBeenCalled()

    mocks.findAdminSession.mockResolvedValue({
      adminId: 'admin-1',
      email: 'owner@example.com',
      organization: null,
      role: 'owner',
    })
    const administratorResponse = await app.request('/api/admin/shell-navigation-order', {
      ...request,
      headers: {
        ...request.headers,
        Cookie:
          'eve_space_session=session-token; eve_space_admin_session=administrator-session-token',
      },
    })

    expect(administratorResponse.status).toBe(200)
    await expect(administratorResponse.json()).resolves.toStrictEqual({ shellNavigationOrder })
    expect(mocks.saveInstalledShellNavigationOrder).toHaveBeenCalledWith(shellNavigationOrder)
  })
})
