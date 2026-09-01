import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getPublic: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/location', () => ({ createLocationClient: vi.fn() }))
vi.mock('@evespace/esi-client/domains/universe', () => ({ createUniverseClient: vi.fn() }))
vi.mock('../../src/characters/skills.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkillsData: vi.fn(),
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({
    getCharacter: mocks.getCharacter,
    getPublic: mocks.getPublic,
  }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

const results = {
  location: result(
    { solar_system_id: 30_000_142, station_id: 60_003_768 },
    '2026-09-01T11:00:00.000Z',
    '2026-09-01T11:10:00.000Z',
  ),
  'universe-solar-system': result(
    { name: 'Jita' },
    '2026-09-01T10:59:00.000Z',
    '2026-09-01T11:09:00.000Z',
  ),
  'universe-station': result(
    { name: 'Jita IV - Moon 4' },
    '2026-09-01T10:58:00.000Z',
    '2026-09-01T11:08:00.000Z',
    true,
  ),
  ship: result(
    { ship_name: 'My Pod', ship_type_id: 670 },
    '2026-09-01T11:00:00.000Z',
    '2026-09-01T11:10:00.000Z',
  ),
  'universe-type': result(
    { name: 'Capsule' },
    '2026-09-01T10:57:00.000Z',
    '2026-09-01T11:07:00.000Z',
  ),
}

beforeEach(() => {
  mocks.getCharacter.mockImplementation(
    async ({ operation }: { operation: keyof typeof results }) => results[operation],
  )
  mocks.getPublic.mockImplementation(
    async ({ operation }: { operation: keyof typeof results }) => results[operation],
  )
})

describe('character overview resources', () => {
  test('aggregates freshness across location and station resources', async () => {
    const { getCharacterLocation } = await import('../../src/characters/overview.js')

    const location = await getCharacterLocation(90_000_001)

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
  })

  test('aggregates freshness across ship and type resources', async () => {
    const { getCharacterShip } = await import('../../src/characters/overview.js')

    await expect(getCharacterShip(90_000_001)).resolves.toEqual({
      typeId: 670,
      typeName: 'Capsule',
      name: 'My Pod',
      cachedUntil: '2026-09-01T11:07:00.000Z',
      validatedAt: '2026-09-01T10:57:00.000Z',
      stale: false,
    })
  })
})

function result<Data>(data: Data, validatedAt: string, cachedUntil: string, stale = false) {
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
