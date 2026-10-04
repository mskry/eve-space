import { testClient } from 'hono/testing'
import { beforeEach, expect, test, vi } from 'vitest'
import { profileRoutes } from '../src/profile-routes.js'

const persistence = {
  listMarketProfiles: vi.fn(),
  listDueMarketProfiles: vi.fn(),
  saveMarketProfile: vi.fn(),
  readMarketObservation: vi.fn(),
  readMarketIntelligencePolicy: vi.fn(),
  saveMarketIntelligencePolicy: vi.fn(),
}
const coreData = { marketStationRegions: vi.fn(), marketCatalogue: vi.fn() }
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
  persistence.readMarketIntelligencePolicy.mockResolvedValue({
    enabled: false,
    revision: 0,
    ignoredGroupIds: [614],
    catalogueRevision: null,
  })
  persistence.saveMarketIntelligencePolicy.mockResolvedValue({ outcome: 'saved', revision: 1 })
  coreData.marketCatalogue.mockResolvedValue({
    kind: 'tree',
    complete: true,
    revision: { buildNumber: 3552227, ingestVersion: 6, ingestedAt: '2026-10-04T00:00:00Z' },
    groups: [{ id: 614, parentId: null, name: 'Group', iconId: null, directTypeCount: 0 }],
  })
  coreData.marketStationRegions.mockResolvedValue({
    complete: true,
    revision: { buildNumber: 3542233, ingestVersion: 6, ingestedAt: '2026-09-28T12:00:00Z' },
    rows: [{ stationId: 60003760, solarSystemId: 30000142, regionId: 10000002 }],
  })
})

test('configures intelligence only for current enabled full-region profiles with known distinct groups', async () => {
  const profile = {
    ...input,
    profileId,
    mode: 'region',
    watchedTypeIds: [],
    revision: 1,
    nextDueAt: null,
    lastFailureClass: null,
  }
  persistence.listMarketProfiles.mockResolvedValue([profile])
  const policy = {
    enabled: true,
    ignoredGroupIds: [614],
    expectedProfileRevision: 1,
    expectedPolicyRevision: 0,
  }
  const put = (json: typeof policy) =>
    client[':profileId'].intelligence.$put({ param: { profileId }, json })
  expect((await put({ ...policy, ignoredGroupIds: [999] })).status).toBe(400)
  expect((await put({ ...policy, ignoredGroupIds: [614, 614] })).status).toBe(400)
  expect((await put({ ...policy, expectedProfileRevision: 2 })).status).toBe(409)
  expect(persistence.saveMarketIntelligencePolicy).not.toHaveBeenCalled()
  expect(await (await put(policy)).json()).toEqual({ profileId, policyRevision: 1 })
  persistence.listMarketProfiles.mockResolvedValue([
    { ...profile, mode: 'watched-types', watchedTypeIds: [34] },
  ])
  expect((await put(policy)).status).toBe(400)
  persistence.listMarketProfiles.mockResolvedValue([profile])
  persistence.saveMarketIntelligencePolicy.mockResolvedValueOnce({ outcome: 'obsolete' })
  expect((await put(policy)).status).toBe(409)
  coreData.marketCatalogue.mockRejectedValueOnce(new Error('Unavailable'))
  expect((await put(policy)).status).toBe(503)
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
