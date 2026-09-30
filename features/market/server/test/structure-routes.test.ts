import type { PlatformOwnedCharacterRouteEnv } from '@eve-space/platform-module-contract/server'
import { Hono } from 'hono'
import { beforeEach, expect, test, vi } from 'vitest'
import { marketStructureRoutes } from '../src/structure-routes.js'

const characterId = 90000001
const subjectLifecycleId = '00000000-0000-4000-8000-000000000001'
const structureId = 1020000000000
const persistence = {
  readStructureBook: vi.fn(),
  reserveStructureDemand: vi.fn(),
  releaseStructureDemand: vi.fn(),
}
const currentGeneration = vi.fn()
const request = vi.fn()
const route = marketStructureRoutes({
  coreData: {},
  persistence,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
})
const app = new Hono<PlatformOwnedCharacterRouteEnv>()
  .use('*', async (context, next) => {
    context.set('platform', {
      authorization: {
        strategy: 'owned-character',
        userId: 'user-1',
        characterId,
        subjectLifecycleId,
      },
      organization: {
        organizationVersion: 7,
        audience: 'member',
        requiredPermission: 'market.structure.read',
        entitlementScope: 'all',
      },
      collectionStatus: { read: vi.fn() },
      coreReads: { loadAffiliation: vi.fn() },
      onDemandStructure: { currentGeneration, request },
    })
    return next()
  })
  .route('/', route)

beforeEach(() => {
  vi.clearAllMocks()
  currentGeneration.mockResolvedValue(4)
  request.mockResolvedValue('accepted')
  persistence.reserveStructureDemand.mockResolvedValue({ outcome: 'reserved' })
  persistence.releaseStructureDemand.mockResolvedValue({ outcome: 'released' })
  persistence.readStructureBook.mockResolvedValue({
    observationId: '00000000-0000-4000-8000-000000000002',
    structureId,
    typeId: 34,
    observedAt: new Date().toISOString(),
    validatedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 300_000).toISOString(),
    expectedPages: 1,
    totalBookOrders: 1,
    rows: [
      {
        orderId: 1,
        side: 'sell',
        price: '6.42',
        locationId: structureId,
        issuedAt: '2026-09-28T12:00:00Z',
        durationDays: 1,
      },
    ],
  })
})

test('requests a bounded structure book through a host-owned authority capability', async () => {
  const response = await app.request(`/structures/${structureId}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(response.status).toBe(202)
  expect(request).toHaveBeenCalledWith(structureId)
  expect(persistence.reserveStructureDemand).toHaveBeenCalledWith(
    expect.objectContaining({
      characterId,
      subjectLifecycleId,
      authorizationGeneration: 4,
      organizationVersion: 7,
      structureId,
    }),
  )
  expect(persistence.readStructureBook).not.toHaveBeenCalled()
  expect(
    (
      await app.request('/structures/0/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(400)
})

test('bounds new structure identities and releases reservations rejected by queue admission', async () => {
  persistence.reserveStructureDemand.mockResolvedValueOnce({ outcome: 'full' })
  expect(
    (
      await app.request(`/structures/${structureId}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(429)
  expect(request).not.toHaveBeenCalled()
  persistence.reserveStructureDemand.mockResolvedValueOnce({ outcome: 'reserved' })
  request.mockResolvedValueOnce('unavailable')
  expect(
    (
      await app.request(`/structures/${structureId}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(429)
  expect(persistence.releaseStructureDemand).toHaveBeenCalledOnce()
})

test('reads only a currently admitted owned lifecycle and authorization generation', async () => {
  const response = await app.request(`/structures/${structureId}/types/34/orders?side=sell`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    status: 'current',
    book: {
      rows: [
        {
          orderId: 1,
          expiryAt: '2026-09-29T12:00:00.000Z',
        },
      ],
    },
  })
  expect(persistence.readStructureBook).toHaveBeenCalledWith(
    expect.objectContaining({
      characterId,
      subjectLifecycleId,
      authorizationGeneration: 4,
      organizationVersion: 7,
      structureId,
    }),
  )
  currentGeneration.mockResolvedValue(null)
  const denied = await app.request(`/structures/${structureId}/types/34/orders?side=sell`)
  expect(denied.status).toBe(409)
  expect(persistence.readStructureBook).toHaveBeenCalledTimes(1)
})
