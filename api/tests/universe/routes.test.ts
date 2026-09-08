import { testClient } from 'hono/testing'
import type { InferResponseType } from 'hono/client'
import { beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import type { UniverseTypeDetails } from '../../src/universe/type-details.js'

const mocks = vi.hoisted(() => ({
  calculateUniverseRoutes: vi.fn(),
  getUniverseTypeDetails: vi.fn(),
}))

vi.mock('../../src/universe/route-calculator.js', () => ({
  calculateUniverseRoutes: mocks.calculateUniverseRoutes,
}))
vi.mock('../../src/universe/type-details.js', () => ({
  getUniverseTypeDetails: mocks.getUniverseTypeDetails,
}))

import { app } from '../../src/index.js'
import { maximumUniverseRouteDestinations, universeRoutes } from '../../src/universe/routes.js'
import type { UniverseRouteResult } from '../../src/universe/route-types.js'

const typeDetails = {
  typeId: 34,
  name: 'Tritanium',
  description: 'The main building block of space structures.',
  group: { id: 18, name: 'Mineral' },
  category: { id: 4, name: 'Material' },
  detail: null,
} satisfies UniverseTypeDetails

beforeEach(() => {
  mocks.calculateUniverseRoutes.mockImplementation((request) =>
    Promise.resolve({
      originSystemId: request.originSystemId,
      policy: request.policy,
      sdeBuildNumber: 1234,
      routes: request.destinationSystemIds.map((destinationSystemId: number) => ({
        destinationSystemId,
        jumps: destinationSystemId === 30_000_003 ? null : destinationSystemId - 30_000_001,
      })),
    }),
  )
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

describe('universe route calculation endpoint', () => {
  test('is anonymous, canonicalizes destinations, and returns ordered no-store results', async () => {
    const response = await app.request('/api/universe/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originSystemId: 30_000_001,
        destinationSystemIds: [30_000_003, 30_000_001, 30_000_002],
        policy: { kind: 'shortest' },
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      originSystemId: 30_000_001,
      policy: { kind: 'shortest' },
      sdeBuildNumber: 1234,
      routes: [
        { destinationSystemId: 30_000_001, jumps: 0 },
        { destinationSystemId: 30_000_002, jumps: 1 },
        { destinationSystemId: 30_000_003, jumps: null },
      ],
    })
    expect(mocks.calculateUniverseRoutes).toHaveBeenCalledWith({
      originSystemId: 30_000_001,
      destinationSystemIds: [30_000_001, 30_000_002, 30_000_003],
      policy: { kind: 'shortest' },
    })
  })

  test.each([
    [
      'invalid origin',
      { originSystemId: 0, destinationSystemIds: [1], policy: { kind: 'shortest' } },
    ],
    [
      'unsafe origin',
      {
        originSystemId: Number.MAX_SAFE_INTEGER + 1,
        destinationSystemIds: [1],
        policy: { kind: 'shortest' },
      },
    ],
    [
      'missing destinations',
      { originSystemId: 1, destinationSystemIds: [], policy: { kind: 'shortest' } },
    ],
    [
      'duplicate destinations',
      { originSystemId: 1, destinationSystemIds: [2, 2], policy: { kind: 'shortest' } },
    ],
    [
      'invalid destination',
      { originSystemId: 1, destinationSystemIds: [-2], policy: { kind: 'shortest' } },
    ],
    [
      'unsupported policy',
      { originSystemId: 1, destinationSystemIds: [2], policy: { kind: 'safer' } },
    ],
  ])('rejects %s before topology calculation', async (_description, body) => {
    const response = await app.request('/api/universe/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.calculateUniverseRoutes).not.toHaveBeenCalled()
  })

  test('enforces the destination bound before topology calculation', async () => {
    const response = await app.request('/api/universe/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originSystemId: 1,
        destinationSystemIds: Array.from(
          { length: maximumUniverseRouteDestinations + 1 },
          (_, index) => index + 1,
        ),
        policy: { kind: 'shortest' },
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.calculateUniverseRoutes).not.toHaveBeenCalled()
  })

  test('maps unavailable topology to a controlled no-store response', async () => {
    mocks.calculateUniverseRoutes.mockRejectedValue(new Error('database unavailable'))

    const response = await app.request('/api/universe/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originSystemId: 1,
        destinationSystemIds: [2],
        policy: { kind: 'shortest' },
      }),
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      code: 'UNIVERSE_TOPOLOGY_UNAVAILABLE',
      message: 'Universe route topology is temporarily unavailable.',
    })
  })

  test('retains the inferred route request and response contract', async () => {
    const client = testClient(universeRoutes)
    type Success = InferResponseType<(typeof client.routes)['$post'], 200>
    expectTypeOf<Success>().toEqualTypeOf<UniverseRouteResult>()

    const response = await client.routes.$post({
      json: {
        originSystemId: 1,
        destinationSystemIds: [2],
        policy: { kind: 'shortest' },
      },
    })

    expect(response.status).toBe(200)
  })
})
