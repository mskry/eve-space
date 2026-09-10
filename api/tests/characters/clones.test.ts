import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
  createEsiClient: vi.fn(),
  callOperation: vi.fn(),
  createEsiTransport: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getCharacterCacheAuthorization: vi.fn(),
  acquire: vi.fn(),
  commit: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  getRevision: vi.fn(),
  incrementRevision: vi.fn(),
  initialize: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  from: vi.fn(),
  getState: vi.fn(),
  leftJoin: vi.fn(),
  limit: vi.fn(),
  listActiveImplants: vi.fn(),
  resolveUniverseNames: vi.fn(),
  select: vi.fn(),
  staticRows: [] as StaticRow[],
  where: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@evespace/esi-client')>()
  return {
    ...original,
    EsiClient: class {
      constructor(options: unknown) {
        mocks.createEsiClient(options)
      }

      callOperation(...arguments_: unknown[]) {
        return mocks.callOperation(...arguments_)
      }
    },
  }
})
vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorization: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorization: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    del: mocks.cacheDel,
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ getCoordinationConnection: () => ({}) }))
vi.mock('../../src/esi-resilience/coordination.js', () => ({
  acquireEsiRequestLease: mocks.acquire,
  commitEsiFence: mocks.commit,
  getCommittedEsiFence: mocks.getCommitted,
  getEsiRequestLeaseTtl: mocks.getLeaseTtl,
  getEsiResourceRevision: mocks.getRevision,
  incrementEsiResourceRevision: mocks.incrementRevision,
  initializeCacheNamespace: mocks.initialize,
  releaseEsiRequestLease: mocks.release,
  renewEsiRequestLease: mocks.renew,
}))
vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNames: mocks.resolveUniverseNames,
}))

const characterId = 1404328063
const clonesScope = 'esi-clones.read_clones.v1'
const implantsScope = 'esi-clones.read_implants.v1'
const now = Date.parse('2026-09-03T11:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }
const publicMetadata = {
  cachedUntil: '2026-09-03T11:02:00.000Z',
  validatedAt: '2026-09-03T11:00:00.000Z',
  stale: false,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetModules()
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset()
  mocks.staticRows.splice(0)

  mocks.callOperation.mockImplementation((operationId: string, ...rest: unknown[]) =>
    operationId === 'GetCharactersCharacterIdClones'
      ? mocks.getState(operationId, ...rest)
      : mocks.listActiveImplants(operationId, ...rest),
  )
  mocks.createEsiTransport.mockReturnValue(vi.fn())
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
})

afterEach(() => {
  vi.useRealTimers()
})

describe('character clone state', () => {
  test('normalizes and enriches complete clone state outside the private snapshot', async () => {
    mocks.getState.mockResolvedValue(
      response({
        home_location: { location_id: 60_000_001, location_type: 'station' },
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
        ignored: 'raw',
      }),
    )
    mocks.staticRows.push(
      { typeId: 2, name: 'Alpha Implant', attributeId: slotAttributeId, attributeValue: 5 },
      { typeId: 2, name: 'Alpha Implant', attributeId: memoryAttributeId, attributeValue: 4 },
      { typeId: 4, name: 'Beta Implant', attributeId: slotAttributeId, attributeValue: 3 },
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([[60_000_001, { id: 60_000_001, name: 'Jita IV - Moon 4', category: 'station' }]]),
    )
    const { characterClonesScope, getCharacterClones } =
      await import('../../src/characters/clones.js')

    const result = await getCharacterClones(characterId)

    expect(result).toEqual({
      homeLocation: {
        locationId: 60_000_001,
        locationType: 'station',
        name: 'Jita IV - Moon 4',
      },
      jumpClones: [
        {
          jumpCloneId: 11,
          name: 'Industry',
          location: {
            locationId: 60_000_001,
            locationType: 'station',
            name: 'Jita IV - Moon 4',
          },
          implants: [
            { typeId: 4, name: 'Beta Implant', slot: 3, bonuses: [] },
            {
              typeId: 2,
              name: 'Alpha Implant',
              slot: 5,
              bonuses: [{ attribute: 'memory', value: 4 }],
            },
          ],
        },
        {
          jumpCloneId: 12,
          name: null,
          location: {
            locationId: 1_035_466_617_946,
            locationType: 'structure',
            name: null,
          },
          implants: [],
        },
      ],
      lastCloneJumpAt: '2026-09-02T12:00:00Z',
      lastStationChangeAt: '2026-08-30T12:00:00Z',
      ...publicMetadata,
    })
    expect(characterClonesScope).toBe(clonesScope)
    expect(mocks.getCharacterCacheAuthorization).toHaveBeenCalledWith(characterId, clonesScope)
    expect(mocks.getCharacterAuthorization).toHaveBeenCalledWith(characterId, clonesScope)
    expect(mocks.createEsiTransport).toHaveBeenCalledWith(
      'character-clones',
      `character-${characterId}`,
    )
    expect(mocks.getState).toHaveBeenCalledWith('GetCharactersCharacterIdClones', {
      path: { character_id: characterId },
    })
    expect(mocks.resolveUniverseNames).toHaveBeenCalledWith([60_000_001])
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
            jump_clone_id: 13,
            location_id: 60_000_002,
            location_type: 'station',
            implants: [99, 99],
          },
        ],
      }),
    )
    mocks.limit.mockRejectedValue(new Error('SDE unavailable'))
    mocks.resolveUniverseNames.mockRejectedValue(new Error('name resolution unavailable'))
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    await expect(getCharacterClones(characterId)).resolves.toEqual({
      homeLocation: { locationId: null, locationType: 'station', name: null },
      jumpClones: [
        {
          jumpCloneId: 13,
          name: null,
          location: { locationId: 60_000_002, locationType: 'station', name: null },
          implants: [{ typeId: 99, name: 'Unknown implant 99', slot: null, bonuses: [] }],
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

    const pending = getCharacterClones(characterId)
    await vi.advanceTimersByTimeAsync(250)

    await expect(pending).resolves.toMatchObject({
      homeLocation: { locationId: 60_000_001, locationType: 'station', name: null },
    })
  })

  test('keeps an omitted home location distinct and ignores non-station resolver results', async () => {
    mocks.getState.mockResolvedValue(
      response({
        jump_clones: [
          {
            jump_clone_id: 14,
            location_id: 60_000_003,
            location_type: 'station',
            implants: [],
          },
        ],
      }),
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([[60_000_003, { id: 60_000_003, name: 'Wrong category', category: 'solar_system' }]]),
    )
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    await expect(getCharacterClones(characterId)).resolves.toMatchObject({
      homeLocation: null,
      jumpClones: [{ location: { name: null } }],
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('serves a repeated request from the L1 cache without another ESI call', async () => {
    mocks.getState.mockResolvedValue(
      response({
        home_location: null,
        jump_clones: [
          {
            jump_clone_id: 15,
            location_id: 1_035_466_617_946,
            location_type: 'structure',
            implants: [4],
          },
        ],
      }),
    )
    mocks.staticRows.push({
      typeId: 4,
      name: 'Recovered Name',
      attributeId: null,
      attributeValue: null,
    })
    const { getCharacterClones } = await import('../../src/characters/clones.js')

    const first = await getCharacterClones(characterId)
    const second = await getCharacterClones(characterId)

    expect(second).toEqual(first)
    expect(mocks.getState).toHaveBeenCalledOnce()
  })
})

describe('active character implants', () => {
  test('loads, deduplicates, enriches, and sorts active implants independently', async () => {
    mocks.listActiveImplants.mockResolvedValue(response([4, 2, 4, 99]))
    mocks.staticRows.push(
      { typeId: 4, name: 'Beta Implant', attributeId: slotAttributeId, attributeValue: 1 },
      { typeId: 2, name: 'Alpha Implant', attributeId: slotAttributeId, attributeValue: 2 },
      { typeId: 2, name: 'Alpha Implant', attributeId: perceptionAttributeId, attributeValue: 3 },
    )
    const { characterImplantsScope, getCharacterImplants } =
      await import('../../src/characters/clones.js')

    await expect(getCharacterImplants(characterId)).resolves.toEqual({
      implants: [
        { typeId: 4, name: 'Beta Implant', slot: 1, bonuses: [] },
        {
          typeId: 2,
          name: 'Alpha Implant',
          slot: 2,
          bonuses: [{ attribute: 'perception', value: 3 }],
        },
        { typeId: 99, name: 'Unknown implant 99', slot: null, bonuses: [] },
      ],
      ...publicMetadata,
    })
    expect(characterImplantsScope).toBe(implantsScope)
    expect(mocks.getCharacterCacheAuthorization).toHaveBeenCalledWith(characterId, implantsScope)
    expect(mocks.createEsiTransport).toHaveBeenCalledWith(
      'character-implants',
      `character-${characterId}`,
    )
    expect(mocks.listActiveImplants).toHaveBeenCalledWith('GetCharactersCharacterIdImplants', {
      path: { character_id: characterId },
    })
    expect(mocks.resolveUniverseNames).not.toHaveBeenCalled()
  })

  test('drops unusable slot and zero bonus dogma values while ordering bonuses stably', async () => {
    mocks.listActiveImplants.mockResolvedValue(response([7, 8]))
    mocks.staticRows.push(
      { typeId: 7, name: 'Broken Slot', attributeId: slotAttributeId, attributeValue: 0 },
      { typeId: 7, name: 'Broken Slot', attributeId: memoryAttributeId, attributeValue: 0 },
      { typeId: 8, name: 'Dual Bonus', attributeId: slotAttributeId, attributeValue: 2 },
      { typeId: 8, name: 'Dual Bonus', attributeId: perceptionAttributeId, attributeValue: 3 },
      { typeId: 8, name: 'Dual Bonus', attributeId: memoryAttributeId, attributeValue: 5 },
    )
    const { getCharacterImplants } = await import('../../src/characters/clones.js')

    await expect(getCharacterImplants(characterId)).resolves.toMatchObject({
      implants: [
        {
          typeId: 8,
          name: 'Dual Bonus',
          slot: 2,
          bonuses: [
            { attribute: 'memory', value: 5 },
            { attribute: 'perception', value: 3 },
          ],
        },
        { typeId: 7, name: 'Broken Slot', slot: null, bonuses: [] },
      ],
    })
  })

  test('preserves an empty active implant collection without querying static data', async () => {
    mocks.listActiveImplants.mockResolvedValue(response([]))
    const { getCharacterImplants } = await import('../../src/characters/clones.js')

    await expect(getCharacterImplants(characterId)).resolves.toEqual({
      implants: [],
      ...publicMetadata,
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
