import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

interface StaticRow {
  typeId: number
  name: string
  attributeId: number | null
  attributeValue: number | null
}

const slotAttributeId = 331
const memoryAttributeId = 177
const perceptionAttributeId = 178

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  cacheDel: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  callOperation: vi.fn(),
  commit: vi.fn(),
  createEsiClient: vi.fn(),
  from: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getCharacterCacheAuthorization: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  getRevision: vi.fn(),
  getState: vi.fn(),
  getStaticLocations: vi.fn(),
  incrementRevision: vi.fn(),
  initialize: vi.fn(),
  leftJoin: vi.fn(),
  limit: vi.fn(),
  listActiveImplants: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
  resolveUniverseNames: vi.fn(),
  select: vi.fn(),
  staticRows: [] as StaticRow[],
  where: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    del: mocks.cacheDel,
    get: mocks.cacheGet,
    ping: vi.fn().mockResolvedValue('PONG'),
    set: mocks.cacheSet,
  }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock((definition, input) =>
    definition.operation === 'character-clones'
      ? mocks.getState(input)
      : mocks.listActiveImplants(input),
  ),
)
vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNames: mocks.resolveUniverseNames,
}))
vi.mock('../../src/universe/static-locations.js', () => ({
  getStaticLocations: mocks.getStaticLocations,
}))

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const clonesScope = 'esi-clones.read_clones.v1'
const implantsScope = 'esi-clones.read_implants.v1'
const now = Date.parse('2026-09-03T11:00:00.000Z')
const lease = { fence: 7, key: 'lease', ownerToken: 'owner', ttlMs: 15_000 }
const publicMetadata = {
  cachedUntil: '2026-09-03T11:02:00.000Z',
  stale: false,
  validatedAt: '2026-09-03T11:00:00.000Z',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetModules()
  for (const mock of Object.values(mocks)) {
    if (typeof mock === 'function') mock.mockReset()
  }
  mocks.staticRows.splice(0)

  mocks.getCharacterAuthorization.mockResolvedValue({
    accessToken: 'access-token',
    tokenVersion: 1,
  })
  mocks.getCharacterCacheAuthorization.mockImplementation(async (_characterId, scope: string) => ({
    scopes: [scope],
    tokenVersion: 1,
  }))
  mocks.acquire.mockResolvedValue(lease)
  mocks.commit.mockResolvedValue(true)
  mocks.getCommitted.mockResolvedValue(undefined)
  mocks.getLeaseTtl.mockResolvedValue(0)
  mocks.initialize.mockResolvedValue('namespace-one')
  mocks.release.mockResolvedValue(true)
  mocks.renew.mockResolvedValue(true)
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue('OK')
  mocks.cacheDel.mockResolvedValue(1)
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ leftJoin: mocks.leftJoin })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockImplementation(async () => mocks.staticRows)
  mocks.resolveUniverseNames.mockResolvedValue(new Map())
  mocks.getStaticLocations.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('character clone state', () => {
  test('normalizes and enriches complete clone state outside the private snapshot', async () => {
    mocks.getState.mockResolvedValue(
      response({
        home_location: { location_id: 60_000_001, location_type: 'station' },
        ignored: 'raw',
        jump_clones: [
          {
            jump_clone_id: 11,
            location_id: 60_000_001,
            location_type: 'station',
            name: 'Industry',
            implants: [4, 2],
          },
          {
            jump_clone_id: 12,
            location_id: 1_035_466_617_946,
            location_type: 'structure',
            implants: [],
          },
        ],
        last_clone_jump_date: '2026-09-02T12:00:00Z',
        last_station_change_date: '2026-08-30T12:00:00Z',
      }),
    )
    mocks.staticRows.push(
      { attributeId: slotAttributeId, attributeValue: 5, name: 'Alpha Implant', typeId: 2 },
      { attributeId: memoryAttributeId, attributeValue: 4, name: 'Alpha Implant', typeId: 2 },
      { attributeId: slotAttributeId, attributeValue: 3, name: 'Beta Implant', typeId: 4 },
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([[60_000_001, { category: 'station', id: 60_000_001, name: 'Jita IV - Moon 4' }]]),
    )
    mocks.getStaticLocations.mockResolvedValue([
      {
        id: 60_000_001,
        name: null,
        solarSystemId: 30_000_142,
        solarSystemSecurityStatus: 0.9,
        type: 'station',
      },
    ])
    const { characterClonesScope, getCharacterClones } =
      await import('../../src/characters/clones.js')

    const result = await getCharacterClones(characterId, subjectLifecycleId)

    expect(result).toStrictEqual({
      homeLocation: {
        locationId: 60_000_001,
        locationType: 'station',
        name: 'Jita IV - Moon 4',
        solarSystemSecurityStatus: 0.9,
      },
      jumpClones: [
        {
          implants: [
            { typeId: 4, name: 'Beta Implant', slot: 3, bonuses: [] },
            {
              typeId: 2,
              name: 'Alpha Implant',
              slot: 5,
              bonuses: [{ attribute: 'memory', value: 4 }],
            },
          ],
          jumpCloneId: 11,
          location: {
            locationId: 60_000_001,
            locationType: 'station',
            name: 'Jita IV - Moon 4',
          },
          name: 'Industry',
        },
        {
          implants: [],
          jumpCloneId: 12,
          location: {
            locationId: 1_035_466_617_946,
            locationType: 'structure',
            name: null,
          },
          name: null,
        },
      ],
      lastCloneJumpAt: '2026-09-02T12:00:00Z',
      lastStationChangeAt: '2026-08-30T12:00:00Z',
      ...publicMetadata,
    })
    expect(characterClonesScope).toBe(clonesScope)
    expect(mocks.getState).toHaveBeenCalledWith({ characterId, subjectLifecycleId })
    expect(mocks.resolveUniverseNames).toHaveBeenCalledWith([60_000_001])
    expect(mocks.getStaticLocations).toHaveBeenCalledWith([{ id: 60_000_001, type: 'station' }])
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.limit).toHaveBeenCalledWith(3000)
    expect(JSON.stringify(result)).not.toMatch(
      /home_location|jump_clones|implantTypeIds|last_clone|last_station|ignored|source|quota/,
    )
  })

  test('preserves partial home state and degrades unknown enrichment deterministically', async () => {
    mocks.getState.mockResolvedValue(
      response({
        home_location: { location_type: 'station' },
        jump_clones: [
          {
            implants: [99, 99],
            jump_clone_id: 13,
            location_id: 60_000_002,
            location_type: 'station',
          },
        ],
      }),
    )
    mocks.limit.mockRejectedValue(new Error('SDE unavailable'))
    mocks.resolveUniverseNames.mockRejectedValue(new Error('name resolution unavailable'))
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    await expect(getCharacterClones(characterId, subjectLifecycleId)).resolves.toStrictEqual({
      homeLocation: {
        locationId: null,
        locationType: 'station',
        name: null,
        solarSystemSecurityStatus: null,
      },
      jumpClones: [
        {
          implants: [{ typeId: 99, name: 'Unknown implant 99', slot: null, bonuses: [] }],
          jumpCloneId: 13,
          location: { locationId: 60_000_002, locationType: 'station', name: null },
          name: null,
        },
      ],
      lastCloneJumpAt: null,
      lastStationChangeAt: null,
      ...publicMetadata,
    })
    expect(mocks.resolveUniverseNames).toHaveBeenCalledWith([60_000_002])
  })

  test('bounds best-effort station enrichment without delaying clone state', async () => {
    mocks.getState.mockResolvedValue(
      response({
        home_location: { location_id: 60_000_001, location_type: 'station' },
        jump_clones: [],
      }),
    )
    mocks.resolveUniverseNames.mockReturnValue(new Promise(() => {}))
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    const pending = getCharacterClones(characterId, subjectLifecycleId)
    await vi.advanceTimersByTimeAsync(250)

    await expect(pending).resolves.toMatchObject({
      homeLocation: {
        locationId: 60_000_001,
        locationType: 'station',
        name: null,
        solarSystemSecurityStatus: null,
      },
    })
  })

  test('keeps an omitted home location distinct and ignores non-station resolver results', async () => {
    mocks.getState.mockResolvedValue(
      response({
        jump_clones: [
          {
            implants: [],
            jump_clone_id: 14,
            location_id: 60_000_003,
            location_type: 'station',
          },
        ],
      }),
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([[60_000_003, { category: 'solar_system', id: 60_000_003, name: 'Wrong category' }]]),
    )
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    await expect(getCharacterClones(characterId, subjectLifecycleId)).resolves.toMatchObject({
      homeLocation: null,
      jumpClones: [{ location: { name: null } }],
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('serves a repeated request from the L1 cache without another ESI call', async () => {
    mocks.getState
      .mockResolvedValueOnce(
        response({
          home_location: null,
          jump_clones: [
            {
              implants: [4],
              jump_clone_id: 15,
              location_id: 1_035_466_617_946,
              location_type: 'structure',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response(
          {
            home_location: null,
            jump_clones: [
              {
                implants: [4],
                jump_clone_id: 15,
                location_id: 1_035_466_617_946,
                location_type: 'structure',
              },
            ],
          },
          'cache',
        ),
      )
    mocks.staticRows.push({
      attributeId: null,
      attributeValue: null,
      name: 'Recovered Name',
      typeId: 4,
    })
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    const first = await getCharacterClones(characterId, subjectLifecycleId)
    const second = await getCharacterClones(characterId, subjectLifecycleId)

    expect(second).toStrictEqual(first)
    expect(mocks.getState).toHaveBeenCalledTimes(2)
  })
})

describe('active character implants', () => {
  test('loads, deduplicates, enriches, and sorts active implants independently', async () => {
    mocks.listActiveImplants.mockResolvedValue(response([4, 2, 4, 99]))
    mocks.staticRows.push(
      { attributeId: slotAttributeId, attributeValue: 1, name: 'Beta Implant', typeId: 4 },
      { attributeId: slotAttributeId, attributeValue: 2, name: 'Alpha Implant', typeId: 2 },
      { attributeId: perceptionAttributeId, attributeValue: 3, name: 'Alpha Implant', typeId: 2 },
    )
    const { characterImplantsScope, getCharacterImplants } =
      await import('../../src/characters/clones.js')

    await expect(getCharacterImplants(characterId, subjectLifecycleId)).resolves.toStrictEqual({
      implants: [
        { bonuses: [], name: 'Beta Implant', slot: 1, typeId: 4 },
        {
          bonuses: [{ attribute: 'perception', value: 3 }],
          name: 'Alpha Implant',
          slot: 2,
          typeId: 2,
        },
        { bonuses: [], name: 'Unknown implant 99', slot: null, typeId: 99 },
      ],
      ...publicMetadata,
    })
    expect(characterImplantsScope).toBe(implantsScope)
    expect(mocks.listActiveImplants).toHaveBeenCalledWith({ characterId, subjectLifecycleId })
    expect(mocks.resolveUniverseNames).not.toHaveBeenCalled()
  })

  test('drops unusable slot and zero bonus dogma values while ordering bonuses stably', async () => {
    mocks.listActiveImplants.mockResolvedValue(response([7, 8]))
    mocks.staticRows.push(
      { attributeId: slotAttributeId, attributeValue: 0, name: 'Broken Slot', typeId: 7 },
      { attributeId: memoryAttributeId, attributeValue: 0, name: 'Broken Slot', typeId: 7 },
      { attributeId: slotAttributeId, attributeValue: 2, name: 'Dual Bonus', typeId: 8 },
      { attributeId: perceptionAttributeId, attributeValue: 3, name: 'Dual Bonus', typeId: 8 },
      { attributeId: memoryAttributeId, attributeValue: 5, name: 'Dual Bonus', typeId: 8 },
    )
    const { getCharacterImplants } = await import('../../src/characters/clones.js')

    await expect(getCharacterImplants(characterId, subjectLifecycleId)).resolves.toMatchObject({
      implants: [
        {
          bonuses: [
            { attribute: 'memory', value: 5 },
            { attribute: 'perception', value: 3 },
          ],
          name: 'Dual Bonus',
          slot: 2,
          typeId: 8,
        },
        { bonuses: [], name: 'Broken Slot', slot: null, typeId: 7 },
      ],
    })
  })

  test('preserves an empty active implant collection without querying static data', async () => {
    mocks.listActiveImplants.mockResolvedValue(response([]))
    const { getCharacterImplants } = await import('../../src/characters/clones.js')

    await expect(getCharacterImplants(characterId, subjectLifecycleId)).resolves.toStrictEqual({
      implants: [],
      ...publicMetadata,
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

function response<Data>(data: Data, source: 'cache' | 'esi' = 'esi') {
  return {
    cachedUntil: publicMetadata.cachedUntil,
    data: Array.isArray(data)
      ? { implantTypeIds: [...new Set(data)] }
      : cloneSnapshot(data as Record<string, unknown>),
    quota: {},
    source,
    stale: false,
    validatedAt: publicMetadata.validatedAt,
  }
}

function cloneSnapshot(data: Record<string, unknown>) {
  const home = data.home_location as
    | { location_id?: number; location_type?: 'station' | 'structure' }
    | null
    | undefined
  const clones =
    (data.jump_clones as Array<{
      jump_clone_id: number
      location_id: number
      location_type: 'station' | 'structure'
      name?: string
      implants?: number[]
    }>) ?? []
  return {
    homeLocation: home
      ? { locationId: home.location_id ?? null, locationType: home.location_type ?? null }
      : null,
    jumpClones: clones.map((clone) => ({
      implantTypeIds: [...new Set(clone.implants ?? [])],
      jumpCloneId: clone.jump_clone_id,
      location: { locationId: clone.location_id, locationType: clone.location_type },
      name: clone.name ?? null,
    })),
    lastCloneJumpAt: (data.last_clone_jump_date as string | undefined) ?? null,
    lastStationChangeAt: (data.last_station_change_date as string | undefined) ?? null,
  }
}
