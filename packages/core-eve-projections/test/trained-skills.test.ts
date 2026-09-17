import { describe, expect, test } from 'vitest'
import { projectTrainedSkills } from '../src/trained-skills.js'

describe('trained-skill projection', () => {
  test('projects deterministic catalogue progress and retains unknown skills', () => {
    const result = projectTrainedSkills(
      {
        totalSp: 9_000,
        unallocatedSp: 25,
        skills: [
          { typeId: 99, activeLevel: 1, trainedLevel: 2, skillpoints: 900 },
          { typeId: 4, activeLevel: 4, trainedLevel: 5, skillpoints: 4_000 },
        ],
      },
      {
        groups: [
          {
            groupId: 20,
            name: 'Zeta Group',
            skills: [
              {
                typeId: 2,
                name: 'Beta',
                rank: 1,
                primaryAttribute: 'intelligence',
                secondaryAttribute: 'memory',
              },
            ],
          },
          {
            groupId: 10,
            name: 'Alpha Group',
            skills: [
              {
                typeId: 4,
                name: 'Same',
                rank: 2,
                primaryAttribute: 'perception',
                secondaryAttribute: 'willpower',
              },
              {
                typeId: 3,
                name: 'Alpha',
                rank: null,
                primaryAttribute: null,
                secondaryAttribute: null,
              },
            ],
          },
        ],
      },
    )

    expect(result).toMatchObject({ totalSp: 9_000, unallocatedSp: 25, injectedSkillCount: 2 })
    expect(result.groups.map(({ name }) => name)).toEqual(['Alpha Group', 'Unknown', 'Zeta Group'])
    expect(result.groups[0]).toMatchObject({
      trainedSp: 4_000,
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
    })
    expect(result.groups[1]).toMatchObject({
      groupId: null,
      trainedSp: 900,
      skills: [
        {
          typeId: 99,
          name: 'Unknown skill 99',
          rank: null,
          primaryAttribute: null,
          secondaryAttribute: null,
        },
      ],
    })
  })
})
