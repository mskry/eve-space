import { beforeEach, describe, expect, test, vi } from 'vitest'

interface StaticRow {
  groupId: number
  groupName: string
  typeId: number | null
  typeName: string | null
}

const mocks = vi.hoisted(() => ({
  createSkillsClient: vi.fn(),
  get: vi.fn(),
  getSkills: vi.fn(),
  leftJoin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  staticRows: [] as StaticRow[],
  where: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/skills', () => ({
  createSkillsClient: mocks.createSkillsClient,
}))
vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

const characterId = 1404328063

beforeEach(() => {
  vi.resetModules()
  mocks.get.mockReset()
  mocks.getSkills.mockReset()
  mocks.select.mockReset()
  mocks.from.mockReset()
  mocks.leftJoin.mockReset()
  mocks.where.mockReset()
  mocks.createSkillsClient.mockReset()
  mocks.staticRows.splice(0)

  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: `character-${characterId}` },
      {},
    )
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
  mocks.createSkillsClient.mockReturnValue({ withMetadata: () => ({ getSkills: mocks.getSkills }) })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ leftJoin: mocks.leftJoin })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockImplementation(async () => mocks.staticRows)
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
      totalSp: 19_000,
      unallocatedSp: 0,
      skills: [
        { typeId: 4, skillpoints: 4000, activeLevel: 4, trainedLevel: 5 },
        { typeId: 2, skillpoints: 2000, activeLevel: 2, trainedLevel: 2 },
      ],
    })
    expect(characterSkillsScope).toBe('esi-skills.read_skills.v1')
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'skills',
      inputs: { characterId },
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
    })
    expect(mocks.select).not.toHaveBeenCalled()
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

    await expect(getCharacterSkills(characterId)).resolves.toEqual({
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
    })
    expect(skillCategoryId).toBe(16)
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'skills',
      inputs: { characterId },
    })
    expect(mocks.getSkills).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.from).toHaveBeenCalledOnce()
    expect(mocks.leftJoin).toHaveBeenCalledOnce()
    expect(mocks.where).toHaveBeenCalledOnce()
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
    })
  })

  test('composes a cached normalized snapshot without another ESI request', async () => {
    mocks.get.mockResolvedValueOnce({
      data: {
        totalSp: 19_000,
        unallocatedSp: 25,
        skills: [{ typeId: 2, skillpoints: 2000, activeLevel: 2, trainedLevel: 2 }],
      },
      cachedUntil: '',
      quota: {},
      source: 'cache',
      stale: false,
    })
    mocks.staticRows.push(staticSkill(10, 'Engineering', 2, 'Capacitor Management'))
    const { getCharacterSkills } = await import('../../src/characters/skills.js')

    await expect(getCharacterSkills(characterId)).resolves.toMatchObject({
      totalSp: 19_000,
      unallocatedSp: 25,
      injectedSkillCount: 1,
      groups: [{ groupId: 10, trainedSp: 2000 }],
    })
    expect(mocks.getSkills).not.toHaveBeenCalled()
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
