import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))

vi.mock('../src/db/client.js', () => ({ sql: mocks.sql }))

import { healthRoutes } from '../src/routes/health.js'

describe('health route', () => {
  beforeEach(() => mocks.sql.mockResolvedValue([{ '?column?': 1 }]))

  test('remains a database-only health probe', async () => {
    const response = await healthRoutes.request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', database: 'connected' })
    expect(mocks.sql).toHaveBeenCalledOnce()
  })
})
