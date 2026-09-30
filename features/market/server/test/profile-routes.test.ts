import { testClient } from 'hono/testing'
import { beforeEach, expect, test, vi } from 'vitest'
import { profileRoutes } from '../src/profile-routes.js'

const persistence = {
  listMarketProfiles: vi.fn(),
  listDueMarketProfiles: vi.fn(),
  saveMarketProfile: vi.fn(),
  readMarketObservation: vi.fn(),
}
const coreData = { marketStationRegions: vi.fn() }
const app = profileRoutes({
  coreData,
  persistence,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
})
const client = testClient(app)
const profileId = '00000000-0000-4000-8000-000000000001'
const input = {
  regionId: 10000002,
  mode: 'watched-types' as const,
  stationIds: [60003760],
  watchedTypeIds: [34],
  enabled: true,
  expectedRevision: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  persistence.listMarketProfiles.mockResolvedValue([])
  persistence.listDueMarketProfiles.mockResolvedValue([])
  persistence.saveMarketProfile.mockResolvedValue({ outcome: 'saved', revision: 1 })
  persistence.readMarketObservation.mockResolvedValue(null)
  coreData.marketStationRegions.mockResolvedValue({
    complete: true,
    revision: { buildNumber: 3542233, ingestVersion: 6, ingestedAt: '2026-09-28T12:00:00Z' },
    rows: [{ stationId: 60003760, solarSystemId: 30000142, regionId: 10000002 }],
  })
})

test('saves a bounded public profile through declared static data and persistence', async () => {
  const response = await client[':profileId'].$put({ param: { profileId }, json: input })
  expect(response.status).toBe(200)
  expect(await response.json()).toStrictEqual({ profileId, revision: 1 })
  expect(coreData.marketStationRegions).toHaveBeenCalledWith({ stationIds: [60003760] })
  expect(persistence.saveMarketProfile).toHaveBeenCalledWith(
    expect.objectContaining({ profileId, regionId: 10000002, expectedRevision: 0 }),
  )
})

test('refuses invalid IDs, mismatched station regions, and stale revisions before a write', async () => {
  expect(
    (await client[':profileId'].$put({ param: { profileId: 'bad' }, json: input })).status,
  ).toBe(400)
  coreData.marketStationRegions.mockResolvedValueOnce({
    complete: true,
    revision: { buildNumber: 3542233, ingestVersion: 6, ingestedAt: '2026-09-28T12:00:00Z' },
    rows: [{ stationId: 60003760, solarSystemId: 30000001, regionId: 10000001 }],
  })
  expect((await client[':profileId'].$put({ param: { profileId }, json: input })).status).toBe(400)
  persistence.listMarketProfiles.mockResolvedValueOnce([{ profileId, revision: 2 }])
  expect((await client[':profileId'].$put({ param: { profileId }, json: input })).status).toBe(409)
  expect(persistence.saveMarketProfile).not.toHaveBeenCalled()
})

test('reports safe profile backlog, cooldown, page count, and source freshness', async () => {
  const now = new Date()
  const dueAt = new Date(now.getTime() - 60_000).toISOString()
  persistence.listMarketProfiles.mockResolvedValueOnce([
    {
      profileId,
      regionId: 10000002,
      mode: 'watched-types',
      stationIds: [60003760],
      watchedTypeIds: [34],
      enabled: true,
      revision: 1,
      nextDueAt: dueAt,
      lastFailureClass: 'esi-cooldown',
    },
  ])
  persistence.readMarketObservation.mockResolvedValueOnce({
    observationId: '00000000-0000-4000-8000-000000000002',
    profileId,
    regionId: 10000002,
    typeId: 34,
    observedAt: now.toISOString(),
    validatedAt: now.toISOString(),
    freshUntil: new Date(now.getTime() + 300_000).toISOString(),
    expectedPages: 3,
    totalBookOrders: 2407,
  })
  const response = await app.request(`/${profileId}/status?typeId=34`)
  expect(response.status).toBe(200)
  const status = await response.json()
  expect(status).toMatchObject({
    profileId,
    lastFailureClass: 'esi-cooldown',
    cooldownUntil: dueAt,
    observation: { expectedPages: 3, totalBookOrders: 2407, freshness: 'current' },
  })
  expect(status.backlogAgeSeconds).toBeGreaterThanOrEqual(60)
  expect(JSON.stringify(status)).not.toMatch(/order_id|price|credential|token/i)
})
