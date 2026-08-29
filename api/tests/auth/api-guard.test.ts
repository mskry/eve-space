import { describe, expect, test } from 'vitest'
import { app } from '../../src/index.js'

describe('application API session boundary', () => {
  test.each(['/api/characters/90000001', '/api/corporations/1', '/api/admin/setup'])(
    'rejects anonymous application API access to %s',
    async (path) => {
      const response = await app.request(path)

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        code: 'AUTH_REQUIRED',
        message: 'Log in with EVE Online first.',
      })
    },
  )

  test('keeps the EVE authorization configuration available without a session', async () => {
    const response = await app.request('/auth/config')

    expect(response.status).toBe(200)
  })
})
