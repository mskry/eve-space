import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CharacterTokenNotFoundError extends Error {}
  class CharacterOwnershipConflictError extends Error {}
  class TokenRefreshLockUnavailableError extends Error {}
  return {
    CharacterOwnershipConflictError,
    CharacterTokenNotFoundError,
    TokenRefreshLockUnavailableError,
    enabled: true,
    authorizeOrganizationContribution: vi.fn(),
    events: [] as string[],
    findAdminSession: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    hasOrganizationContext: true,
    isInstalledModuleEnabled: vi.fn(),
    loadModuleRuntimeState: vi.fn(),
    saveInstalledShellNavigationOrder: vi.fn(),
    sessionHandler: vi.fn(),
    unexpectedError: new Error('refresh-token private-host'),
    ownedHandler: vi.fn(),
    createOwnedCharacterCoreReads: vi.fn(),
    createPlatformModuleCollectionStatusReads: vi.fn(),
    collectionStatus: { read: vi.fn() },
    organizationContext: {
      organizationVersion: 7,
      state: 'compliant' as 'pending' | 'compliant' | 'review_required' | 'suspended',
      evidenceFreshness: 'fresh' as 'fresh' | 'stale' | 'unavailable',
      reviewDeadline: null as Date | null,
      accessValidUntil: new Date(Date.now() + 60_000) as Date | null,
      blocked: false,
    },
  }
})

vi.mock('../../src/env.js', () => ({
  env: {
    ADMIN_SETUP_SECRET: undefined,
    SESSION_COOKIE_SECURE: false,
    WEB_ORIGIN: 'http://localhost:3000',
  },
  getSsoConfig: vi.fn(),
  isSsoConfigured: () => false,
}))

vi.mock('../../src/auth/store.js', () => ({
  attachCharacter: vi.fn(),
  CharacterOwnershipConflictError: mocks.CharacterOwnershipConflictError,
  CharacterTokenNotFoundError: mocks.CharacterTokenNotFoundError,
  consumeOAuthState: vi.fn(),
  deleteCharacter: vi.fn(),
  deleteSession: vi.fn(),
  findCharacterToken: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: vi.fn(),
  reauthorizeCharacter: vi.fn(),
  saveLogin: vi.fn(),
  setMainCharacter: vi.fn(),
  storeOAuthState: vi.fn(),
  TokenRefreshLockUnavailableError: mocks.TokenRefreshLockUnavailableError,
  updateCharacterToken: vi.fn(),
  withCharacterTokenRefreshLock: vi.fn(),
}))

vi.mock('../../src/admin/store.js', () => ({
  createAdminSession: vi.fn(),
  createDeployment: vi.fn(),
  deleteAdminSession: vi.fn(),
  DeploymentAlreadyConfiguredError: class extends Error {},
  findAdminCredentials: vi.fn(),
  findAdminSession: mocks.findAdminSession,
  isDeploymentConfigured: vi.fn(),
  updateDeploymentOrganization: vi.fn(),
}))

vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleEnabled: mocks.isInstalledModuleEnabled,
  listInstalledModuleSettings: vi.fn(),
  loadInstalledShellNavigationOrder: vi.fn(),
  loadModuleRuntimeState: mocks.loadModuleRuntimeState,
  saveInstalledShellNavigationOrder: mocks.saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled: vi.fn(),
}))
vi.mock('../../src/platform/module-navigation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isCompleteShellNavigationOrder: () => true,
}))

vi.mock('../../src/platform/core-read-capabilities.js', () => ({
  createOwnedCharacterCoreReads: mocks.createOwnedCharacterCoreReads,
  sdeCoreReads: { loadPublishedTypeGroups: vi.fn() },
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
    if (mocks.hasOrganizationContext) context.set('organization', mocks.organizationContext)
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
  const organization = { audience: 'member', requiredPermission: 'alpha.view' } as const

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
          { audience: 'hr', requiredPermission: 'alpha.view' },
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
  userId: 'user-1',
  mainCharacter: {
    characterId: 90_000_001,
    name: 'Main Character',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
  },
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
  mocks.isInstalledModuleEnabled.mockImplementation(async () => {
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
    organizationVersion: 7,
    state: 'compliant',
    evidenceFreshness: 'fresh',
    reviewDeadline: null,
    accessValidUntil: new Date(Date.now() + 60_000),
    blocked: false,
  }
  mocks.authorizeOrganizationContribution.mockImplementation(async () => {
    mocks.events.push('authorization')
    return {
      authorized: true,
      context: {
        organizationVersion: 7,
        audience: 'member',
        requiredPermission: 'alpha.view',
        entitlementScope: 'all',
      },
    }
  })
})

describe('full-root platform module authorization', () => {
  test('checks disablement before authentication, validation, ownership, and module code', async () => {
    mocks.enabled = false

    const response = await app.request('/api/modules/alpha/characters/not-an-id')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'Route not found' })
    expect(mocks.events).toEqual(['enablement'])
  })

  test('authenticates before validating an owned-character path', async () => {
    const anonymous = await app.request('/api/modules/alpha/characters/not-an-id')
    expect(anonymous.status).toBe(401)

    const authenticated = await app.request('/api/modules/alpha/characters/not-an-id', {
      headers: sessionCookie,
    })
    expect(authenticated.status).toBe(400)
    await expect(authenticated.json()).resolves.toEqual({
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

    expect(responses.map(({ status }) => status)).toEqual([404, 404])
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
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
    await expect(response.json()).resolves.toEqual({
      authorization: {
        strategy: 'owned-character',
        userId: session.userId,
        characterId: ownedCharacter.characterId,
        subjectLifecycleId: ownedCharacter.subjectLifecycleId,
      },
      hasCoreReads: true,
    })
    expect(mocks.events).toEqual([
      'enablement',
      'session',
      'organization',
      'authorization',
      'ownership',
      'owned-handler',
    ])
    expect(mocks.createOwnedCharacterCoreReads).toHaveBeenCalledWith({
      userId: session.userId,
      characterId: ownedCharacter.characterId,
      subjectLifecycleId: ownedCharacter.subjectLifecycleId,
    })
    expect(Object.keys(mocks.ownedHandler.mock.calls[0]?.[0] ?? {})).toEqual([
      'authorization',
      'collectionStatus',
      'organization',
      'coreReads',
    ])
  })

  test('passes only user identity to authenticated-session routes', async () => {
    const response = await app.request('/api/modules/alpha/profile', { headers: sessionCookie })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      platform: {
        authorization: { strategy: 'authenticated-session', userId: session.userId },
        organization: {
          organizationVersion: 7,
          audience: 'member',
          requiredPermission: 'alpha.view',
          entitlementScope: 'all',
        },
      },
    })
    expect(Object.keys(mocks.sessionHandler.mock.calls[0]?.[0] ?? {})).toEqual([
      'authorization',
      'collectionStatus',
      'organization',
    ])
  })

  test('uses public canonical validation and safe module error contracts', async () => {
    const invalid = await app.request('/api/modules/alpha/profile/validated', {
      method: 'POST',
      headers: { ...sessionCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ message: 'Name is required.' })
    expect(invalid.headers.get('cache-control')).toBe('private, no-store')
    expect(invalid.headers.get('vary')).toContain('Cookie')
    expect(mocks.sessionHandler).not.toHaveBeenCalled()

    const expected = await app.request('/api/modules/alpha/profile/expected-error', {
      headers: sessionCookie,
    })
    expect(expected.status).toBe(409)
    await expect(expected.json()).resolves.toEqual({
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
      await expect(response.json()).resolves.toEqual({ message: 'Internal server error' })
      expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/refresh-token|private-host/)
      expect(consoleError).toHaveBeenCalledOnce()
      expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual(
        expect.objectContaining({
          level: 'error',
          msg: 'Unhandled API error',
          requestId: expect.any(String),
          category: 'unexpected application failure',
          errorName: 'Error',
          method: 'GET',
          path: '/api/modules/alpha/profile/unexpected-error',
          stack: expect.any(String),
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

  test.each([
    [true, expect.stringMatching(/^at /)],
    [false, undefined],
  ] as const)(
    'omits multiline messages from logs with stack frames: %s',
    async (withFrames, expectedStack) => {
      const cause = new Error('connection failed\ndsn=postgres://user:pw@private-host')
      mocks.unexpectedError = new Error('request failed\nrefresh-token=private-value', { cause })
      if (withFrames) {
        cause.stack = `Error: ${cause.message}\n    at cause (file:///workspace/private/cause.ts?token=private-value:10:2)`
        mocks.unexpectedError.stack = `Error: ${mocks.unexpectedError.message}\n    at handler (file:///workspace/private/handler.ts?secret=private-value:20:4)`
      } else {
        cause.stack = `Error: ${cause.message}`
        mocks.unexpectedError.stack = `Error: ${mocks.unexpectedError.message}`
      }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      apiLogger.enableLogging()
      try {
        const response = await app.request('/api/modules/alpha/profile/unexpected-error', {
          headers: sessionCookie,
        })
        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toEqual({ message: 'Internal server error' })
        expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
          /dsn=|postgres:|user:pw|private-host|refresh-token|private-value/,
        )
        expect(consoleError).toHaveBeenCalledOnce()
        const loggedEvent = JSON.parse(String(consoleError.mock.calls[0]?.[0]))
        expect(loggedEvent).toEqual(
          expect.objectContaining({
            level: 'error',
            msg: 'Unhandled API error',
            requestId: expect.any(String),
            ...(withFrames ? { stack: expectedStack } : {}),
            cause: expect.objectContaining({
              errorName: 'Error',
              ...(withFrames ? { stack: expectedStack } : {}),
            }),
          }),
        )
        expect(Object.hasOwn(loggedEvent, 'stack')).toBe(withFrames)
        expect(Object.hasOwn(loggedEvent.cause, 'stack')).toBe(withFrames)
      } finally {
        apiLogger.disableLogging()
        consoleError.mockRestore()
        consoleInfo.mockRestore()
      }
    },
  )

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
      { ownerId: 'core', navigationId: 'overview', placement: 'dashboard', order: 10 },
      { ownerId: 'alpha', navigationId: 'saved', placement: 'dashboard', order: 20 },
      { ownerId: 'alpha', navigationId: 'new', placement: 'dashboard', order: 30 },
      { ownerId: 'beta', navigationId: 'disabled', placement: 'dashboard', order: 40 },
    ] as const
    const shellNavigationOrder = resolveShellNavigationOrder(
      defaults,
      [
        { owner_id: 'alpha', navigation_id: 'saved', position: 0 },
        { owner_id: 'core', navigation_id: 'overview', position: 1 },
        { owner_id: 'removed', navigation_id: 'retained', position: 0 },
      ],
      new Set(['core', 'alpha']),
    )
    mocks.loadModuleRuntimeState.mockResolvedValue({
      enabledModuleIds: ['alpha'],
      shellNavigationOrder,
    })

    const response = await app.request('/api/modules', { headers: sessionCookie })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      enabledModuleIds: ['alpha'],
      shellNavigationOrder: {
        dashboard: [
          { ownerId: 'alpha', navigationId: 'saved' },
          { ownerId: 'core', navigationId: 'overview' },
          { ownerId: 'alpha', navigationId: 'new' },
        ],
        character: [],
      },
    })
  })

  test('allows only the deployment administrator to rearrange shared navigation', async () => {
    const shellNavigationOrder = {
      dashboard: [{ ownerId: 'core', navigationId: 'overview' }],
      character: [],
    }
    mocks.saveInstalledShellNavigationOrder.mockResolvedValue(shellNavigationOrder)
    const request = {
      method: 'PUT',
      headers: {
        ...sessionCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ shellNavigationOrder }),
    }

    const ordinaryResponse = await app.request('/api/admin/shell-navigation-order', request)
    expect(ordinaryResponse.status).toBe(401)
    expect(mocks.saveInstalledShellNavigationOrder).not.toHaveBeenCalled()

    mocks.findAdminSession.mockResolvedValue({
      adminId: 'admin-1',
      email: 'owner@example.com',
      role: 'owner',
      organization: null,
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
    await expect(administratorResponse.json()).resolves.toEqual({ shellNavigationOrder })
    expect(mocks.saveInstalledShellNavigationOrder).toHaveBeenCalledWith(shellNavigationOrder)
  })
})
