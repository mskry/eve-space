import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createEsiTransport: vi.fn(),
  createUniverseClient: vi.fn(),
  getPublic: vi.fn(),
  getSolarSystem: vi.fn(),
  getStation: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: mocks.createUniverseClient,
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.getPublic }),
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

import { getUniverseSolarSystem, getUniverseStation } from '../../src/universe/locations.js'

const revalidation = { ifNoneMatch: 'etag', ifModifiedSince: 'last-modified' }

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.createEsiTransport.mockImplementation((operation) => `${operation}-transport`)
  mocks.createUniverseClient.mockReturnValue({
    withMetadata: () => ({
      getSolarSystem: mocks.getSolarSystem,
      getStation: mocks.getStation,
    }),
  })
  mocks.getPublic.mockImplementation(async (resource) => {
    const response = await resource.load(revalidation)
    return { data: response.data }
  })
  mocks.getSolarSystem.mockResolvedValue({
    data: { system_id: 30_000_142, name: 'Jita', security_status: 0.945 },
  })
  mocks.getStation.mockResolvedValue({
    data: { station_id: 60_003_760, system_id: 30_000_142, name: 'Jita IV - Moon 4' },
  })
})

describe('universe location resources', () => {
  test('loads solar systems through the registered public resilience operation', async () => {
    await expect(getUniverseSolarSystem(30_000_142)).resolves.toEqual({
      data: { system_id: 30_000_142, name: 'Jita', security_status: 0.945 },
    })

    expect(mocks.getPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'universe-solar-system',
        inputs: { systemId: 30_000_142 },
      }),
    )
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('universe-solar-system')
    expect(mocks.createUniverseClient).toHaveBeenCalledWith({
      fetch: 'universe-solar-system-transport',
    })
    expect(mocks.getSolarSystem).toHaveBeenCalledWith(30_000_142, revalidation)
  })

  test('loads stations through the registered public resilience operation', async () => {
    await expect(getUniverseStation(60_003_760)).resolves.toEqual({
      data: { station_id: 60_003_760, system_id: 30_000_142, name: 'Jita IV - Moon 4' },
    })

    expect(mocks.getPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'universe-station',
        inputs: { stationId: 60_003_760 },
      }),
    )
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('universe-station')
    expect(mocks.createUniverseClient).toHaveBeenCalledWith({ fetch: 'universe-station-transport' })
    expect(mocks.getStation).toHaveBeenCalledWith(60_003_760, revalidation)
  })
})
