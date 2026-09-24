import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  executeRepresentation: vi.fn(),
  getSolarSystem: vi.fn(),
  getStation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

import { getUniverseSolarSystem, getUniverseStation } from '../../src/universe/locations.js'

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  mocks.executeRepresentation.mockImplementation((definition, input) =>
    definition.operation === 'universe-solar-system'
      ? mocks.getSolarSystem(input)
      : mocks.getStation(input),
  )
  mocks.getSolarSystem.mockResolvedValue(
    response({ name: 'Jita', security_status: 0.945, system_id: 30_000_142 }),
  )
  mocks.getStation.mockResolvedValue(
    response({ name: 'Jita IV - Moon 4', station_id: 60_003_760, system_id: 30_000_142 }),
  )
})

describe('universe location resources', () => {
  test('loads solar systems through the callable public read', async () => {
    await expect(getUniverseSolarSystem(30_000_142)).resolves.toMatchObject({
      data: { name: 'Jita', security_status: 0.945, system_id: 30_000_142 },
    })

    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual({ systemId: 30_000_142 })
    expect(mocks.getSolarSystem).toHaveBeenCalledWith({ systemId: 30_000_142 })
  })

  test('loads stations through the callable public read', async () => {
    await expect(getUniverseStation(60_003_760)).resolves.toMatchObject({
      data: { name: 'Jita IV - Moon 4', station_id: 60_003_760, system_id: 30_000_142 },
    })

    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual({ stationId: 60_003_760 })
    expect(mocks.getStation).toHaveBeenCalledWith({ stationId: 60_003_760 })
  })
})

function response<Data>(data: Data) {
  return {
    cachedUntil: '',
    data,
    quota: {},
    source: 'esi' as const,
    stale: false,
    validatedAt: '',
  }
}
