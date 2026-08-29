import { describe, expect, test } from 'vitest'
import { app } from '../../src/index.js'

describe('generated module route composition', () => {
  test('keeps the root not-found contract with no installed feature routes', async () => {
    const response = await app.request('/api/modules/not-installed')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'Route not found' })
  })

  test('does not change existing core route composition', async () => {
    const response = await app.request('/auth/config')

    expect(response.status).toBe(200)
  })
})
