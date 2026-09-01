import { testClient } from 'hono/testing'
import type { InferResponseType } from 'hono/client'
import { beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import type { UniverseTypeDetails } from '../../src/universe/type-details.js'

const mocks = vi.hoisted(() => ({
  getUniverseTypeDetails: vi.fn(),
}))

vi.mock('../../src/universe/type-details.js', () => ({
  getUniverseTypeDetails: mocks.getUniverseTypeDetails,
}))

import { app } from '../../src/index.js'
import { universeRoutes } from '../../src/universe/routes.js'

const typeDetails = {
  typeId: 34,
  name: 'Tritanium',
  description: 'The main building block of space structures.',
  group: { id: 18, name: 'Mineral' },
  category: { id: 4, name: 'Material' },
  detail: null,
} satisfies UniverseTypeDetails

beforeEach(() => {
  mocks.getUniverseTypeDetails.mockResolvedValue(typeDetails)
})

describe('universe type detail route', () => {
  test('is anonymously accessible at the mounted API path with public replaceable caching', async () => {
    const response = await app.request('/api/universe/types/34')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(typeDetails)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=3600',
    )
    expect(response.headers.get('cache-control')).not.toContain('immutable')
    expect(mocks.getUniverseTypeDetails).toHaveBeenCalledWith(34)
  })

  test.each(['0', '-1', '01', '1.0', '+1', '9007199254740992'])(
    'rejects non-canonical type ID %s before querying static data',
    async (typeId) => {
      const response = await app.request(`/api/universe/types/${typeId}`)

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        message: 'Type ID must be a canonical positive safe integer.',
      })
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(mocks.getUniverseTypeDetails).not.toHaveBeenCalled()
    },
  )

  test('accepts the largest canonical safe integer', async () => {
    const response = await app.request(`/api/universe/types/${Number.MAX_SAFE_INTEGER}`)

    expect(response.status).toBe(200)
    expect(mocks.getUniverseTypeDetails).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER)
  })

  test('returns one deterministic non-cacheable not-found outcome', async () => {
    mocks.getUniverseTypeDetails.mockResolvedValue(null)

    const response = await app.request('/api/universe/types/3300')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      code: 'TYPE_NOT_FOUND',
      message: 'Type not found.',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('maps database failure to a non-cacheable unavailable outcome', async () => {
    mocks.getUniverseTypeDetails.mockRejectedValue(new Error('database credentials'))

    const response = await app.request('/api/universe/types/3300')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'STATIC_DATA_UNAVAILABLE',
      message: 'Static item data is temporarily unavailable.',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('retains the direct typed DTO contract', async () => {
    const client = testClient(universeRoutes)
    type Success = InferResponseType<(typeof client.types)[':typeId']['$get'], 200>
    expectTypeOf<Success>().toEqualTypeOf<UniverseTypeDetails>()

    const response = await client.types[':typeId'].$get({ param: { typeId: '34' } })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(typeDetails)
  })
})
