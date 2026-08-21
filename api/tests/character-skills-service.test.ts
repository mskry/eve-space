import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSkillsClient: vi.fn(),
  getCharacterAccessToken: vi.fn(),
  getSkills: vi.fn(),
  innerJoin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  staticRows: [] as Array<{
    typeId: number
    typeName: string
    groupId: number
    groupName: string
  }>,
  where: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/skills', () => ({
  createSkillsClient: mocks.createSkillsClient,
}))

vi.mock('../src/db/client.js', () => ({
  db: { select: mocks.select },
}))

vi.mock('../src/esi-fetch.js', () => ({ esiFetch: vi.fn() }))

vi.mock('../src/token-service.js', () => ({
  getCharacterAccessToken: mocks.getCharacterAccessToken,
}))

import { characterSkillsScope, getCharacterSkills } from '../src/character-skills-service.js'

const characterId = 1404328063

beforeEach(() => {
  mocks.getCharacterAccessToken.mockResolvedValue('access-token')
  mocks.createSkillsClient.mockReturnValue({ getSkills: mocks.getSkills })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin })
  mocks.innerJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockImplementation(async () => mocks.staticRows)
  mocks.staticRows.splice(0)
})

describe('detailed character skills', () => {
  test('returns ESI totals and skips the SDE query for an empty trained list', async () => {
    mocks.getSkills.mockResolvedValue({ total_sp: 2500, unallocated_sp: 125, skills: [] })

    const result = await getCharacterSkills(characterId)

    expect(result).toEqual({ totalSp: 2500, unallocatedSp: 125, groups: [] })
    expect(mocks.getCharacterAccessToken).toHaveBeenCalledWith(characterId, characterSkillsScope)
    expect(mocks.createSkillsClient).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'access-token' }),
    )
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('joins published SDE matches once and maps deterministic grouped skills', async () => {
    mocks.getSkills.mockResolvedValue({
      total_sp: 19_000,
      skills: [
        skill(4, 4000, 4, 5),
        skill(99, 990, 1, 1),
        skill(2, 2000, 2, 2),
        skill(3, 3000, 3, 3),
        skill(1, 1000, 1, 1),
        skill(98, 980, 0, 1),
      ],
    })
    mocks.staticRows.push(
      { typeId: 1, typeName: 'Beta', groupId: 20, groupName: 'Zeta Group' },
      { typeId: 2, typeName: 'Alpha', groupId: 20, groupName: 'Zeta Group' },
      { typeId: 3, typeName: 'Same', groupId: 10, groupName: 'Alpha Group' },
      { typeId: 4, typeName: 'Same', groupId: 10, groupName: 'Alpha Group' },
      { typeId: 500, typeName: 'Untrained', groupId: 10, groupName: 'Alpha Group' },
    )

    const result = await getCharacterSkills(characterId)

    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.where).toHaveBeenCalledOnce()
    expect(result.totalSp).toBe(19_000)
    expect(result.unallocatedSp).toBe(0)
    expect(result.groups.map((group) => group.name)).toEqual([
      'Alpha Group',
      'Unknown',
      'Zeta Group',
    ])
    expect(result.groups[0]).toMatchObject({
      groupId: 10,
      trainedSp: 7000,
      skills: [
        { typeId: 3, name: 'Same' },
        { typeId: 4, name: 'Same' },
      ],
    })
    expect(result.groups[1]).toEqual({
      groupId: null,
      name: 'Unknown',
      trainedSp: 1970,
      skills: [
        {
          typeId: 98,
          name: 'Unknown skill 98',
          activeLevel: 0,
          trainedLevel: 1,
          skillpoints: 980,
        },
        {
          typeId: 99,
          name: 'Unknown skill 99',
          activeLevel: 1,
          trainedLevel: 1,
          skillpoints: 990,
        },
      ],
    })
    expect(result.groups[2]?.skills.map((entry) => entry.name)).toEqual(['Alpha', 'Beta'])
    expect(result.groups.flatMap((group) => group.skills)).not.toContainEqual(
      expect.objectContaining({ typeId: 500 }),
    )
  })
})

function skill(typeId: number, skillpoints: number, activeLevel: number, trainedLevel: number) {
  return {
    skill_id: typeId,
    skillpoints_in_skill: skillpoints,
    active_skill_level: activeLevel,
    trained_skill_level: trainedLevel,
  }
}
