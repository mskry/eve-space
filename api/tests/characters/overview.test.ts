import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  executeRepresentation: vi.fn(),
  getUniverseSolarSystem: vi.fn(),
  getUniverseStation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)
vi.mock('../../src/universe/locations.js', () => ({
  getUniverseSolarSystem: mocks.getUniverseSolarSystem,
  getUniverseStation: mocks.getUniverseStation,
}))

const characterId = 90_000_001
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const freshness = {
  cachedUntil: '2026-09-01T11:10:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  source: 'esi' as const,
  stale: false,
  quota: {},
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    if (definition.operation === 'location')
      return Promise.resolve(result({ solarSystemId: 30_000_142, stationId: 60_003_768 }))
    if (definition.operation === 'ship')
      return Promise.resolve(result({ typeId: 670, name: 'My Pod' }))
    return Promise.resolve(result({ name: 'Capsule' }))
  })
  mocks.getUniverseSolarSystem.mockResolvedValue(result({ name: 'Jita' }))
  mocks.getUniverseStation.mockResolvedValue({
    ...result({ name: 'Jita IV - Moon 4' }),
    stale: true,
    refreshFailureClass: 'esi-unavailable',
    validatedAt: '2026-09-01T10:58:00.000Z',
    cachedUntil: '2026-09-01T11:08:00.000Z',
  })
})

describe('character overview resources', () => {
  test('aggregates mapped location and station freshness', async () => {
    const { getCharacterLocation } = await import('../../src/characters/overview.js')

    await expect(getCharacterLocation(characterId, subjectLifecycleId)).resolves.toMatchObject({
      solarSystemId: 30_000_142,
      solarSystemName: 'Jita',
      stationId: 60_003_768,
      stationName: 'Jita IV - Moon 4',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'location' }),
      { characterId, subjectLifecycleId },
      { subjectLifecycleId },
    )
  })

  test('uses the mapped type result for ship presentation', async () => {
    const { getCharacterShip } = await import('../../src/characters/overview.js')

    await expect(getCharacterShip(characterId, subjectLifecycleId)).resolves.toMatchObject({
      typeId: 670,
      typeName: 'Capsule',
      name: 'My Pod',
    })
    expect(mocks.executeRepresentation.mock.calls.at(-1)?.[1]).toEqual({ typeId: 670 })
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
