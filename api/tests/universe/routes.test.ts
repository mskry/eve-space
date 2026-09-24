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
  category: { id: 4, name: 'Material' },
  description: 'The main building block of space structures.',
  detail: null,
  group: { id: 18, name: 'Mineral' },
  name: 'Tritanium',
  typeId: 34,
} satisfies UniverseTypeDetails

beforeEach(() => {
  mocks.calculateUniverseRoutes.mockImplementation((request) =>
    Promise.resolve({
      originSystemId: request.originSystemId,
      policy: request.policy,
      routes: request.destinationSystemIds.map((destinationSystemId: number) => ({
        destinationSystemId,
        jumps: destinationSystemId === 30_000_003 ? null : destinationSystemId - 30_000_001,
      })),
      sdeBuildNumber: 1234,
    }),
  )
  mocks.getUniverseTypeDetails.mockResolvedValue(typeDetails)
})

describe('universe type detail route', () => {
  test('is anonymously accessible at the mounted API path with public replaceable caching', async () => {
    const response = await app.request('/api/universe/types/34')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual(typeDetails)
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
      await expect(response.json()).resolves.toStrictEqual({
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
    await expect(response.json()).resolves.toStrictEqual({
      code: 'TYPE_NOT_FOUND',
      message: 'Type not found.',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('maps database failure to a non-cacheable unavailable outcome', async () => {
    mocks.getUniverseTypeDetails.mockRejectedValue(new Error('database credentials'))

    const response = await app.request('/api/universe/types/3300')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toStrictEqual({
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
    expect(body).toStrictEqual(typeDetails)
  })
})

describe('universe route calculation endpoint', () => {
  test('is anonymous, canonicalizes destinations, and returns ordered no-store results', async () => {
    const response = await app.request('/api/universe/routes', {
      body: JSON.stringify({
        originSystemId: 30_000_001,
        destinationSystemIds: [30_000_003, 30_000_001, 30_000_002],
        policy: { kind: 'shortest' },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toStrictEqual({
      originSystemId: 30_000_001,
      policy: { kind: 'shortest' },
      routes: [
        { destinationSystemId: 30_000_001, jumps: 0 },
        { destinationSystemId: 30_000_002, jumps: 1 },
        { destinationSystemId: 30_000_003, jumps: null },
      ],
      sdeBuildNumber: 1234,
    })
    expect(mocks.calculateUniverseRoutes).toHaveBeenCalledWith({
      destinationSystemIds: [30_000_001, 30_000_002, 30_000_003],
      originSystemId: 30_000_001,
      policy: { kind: 'shortest' },
    })
  })

  test.each([
    [
      'invalid origin',
      { destinationSystemIds: [1], originSystemId: 0, policy: { kind: 'shortest' } },
    ],
    [
      'unsafe origin',
      {
        destinationSystemIds: [1],
        originSystemId: Number.MAX_SAFE_INTEGER + 1,
        policy: { kind: 'shortest' },
      },
    ],
    [
      'missing destinations',
      { destinationSystemIds: [], originSystemId: 1, policy: { kind: 'shortest' } },
    ],
    [
      'duplicate destinations',
      { destinationSystemIds: [2, 2], originSystemId: 1, policy: { kind: 'shortest' } },
    ],
    [
      'invalid destination',
      { destinationSystemIds: [-2], originSystemId: 1, policy: { kind: 'shortest' } },
    ],
    [
      'unsupported policy',
      { destinationSystemIds: [2], originSystemId: 1, policy: { kind: 'safer' } },
    ],
  ])('rejects %s before topology calculation', async (_description, body) => {
    const response = await app.request('/api/universe/routes', {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.calculateUniverseRoutes).not.toHaveBeenCalled()
  })

  test('enforces the destination bound before topology calculation', async () => {
    const response = await app.request('/api/universe/routes', {
      body: JSON.stringify({
        originSystemId: 1,
        destinationSystemIds: Array.from(
          { length: maximumUniverseRouteDestinations + 1 },
          (_, index) => index + 1,
        ),
        policy: { kind: 'shortest' },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
    expect(mocks.calculateUniverseRoutes).not.toHaveBeenCalled()
  })

  test('maps unavailable topology to a controlled no-store response', async () => {
    mocks.calculateUniverseRoutes.mockRejectedValue(new Error('database unavailable'))

    const response = await app.request('/api/universe/routes', {
      body: JSON.stringify({
        originSystemId: 1,
        destinationSystemIds: [2],
        policy: { kind: 'shortest' },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toStrictEqual({
      code: 'UNIVERSE_TOPOLOGY_UNAVAILABLE',
      message: 'Universe route topology is temporarily unavailable.',
    })
  })

  test('rate-limits one anonymous client before route calculation', async () => {
    const body = JSON.stringify({
      destinationSystemIds: [2],
      originSystemId: 1,
      policy: { kind: 'shortest' },
    })
    let response: Response | undefined
    for (let index = 0; index <= 60; index += 1) {
      response = await universeRoutes.fetch(
        new Request('http://localhost/routes', {
          body,
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
        {
          incoming: {
            socket: {
              remoteAddress: '198.51.100.30',
              remoteFamily: 'IPv4',
              remotePort: 1,
            },
          },
        },
      )
    }

    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('60')
    await expect(response?.json()).resolves.toStrictEqual({
      code: 'UNIVERSE_ROUTE_RATE_LIMITED',
      message: 'Too many universe route requests.',
    })
    expect(mocks.calculateUniverseRoutes).toHaveBeenCalledTimes(60)
  })

  test('retains the inferred route request and response contract', async () => {
    const client = testClient(universeRoutes)
    type Success = InferResponseType<(typeof client.routes)['$post'], 200>
    expectTypeOf<Success>().toEqualTypeOf<UniverseRouteResult>()

    const response = await client.routes.$post({
      json: {
        destinationSystemIds: [2],
        originSystemId: 1,
        policy: { kind: 'shortest' },
      },
    })

    expect(response.status).toBe(200)
  })
})
