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
    events: [] as string[],
    findAdminSession: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    isInstalledModuleEnabled: vi.fn(),
    loadModuleRuntimeState: vi.fn(),
    saveInstalledShellNavigationOrder: vi.fn(),
    sessionHandler: vi.fn(),
    ownedHandler: vi.fn(),
    createOwnedCharacterCoreReads: vi.fn(),
  }
})

vi.mock('../src/env.js', () => ({
  env: {
    ADMIN_SETUP_SECRET: undefined,
    SESSION_COOKIE_SECURE: false,
    WEB_ORIGIN: 'http://localhost:3000',
  },
  getSsoConfig: vi.fn(),
  isSsoConfigured: () => false,
}))

vi.mock('../src/auth-store.js', () => ({
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

vi.mock('../src/admin-store.js', () => ({
  createAdminSession: vi.fn(),
  createDeployment: vi.fn(),
  deleteAdminSession: vi.fn(),
  DeploymentAlreadyConfiguredError: class extends Error {},
  findAdminCredentials: vi.fn(),
  findAdminSession: mocks.findAdminSession,
  isDeploymentConfigured: vi.fn(),
  updateDeploymentOrganization: vi.fn(),
}))

vi.mock('../src/platform/module-settings.js', () => ({
  isCompleteShellNavigationOrder: () => true,
  isInstalledModuleEnabled: mocks.isInstalledModuleEnabled,
  listInstalledModuleSettings: vi.fn(),
  loadInstalledShellNavigationOrder: vi.fn(),
  loadModuleRuntimeState: mocks.loadModuleRuntimeState,
  saveInstalledShellNavigationOrder: mocks.saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled: vi.fn(),
}))

vi.mock('../src/platform/core-read-capabilities.js', () => ({
  createOwnedCharacterCoreReads: mocks.createOwnedCharacterCoreReads,
  sdeCoreReads: { loadPublishedTypeGroups: vi.fn() },
}))

vi.mock('../src/generated/platform/installed-module-routes.js', async () => {
  const { Hono } = await import('hono')
  const { loadSession, requireSession } = await import('../src/middleware/auth-session.js')
  const { requireInstalledModuleEnabled } = await import('../src/middleware/module-enablement.js')
  const { exposeAuthenticatedSessionModuleContext, exposeOwnedCharacterModuleContext } =
    await import('../src/middleware/module-authorization.js')
  const { characterIdParams, loadOwnedCharacter } =
    await import('../src/middleware/owned-character.js')
  const { zValidator } = await import('../src/validation.js')

  const sessionRoutes = new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', (context) => {
    mocks.events.push('session-handler')
    mocks.sessionHandler(context.var.platform)
    return context.json({ platform: context.var.platform }, 200)
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
        new Hono()
          .use('*', requireInstalledModuleEnabled('alpha'))
          .use('*', loadSession)
          .use('*', requireSession)
          .use('*', exposeAuthenticatedSessionModuleContext)
          .route('/', sessionRoutes),
      )
      .route(
        '/alpha/characters/:characterId',
        new Hono()
          .use('*', requireInstalledModuleEnabled('alpha'))
          .use('*', loadSession)
          .use('*', requireSession)
          .use('*', zValidator('param', characterIdParams))
          .use('*', loadOwnedCharacter)
          .use('*', exposeOwnedCharacterModuleContext)
          .route('/', ownedRoutes),
      ),
  }
})

import { app } from '../src/index.js'

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
    expect(mocks.events).toEqual(['enablement', 'session', 'ownership', 'owned-handler'])
    expect(mocks.createOwnedCharacterCoreReads).toHaveBeenCalledWith({
      userId: session.userId,
      characterId: ownedCharacter.characterId,
      subjectLifecycleId: ownedCharacter.subjectLifecycleId,
    })
    expect(Object.keys(mocks.ownedHandler.mock.calls[0]?.[0] ?? {})).toEqual([
      'authorization',
      'coreReads',
    ])
  })

  test('passes only user identity to authenticated-session routes', async () => {
    const response = await app.request('/api/modules/alpha/profile', { headers: sessionCookie })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      platform: {
        authorization: { strategy: 'authenticated-session', userId: session.userId },
      },
    })
    expect(Object.keys(mocks.sessionHandler.mock.calls[0]?.[0] ?? {})).toEqual(['authorization'])
  })
})

describe('full-root platform shell boundaries', () => {
  test('serves resolved defaults with new entries appended and unavailable owners omitted', async () => {
    const { resolveShellNavigationOrder } = await vi.importActual<
      typeof import('../src/platform/module-settings.js')
    >('../src/platform/module-settings.js')
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
