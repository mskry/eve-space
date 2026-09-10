import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executePublicRepresentation: vi.fn(),
  getSolarSystem: vi.fn(),
  getStation: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    callOperation(operation: string, inputs: unknown) {
      return operation === 'GetUniverseSystemsSystemId'
        ? mocks.getSolarSystem(inputs)
        : mocks.getStation(inputs)
    }
  },
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({ executePublicRepresentation: mocks.executePublicRepresentation }),
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({ createEsiTransport: vi.fn() }))

import { getUniverseSolarSystem, getUniverseStation } from '../../src/universe/locations.js'

const revalidation = { ifNoneMatch: 'etag', ifModifiedSince: 'last-modified' }

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.executePublicRepresentation.mockImplementation(async (_representation, resource) => {
    const loaded = await resource.load(revalidation)
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
  mocks.getSolarSystem.mockResolvedValue(
    response({ system_id: 30_000_142, name: 'Jita', security_status: 0.945 }),
  )
  mocks.getStation.mockResolvedValue(
    response({ station_id: 60_003_760, system_id: 30_000_142, name: 'Jita IV - Moon 4' }),
  )
})

describe('universe location resources', () => {
  test('loads solar systems through the registered public resilience operation', async () => {
    await expect(getUniverseSolarSystem(30_000_142)).resolves.toMatchObject({
      data: { system_id: 30_000_142, name: 'Jita', security_status: 0.945 },
    })

    expect(mocks.executePublicRepresentation.mock.calls[0]?.[1]).toMatchObject({
      operation: 'universe-solar-system',
      inputs: { path: { system_id: 30_000_142 } },
    })
    expect(mocks.getSolarSystem).toHaveBeenCalledWith(
      expect.objectContaining({ path: { system_id: 30_000_142 } }),
    )
  })

  test('loads stations through the registered public resilience operation', async () => {
    await expect(getUniverseStation(60_003_760)).resolves.toMatchObject({
      data: { station_id: 60_003_760, system_id: 30_000_142, name: 'Jita IV - Moon 4' },
    })

    expect(mocks.executePublicRepresentation.mock.calls[0]?.[1]).toMatchObject({
      operation: 'universe-station',
      inputs: { path: { station_id: 60_003_760 } },
    })
    expect(mocks.getStation).toHaveBeenCalledWith(
      expect.objectContaining({ path: { station_id: 60_003_760 } }),
    )
  })
})

function response<Data>(data: Data) {
  return { data, meta: { status: 200, headers: {} } }
}
