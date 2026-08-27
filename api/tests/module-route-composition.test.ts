import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { Hono } from 'hono'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  isInstalledModuleEnabled: vi.fn(),
}))

vi.mock('../src/auth-store.js', () => ({
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
}))
vi.mock('../src/platform/module-settings.js', () => ({
  isInstalledModuleEnabled: mocks.isInstalledModuleEnabled,
}))

import { platformModuleRouteComposers } from '../src/platform/module-route-composition.js'

describe('platform module route composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isInstalledModuleEnabled.mockResolvedValue(true)
    mocks.findSession.mockResolvedValue({
      userId: 'user-1',
      mainCharacter: {
        characterId: 9001,
        name: 'Main',
        corporationId: 98000001,
        allianceId: null,
        isMain: true,
      },
    })
    mocks.findOwnedCharacter.mockResolvedValue({
      characterId: 9001,
      name: 'Main',
      corporationId: 98000001,
      allianceId: null,
      isMain: true,
      subjectLifecycleId: 'lifecycle-1',
    })
  })

  test('composes authenticated-session context behind enablement and session guards', async () => {
    const feature = new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.authorization),
    )
    const app = new Hono().route(
      '/alpha',
      platformModuleRouteComposers['authenticated-session']('alpha', feature),
    )

    const response = await app.request('/alpha', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      strategy: 'authenticated-session',
      userId: 'user-1',
    })
  })

  test('composes owned-character validation and ownership context', async () => {
    const feature = new Hono<PlatformOwnedCharacterRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.authorization),
    )
    const app = new Hono().route(
      '/alpha/characters/:characterId',
      platformModuleRouteComposers['owned-character']('alpha', feature),
    )

    const response = await app.request('/alpha/characters/9001', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      strategy: 'owned-character',
      userId: 'user-1',
      characterId: 9001,
      subjectLifecycleId: 'lifecycle-1',
    })
  })

  test('hides routes for disabled modules before loading a session', async () => {
    mocks.isInstalledModuleEnabled.mockResolvedValue(false)
    const feature = new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.authorization),
    )
    const app = new Hono().route(
      '/alpha',
      platformModuleRouteComposers['authenticated-session']('alpha', feature),
    )

    const response = await app.request('/alpha')

    expect(response.status).toBe(404)
    expect(mocks.findSession).not.toHaveBeenCalled()
  })
})
