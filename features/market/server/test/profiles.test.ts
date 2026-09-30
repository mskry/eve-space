import { describe, expect, test, vi } from 'vitest'
import { validateMarketPublicProfile, type MarketPublicProfileInput } from '../src/profiles.js'

const revision = { buildNumber: 3542233, ingestVersion: 6, ingestedAt: '2026-09-28T12:00:00Z' }
const input: MarketPublicProfileInput = {
  regionId: 10000002,
  mode: 'watched-types',
  stationIds: [60003760],
  watchedTypeIds: [35, 34],
  enabled: true,
}
const stations = (regionId = 10000002) => ({
  marketStationRegions: vi.fn().mockResolvedValue({
    complete: true,
    revision,
    rows: [{ stationId: 60003760, solarSystemId: 30000142, regionId }],
  }),
})

describe('public Market profiles', () => {
  test('normalizes bounded types and validates station-region membership from committed static data', async () => {
    const coreData = stations()
    await expect(validateMarketPublicProfile(input, [], coreData)).resolves.toMatchObject({
      regionId: 10000002,
      stationIds: [60003760],
      watchedTypeIds: [34, 35],
      stationRevision: revision,
    })
    expect(coreData.marketStationRegions).toHaveBeenCalledWith({ stationIds: [60003760] })
  })

  test('rejects an unknown or cross-region station without treating missing evidence as membership', async () => {
    await expect(validateMarketPublicProfile(input, [], stations(10000001))).rejects.toThrow(
      'does not belong',
    )
    const missing = stations()
    missing.marketStationRegions.mockResolvedValue({ complete: true, rows: [], revision })
    await expect(validateMarketPublicProfile(input, [], missing)).rejects.toThrow('unknown')
  })

  test('bounds full regions, watched types, profile count, and duplicates', async () => {
    const coreData = stations()
    await expect(
      validateMarketPublicProfile({ ...input, regionId: 11000001 }, [], coreData),
    ).rejects.toThrow('not in the supported')
    await expect(
      validateMarketPublicProfile({ ...input, mode: 'region', watchedTypeIds: [] }, [], coreData),
    ).resolves.toMatchObject({ mode: 'region' })
    await expect(
      validateMarketPublicProfile({ ...input, mode: 'region' }, [], coreData),
    ).rejects.toThrow('cannot declare watched types')
    await expect(
      validateMarketPublicProfile({ ...input, watchedTypeIds: [] }, [], coreData),
    ).rejects.toThrow('requires at least one')
    await expect(
      validateMarketPublicProfile({ ...input, watchedTypeIds: [34, 34] }, [], coreData),
    ).rejects.toThrow('cannot repeat')
    await expect(
      validateMarketPublicProfile(
        input,
        Array.from({ length: 4 }, () => input),
        coreData,
      ),
    ).rejects.toThrow('limit reached')
    await expect(
      validateMarketPublicProfile(
        { ...input, mode: 'region', watchedTypeIds: [] },
        [{ regionId: 10000001, mode: 'region', enabled: true }],
        coreData,
      ),
    ).rejects.toThrow('Only one enabled')
  })

  test('admits only the official PLEX-only global market profile', async () => {
    const coreData = stations()
    coreData.marketStationRegions.mockResolvedValue({ complete: true, rows: [], revision })
    const global = {
      ...input,
      regionId: 19000001,
      stationIds: [],
      watchedTypeIds: [44992],
    }
    await expect(
      validateMarketPublicProfile(
        global,
        [{ regionId: 10000002, mode: 'region', enabled: true }],
        coreData,
      ),
    ).resolves.toMatchObject({ regionId: 19000001, mode: 'watched-types', watchedTypeIds: [44992] })
    for (const invalid of [
      { ...global, mode: 'region' as const, watchedTypeIds: [] },
      { ...global, watchedTypeIds: [34] },
      { ...global, watchedTypeIds: [44992, 34] },
      { ...global, stationIds: [60003760] },
    ]) {
      await expect(validateMarketPublicProfile(invalid, [], coreData)).rejects.toThrow(
        'Global PLEX Market',
      )
    }
  })
})
