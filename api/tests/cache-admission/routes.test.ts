import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  loadCacheAdmissionContext: vi.fn(),
}))

vi.mock('../../src/auth/session-store.js', () => ({ findSession: mocks.findSession }))
vi.mock('../../src/cache-admission/service.js', () => ({
  loadCacheAdmissionContext: mocks.loadCacheAdmissionContext,
}))

import { app } from '../../src/index.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const responseBody = {
  userId,
  characters: [
    {
      characterId: 90_000_001,
      admissionRevision:
        'character-admission:v1:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  ],
  organization: {
    organizationVersion: 4,
    admissionRevision:
      'organization-admission:v1:sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    validUntil: '2026-09-14T13:00:00.000Z',
    admissionScopes: ['organization:v1:core:member:organization.activities'],
  },
}

beforeEach(() => {
  mocks.findSession.mockResolvedValue(null)
  mocks.loadCacheAdmissionContext.mockResolvedValue(responseBody)
})

describe('GET /api/me/cache-admission', () => {
  test('rejects anonymous requests with private no-store headers', async () => {
    const response = await app.request('/api/me/cache-admission')

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Log in with EVE Online first.',
    })
    expect(mocks.loadCacheAdmissionContext).not.toHaveBeenCalled()
  })

  test('returns the intentional mounted DTO for the authenticated session user', async () => {
    mocks.findSession.mockResolvedValue({
      userId,
      mainCharacter: {
        characterId: 90_000_001,
        name: 'Cache Pilot',
        corporationId: 98_000_001,
        allianceId: null,
        isMain: true,
      },
    })
    const response = await app.request('/api/me/cache-admission', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
    await expect(response.json()).resolves.toEqual(responseBody)
    expect(mocks.findSession).toHaveBeenCalledWith('session-token')
    expect(mocks.loadCacheAdmissionContext).toHaveBeenCalledWith(userId)
  })

  test('preserves the cache-admission route in the chained Hono contract', () => {
    const client = testClient(app)

    expectTypeOf(client.api.me['cache-admission'].$get).toBeFunction()
  })
})
