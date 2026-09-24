import { describe, expect, test } from 'vitest'
import { projectTrainedSkills } from '../src/trained-skills.js'

describe('trained-skill projection', () => {
  test('projects deterministic catalogue progress and retains unknown skills', () => {
    const result = projectTrainedSkills(
      {
        skills: [
          { typeId: 99, activeLevel: 1, trainedLevel: 2, skillpoints: 900 },
          { typeId: 4, activeLevel: 4, trainedLevel: 5, skillpoints: 4000 },
        ],
        totalSp: 9000,
        unallocatedSp: 25,
      },
      {
        groups: [
          {
            groupId: 20,
            name: 'Zeta Group',
            skills: [
              {
                name: 'Beta',
                primaryAttribute: 'intelligence',
                rank: 1,
                secondaryAttribute: 'memory',
                typeId: 2,
              },
            ],
          },
          {
            groupId: 10,
            name: 'Alpha Group',
            skills: [
              {
                name: 'Same',
                primaryAttribute: 'perception',
                rank: 2,
                secondaryAttribute: 'willpower',
                typeId: 4,
              },
              {
                name: 'Alpha',
                primaryAttribute: null,
                rank: null,
                secondaryAttribute: null,
                typeId: 3,
              },
            ],
          },
        ],
      },
    )

    expect(result).toMatchObject({ injectedSkillCount: 2, totalSp: 9000, unallocatedSp: 25 })
    expect(result.groups.map(({ name }) => name)).toStrictEqual([
      'Alpha Group',
      'Unknown',
      'Zeta Group',
    ])
    expect(result.groups[0]).toMatchObject({
      skills: [
        { typeId: 3, injected: false, skillpoints: 0 },
        {
          typeId: 4,
          injected: true,
          rank: 2,
          primaryAttribute: 'perception',
          secondaryAttribute: 'willpower',
        },
      ],
      trainedSp: 4000,
    })
    expect(result.groups[1]).toMatchObject({
      groupId: null,
      skills: [
        {
          typeId: 99,
          name: 'Unknown skill 99',
          rank: null,
          primaryAttribute: null,
          secondaryAttribute: null,
        },
      ],
      trainedSp: 900,
    })
  })
})
