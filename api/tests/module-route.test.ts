import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  loadRuntimeState: vi.fn(),
}))

vi.mock('../src/auth-store.js', () => ({ findSession: mocks.findSession }))
vi.mock('../src/platform/module-settings.js', () => ({
  loadModuleRuntimeState: mocks.loadRuntimeState,
}))

import { moduleRuntimeRoutes } from '../src/routes/modules.js'

const runtimeState = {
  enabledModuleIds: ['alpha'],
  shellNavigationOrder: {
    dashboard: [{ ownerId: 'core', navigationId: 'core-overview' }],
    character: [{ ownerId: 'alpha', navigationId: 'alpha-character' }],
  },
}

beforeEach(() => {
  mocks.findSession.mockResolvedValue({ userId: 'user-id' })
  mocks.loadRuntimeState.mockResolvedValue(runtimeState)
})

describe('module runtime route', () => {
  test('requires the ordinary EVE application session', async () => {
    const response = await moduleRuntimeRoutes.request('/')

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Log in with EVE Online first.',
    })
    expect(mocks.loadRuntimeState).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('returns only resolved runtime state for an authenticated consumer', async () => {
    const response = await moduleRuntimeRoutes.request('/', {
      headers: { Cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(runtimeState)
    expect(mocks.findSession).toHaveBeenCalledWith('session-token')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })
})
