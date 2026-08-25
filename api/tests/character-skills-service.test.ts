import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSkillsClient: vi.fn(),
  get: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getSkills: vi.fn(),
  innerJoin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  staticRows: [] as Array<{ typeId: number; typeName: string; groupId: number; groupName: string }>,
  where: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/skills', () => ({
  createSkillsClient: mocks.createSkillsClient,
}))
vi.mock('../src/db/client.js', () => ({ db: { select: mocks.select } }))
vi.mock('../src/token-service.js', () => ({
  getCharacterAuthorization: mocks.getCharacterAuthorization,
}))
vi.mock('../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))
vi.mock('../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

const characterId = 1404328063

beforeEach(() => {
  mocks.getCharacterAuthorization.mockResolvedValue({
    accessToken: 'access-token',
    tokenVersion: 1,
  })
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: `character-${characterId}` },
      {},
    )
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
  mocks.createSkillsClient.mockReturnValue({ withMetadata: () => ({ getSkills: mocks.getSkills }) })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin })
  mocks.innerJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockImplementation(async () => mocks.staticRows)
  mocks.staticRows.splice(0)
})

describe('detailed character skills', () => {
  test('authorizes and loads skills through the registered private resource', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 2500, unallocated_sp: 125, skills: [] }))
    const { characterSkillsScope, getCharacterSkills } =
      await import('../src/character-skills-service.js')

    await expect(getCharacterSkills(characterId)).resolves.toEqual({
      totalSp: 2500,
      unallocatedSp: 125,
      groups: [],
    })
    expect(characterSkillsScope).toBe('esi-skills.read_skills.v1')
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'skills',
      inputs: { characterId },
    })
  })

  test('keeps deterministic SDE grouping', async () => {
    mocks.getSkills.mockResolvedValue(
      response({
        total_sp: 19_000,
        skills: [skill(4, 4000, 4, 5), skill(2, 2000, 2, 2), skill(3, 3000, 3, 3)],
      }),
    )
    mocks.staticRows.push(
      { typeId: 2, typeName: 'Alpha', groupId: 20, groupName: 'Zeta Group' },
      { typeId: 3, typeName: 'Same', groupId: 10, groupName: 'Alpha Group' },
      { typeId: 4, typeName: 'Same', groupId: 10, groupName: 'Alpha Group' },
    )
    const { getCharacterSkills } = await import('../src/character-skills-service.js')

    await expect(getCharacterSkills(characterId)).resolves.toMatchObject({
      totalSp: 19_000,
      groups: [
        { name: 'Alpha Group', trainedSp: 7000 },
        { name: 'Zeta Group', trainedSp: 2000 },
      ],
    })
  })

  test('does not repeat SDE enrichment for a cached application DTO', async () => {
    mocks.get.mockResolvedValueOnce({
      data: { totalSp: 19_000, unallocatedSp: 0, groups: [] },
      cachedUntil: '',
      quota: {},
      source: 'cache',
      stale: false,
    })
    const { getCharacterSkills } = await import('../src/character-skills-service.js')

    await expect(getCharacterSkills(characterId)).resolves.toEqual({
      totalSp: 19_000,
      unallocatedSp: 0,
      groups: [],
    })
    expect(mocks.getSkills).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('uses the same private resource for detailed and summary skill views', async () => {
    mocks.getSkills.mockResolvedValue(response({ total_sp: 2500, unallocated_sp: 125, skills: [] }))
    const { getCharacterSkills } = await import('../src/character-skills-service.js')
    const { getCharacterSkillsSummary } = await import('../src/character-overview-service.js')

    await getCharacterSkills(characterId)
    await expect(getCharacterSkillsSummary(characterId)).resolves.toEqual({
      totalSp: 2500,
      unallocatedSp: 125,
    })
    expect(mocks.get.mock.calls.map(([resource]) => resource.inputs)).toEqual([
      { characterId },
      { characterId },
    ])
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
