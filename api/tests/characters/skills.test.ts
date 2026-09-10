import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface StaticRow {
  groupId: number
  groupName: string
  typeId: number | null
  typeName: string | null
}

const mocks = vi.hoisted(() => ({
  createEsiClient: vi.fn(),
  getSkills: vi.fn(),
  leftJoin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  staticRows: [] as StaticRow[],
  where: vi.fn(),
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
        return mocks.getSkills(...arguments_)
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

const characterId = 1404328063
const scope = 'esi-skills.read_skills.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }
const esiMetadata = {
  cachedUntil: '2026-09-01T11:01:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}
const publicMetadata = {
  cachedUntil: esiMetadata.cachedUntil,
  validatedAt: esiMetadata.validatedAt,
  stale: false,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetModules()
  mocks.getSkills.mockReset()
  mocks.select.mockReset()
  mocks.from.mockReset()
  mocks.leftJoin.mockReset()
  mocks.where.mockReset()
  mocks.createEsiClient.mockReset()
  mocks.createEsiTransport.mockReset()
  mocks.getCharacterAuthorization.mockReset()
  mocks.getCharacterCacheAuthorization.mockReset()
  mocks.acquire.mockReset()
  mocks.commit.mockReset()
  mocks.getCommitted.mockReset()
  mocks.getLeaseTtl.mockReset()
  mocks.getRevision.mockReset()
  mocks.incrementRevision.mockReset()
  mocks.initialize.mockReset()
  mocks.release.mockReset()
  mocks.renew.mockReset()
  mocks.cacheGet.mockReset()
  mocks.cacheSet.mockReset()
  mocks.cacheDel.mockReset()
  mocks.staticRows.splice(0)

  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ leftJoin: mocks.leftJoin })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockImplementation(async () => mocks.staticRows)
  mocks.createEsiTransport.mockReturnValue(vi.fn())
  mocks.getCharacterAuthorization.mockResolvedValue({
    accessToken: 'access-token',
    tokenVersion: 1,
  })
  mocks.getCharacterCacheAuthorization.mockResolvedValue({ scopes: [scope], tokenVersion: 1 })
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
})

afterEach(() => {
  vi.useRealTimers()
})

describe('character skills snapshot', () => {
  test('normalizes every ESI record without loading static data', async () => {
    mocks.getSkills.mockResolvedValue(
      response({
        total_sp: 19_000,
        skills: [skill(4, 4000, 4, 5), skill(2, 2000, 2, 2)],
      }),
    )
    const { characterSkillsScope, getCharacterSkillsData } =
      await import('../../src/characters/skills.js')

    await expect(getCharacterSkillsData(characterId)).resolves.toEqual({
      data: {
        totalSp: 19_000,
        unallocatedSp: 0,
        skills: [
          { typeId: 4, skillpoints: 4000, activeLevel: 4, trainedLevel: 5 },
          { typeId: 2, skillpoints: 2000, activeLevel: 2, trainedLevel: 2 },
        ],
      },
      ...esiMetadata,
    })
    expect(characterSkillsScope).toBe(scope)
    expect(mocks.getCharacterCacheAuthorization).toHaveBeenCalledWith(characterId, scope)
    expect(mocks.getCharacterAuthorization).toHaveBeenCalledWith(characterId, scope)
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('skills', `character-${characterId}`)
    expect(mocks.createEsiClient).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      token: 'access-token',
      validateResponses: true,
    })
    expect(mocks.getSkills).toHaveBeenCalledWith('GetCharactersCharacterIdSkills', {
      path: { character_id: characterId },
    })
    expect(mocks.getSkills).toHaveBeenCalledOnce()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('summary reads only the normalized snapshot', async () => {
    mocks.getSkills.mockResolvedValue(
      response({ total_sp: 2500, unallocated_sp: 125, skills: [skill(2, 2000, 2, 2)] }),
    )
    const { getCharacterSkillsSummary } = await import('../../src/characters/overview.js')

    await expect(getCharacterSkillsSummary(characterId)).resolves.toEqual({
      totalSp: 2500,
      unallocatedSp: 125,
      ...publicMetadata,
    })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('serves a repeated request from the L1 cache without another ESI call', async () => {
    mocks.getSkills.mockResolvedValue(
      response({ total_sp: 19_000, unallocated_sp: 25, skills: [skill(2, 2000, 2, 2)] }),
    )
    const { getCharacterSkillsData } = await import('../../src/characters/skills.js')

    const first = await getCharacterSkillsData(characterId)
    const second = await getCharacterSkillsData(characterId)

    expect(first.source).toBe('esi')
    expect(second).toMatchObject({ source: 'cache', stale: false, data: first.data })
    expect(mocks.getSkills).toHaveBeenCalledOnce()
    expect(mocks.getCharacterAuthorization).toHaveBeenCalledOnce()
  })
})

describe('detailed character skills catalogue', () => {
  test('overlays progress onto complete groups and preserves unmatched ESI records', async () => {
    mocks.getSkills.mockResolvedValue(
      response({
        total_sp: 19_000,
        unallocated_sp: 125,
        skills: [skill(4, 4000, 4, 5), skill(99, 900, 1, 2)],
      }),
    )
    mocks.staticRows.push(
      staticSkill(20, 'Zeta Group', 2, 'Beta'),
      staticSkill(10, 'Alpha Group', 4, 'Same'),
      staticSkill(10, 'Alpha Group', 3, 'Alpha'),
      staticSkill(10, 'Alpha Group', 4, 'Same'),
      { groupId: 30, groupName: 'Empty Group', typeId: null, typeName: null },
    )
    const { getCharacterSkills, skillCategoryId } = await import('../../src/characters/skills.js')

    const result = await getCharacterSkills(characterId)
    expect(result).toEqual({
      totalSp: 19_000,
      unallocatedSp: 125,
      injectedSkillCount: 2,
      groups: [
        {
          groupId: 10,
          name: 'Alpha Group',
          trainedSp: 4000,
          skills: [
            {
              typeId: 3,
              name: 'Alpha',
              injected: false,
              activeLevel: 0,
              trainedLevel: 0,
              skillpoints: 0,
            },
            {
              typeId: 4,
              name: 'Same',
              injected: true,
              activeLevel: 4,
              trainedLevel: 5,
              skillpoints: 4000,
            },
          ],
        },
        { groupId: 30, name: 'Empty Group', trainedSp: 0, skills: [] },
        {
          groupId: null,
          name: 'Unknown',
          trainedSp: 900,
          skills: [
            {
              typeId: 99,
              name: 'Unknown skill 99',
              injected: true,
              activeLevel: 1,
              trainedLevel: 2,
              skillpoints: 900,
            },
          ],
        },
        {
          groupId: 20,
          name: 'Zeta Group',
          trainedSp: 0,
          skills: [
            {
              typeId: 2,
              name: 'Beta',
              injected: false,
              activeLevel: 0,
              trainedLevel: 0,
              skillpoints: 0,
            },
          ],
        },
      ],
      ...publicMetadata,
    })
    expect(skillCategoryId).toBe(16)
    expect(mocks.getSkills).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(Object.keys(mocks.select.mock.calls[0]![0])).toEqual([
      'groupId',
      'groupName',
      'typeId',
      'typeName',
    ])
    expect(mocks.from).toHaveBeenCalledOnce()
    expect(mocks.leftJoin).toHaveBeenCalledOnce()
    expect(mocks.where).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toMatch(
      /description|"detail"|"rank"|primaryAttribute|secondaryAttribute/,
    )
  })

  test('returns the full zero-progress catalogue for an empty ESI skill list', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 0, skills: [] }))
    mocks.staticRows.push(staticSkill(10, 'Engineering', 2, 'Capacitor Management'))
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    await expect(getCharacterSkills(characterId)).resolves.toEqual({
      totalSp: 0,
      unallocatedSp: 0,
      injectedSkillCount: 0,
      groups: [
        {
          groupId: 10,
          name: 'Engineering',
          trainedSp: 0,
          skills: [
            {
              typeId: 2,
              name: 'Capacitor Management',
              injected: false,
              activeLevel: 0,
              trainedLevel: 0,
              skillpoints: 0,
            },
          ],
        },
      ],
      ...publicMetadata,
    })
  })

  test('composes a cached normalized snapshot without another ESI request', async () => {
    mocks.getSkills.mockResolvedValue(
      response({
        total_sp: 19_000,
        unallocated_sp: 25,
        skills: [skill(2, 2000, 2, 2)],
      }),
    )
    mocks.staticRows.push(staticSkill(10, 'Engineering', 2, 'Capacitor Management'))
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    await getCharacterSkills(characterId)
    const cached = await getCharacterSkills(characterId)

    expect(cached).toMatchObject({
      totalSp: 19_000,
      unallocatedSp: 25,
      injectedSkillCount: 1,
      groups: [{ groupId: 10, trainedSp: 2000 }],
    })
    expect(mocks.getSkills).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  test('reuses one process-local catalogue across repeated character requests', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 0, skills: [] }))
    mocks.staticRows.push(staticSkill(10, 'Engineering', 2, 'Capacitor Management'))
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    await getCharacterSkills(characterId)
    await getCharacterSkills(characterId + 1)

    expect(mocks.getSkills).toHaveBeenCalledTimes(2)
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  test('collapses concurrent catalogue initialization', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 0, skills: [] }))
    const catalogue = deferred<StaticRow[]>()
    mocks.where.mockReturnValue(catalogue.promise)
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    const first = getCharacterSkills(characterId)
    const second = getCharacterSkills(characterId + 1)
    await vi.waitFor(() => expect(mocks.select).toHaveBeenCalledOnce())
    catalogue.resolve([staticSkill(10, 'Engineering', 2, 'Capacitor Management')])

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(mocks.select).toHaveBeenCalledOnce()
  })

  test('retries an empty catalogue on a later request', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 0, skills: [] }))
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    await expect(getCharacterSkills(characterId)).resolves.toMatchObject({ groups: [] })
    mocks.staticRows.push(staticSkill(10, 'Engineering', 2, 'Capacitor Management'))

    await expect(getCharacterSkills(characterId + 1)).resolves.toMatchObject({
      groups: [{ groupId: 10, skills: [{ typeId: 2, injected: false }] }],
    })
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  test('clears a rejected catalogue initialization so a later request retries', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 0, skills: [] }))
    mocks.where.mockRejectedValueOnce(new Error('temporary PostgreSQL failure'))
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    await expect(getCharacterSkills(characterId)).rejects.toThrow('temporary PostgreSQL failure')
    mocks.where.mockResolvedValueOnce([staticSkill(10, 'Engineering', 2, 'Capacitor Management')])

    await expect(getCharacterSkills(characterId)).resolves.toMatchObject({
      injectedSkillCount: 0,
      groups: [{ groupId: 10 }],
    })
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}

function skill(typeId: number, skillpoints: number, activeLevel: number, trainedLevel: number) {
  return {
    skill_id: typeId,
    skillpoints_in_skill: skillpoints,
    active_skill_level: activeLevel,
    trained_skill_level: trainedLevel,
  }
}

function staticSkill(
  groupId: number,
  groupName: string,
  typeId: number,
  typeName: string,
): StaticRow {
  return { groupId, groupName, typeId, typeName }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
