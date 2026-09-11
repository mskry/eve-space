import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    callOperation(...arguments_: unknown[]) {
      return mocks.callOperation(...arguments_)
    }
  },
}))
vi.mock('../../src/characters/skills.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkillsData: vi.fn(),
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  esiExecutionLayer: { executeRepresentation: mocks.executeRepresentation },
}))
vi.mock('../../src/universe/locations.js', () => ({
  getUniverseSolarSystem: vi.fn(),
  getUniverseStation: vi.fn(),
}))

import { executeRepresentationFixture } from '../support/execute-representation.js'

const wireResponses = {
  GetCharactersCharacterIdLocation: { solar_system_id: 30_000_142, station_id: 60_003_768 },
  GetCharactersCharacterIdShip: { ship_name: 'My Pod', ship_type_id: 670, ship_item_id: 1 },
  GetUniverseTypesTypeId: { name: 'Capsule' },
}
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'

const freshness = {
  location: meta('2026-09-01T11:00:00.000Z', '2026-09-01T11:10:00.000Z'),
  ship: meta('2026-09-01T11:00:00.000Z', '2026-09-01T11:10:00.000Z'),
  'universe-type': meta('2026-09-01T10:57:00.000Z', '2026-09-01T11:07:00.000Z'),
}
const universeSolarSystemResult = staticResult(
  { name: 'Jita' },
  '2026-09-01T10:59:00.000Z',
  '2026-09-01T11:09:00.000Z',
)
const universeStationResult = staticResult(
  { name: 'Jita IV - Moon 4' },
  '2026-09-01T10:58:00.000Z',
  '2026-09-01T11:08:00.000Z',
  true,
)

beforeEach(async () => {
  mocks.callOperation.mockImplementation(async (operationId: keyof typeof wireResponses) => ({
    data: wireResponses[operationId],
    meta: { headers: {} },
  }))
  mocks.executeRepresentation.mockImplementation(async (representation, input) => {
    const operation = representation.operation as keyof typeof freshness
    const loaded = await executeRepresentationFixture(representation, input, {
      accessToken: representation.authorization === 'character' ? 'access-token' : undefined,
    })
    return { ...freshness[operation], data: loaded.data }
  })
  const { getUniverseSolarSystem, getUniverseStation } =
    await import('../../src/universe/locations.js')
  vi.mocked(getUniverseSolarSystem).mockResolvedValue(
    universeSolarSystemResult as Awaited<ReturnType<typeof getUniverseSolarSystem>>,
  )
  vi.mocked(getUniverseStation).mockResolvedValue(
    universeStationResult as Awaited<ReturnType<typeof getUniverseStation>>,
  )
})

describe('character overview resources', () => {
  test('aggregates freshness across location and station resources', async () => {
    const { getCharacterLocation } = await import('../../src/characters/overview.js')

    const location = await getCharacterLocation(90_000_001, subjectLifecycleId)

    expect(location).toEqual({
      solarSystemId: 30_000_142,
      solarSystemName: 'Jita',
      stationId: 60_003_768,
      stationName: 'Jita IV - Moon 4',
      cachedUntil: '2026-09-01T11:08:00.000Z',
      validatedAt: '2026-09-01T10:58:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    expect(location).not.toHaveProperty('source')
    expect(location).not.toHaveProperty('quota')
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({ characterId: 90_000_001 })
    expect(mocks.callOperation).toHaveBeenCalledWith('GetCharactersCharacterIdLocation', {
      path: { character_id: 90_000_001 },
    })
  })

  test('aggregates freshness across ship and type resources', async () => {
    const { getCharacterShip } = await import('../../src/characters/overview.js')

    await expect(getCharacterShip(90_000_001, subjectLifecycleId)).resolves.toEqual({
      typeId: 670,
      typeName: 'Capsule',
      name: 'My Pod',
      cachedUntil: '2026-09-01T11:07:00.000Z',
      validatedAt: '2026-09-01T10:57:00.000Z',
      stale: false,
    })
    expect(mocks.executeRepresentation.mock.calls[1]?.[1]).toEqual({ typeId: 670 })
    expect(mocks.callOperation).toHaveBeenCalledWith('GetUniverseTypesTypeId', {
      path: { type_id: 670 },
    })
  })
})

function meta(validatedAt: string, cachedUntil: string) {
  return { cachedUntil, validatedAt, source: 'esi' as const, stale: false, quota: {} }
}

function staticResult<Data>(data: Data, validatedAt: string, cachedUntil: string, stale = false) {
  return {
    data,
    cachedUntil,
    validatedAt,
    source: 'cache' as const,
    stale,
    ...(stale ? { refreshFailureClass: 'esi-unavailable' as const } : {}),
    quota: {},
  }
}
