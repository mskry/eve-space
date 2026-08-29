import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isInstalledModuleEnabled: vi.fn(),
}))

vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleEnabled: mocks.isInstalledModuleEnabled,
}))

import { requireInstalledModuleEnabled } from '../../src/middleware/module-enablement.js'

const authenticate = vi.fn(async (_context: Context, next: Next) => {
  await next()
})
const moduleHandler = vi.fn((context: Context) => context.json({ ok: true } as const, 200))
const contributedRoutes = new Hono().use('*', authenticate).get('/', moduleHandler)
const installedRoutes = new Hono().route(
  '/alpha/characters/:characterId',
  new Hono().use('*', requireInstalledModuleEnabled('alpha')).route('/', contributedRoutes),
)
const app = new Hono().route('/api/modules', installedRoutes)

beforeEach(() => {
  mocks.isInstalledModuleEnabled.mockReset()
  authenticate.mockClear()
  moduleHandler.mockClear()
})

describe('module enablement middleware', () => {
  test('returns the root 404 contract before downstream authentication or module code', async () => {
    mocks.isInstalledModuleEnabled.mockResolvedValue(false)

    const response = await app.request('/api/modules/alpha/characters/90000001')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'Route not found' })
    expect(mocks.isInstalledModuleEnabled).toHaveBeenCalledWith('alpha')
    expect(authenticate).not.toHaveBeenCalled()
    expect(moduleHandler).not.toHaveBeenCalled()
  })

  test('preserves literal route inference and invokes contributed code only when enabled', async () => {
    mocks.isInstalledModuleEnabled.mockResolvedValue(true)
    const client = testClient(app)

    const response = await client.api.modules.alpha.characters[':characterId'].$get({
      param: { characterId: '90000001' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(authenticate).toHaveBeenCalledOnce()
    expect(moduleHandler).toHaveBeenCalledOnce()
  })
})
