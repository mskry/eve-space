import { describe, expect, it } from 'vitest'
import {
  groupKeyOf,
  indexSkills,
  isInjectedOnly,
  levelCells,
  levelDescription,
  resolveActiveGroupKey,
  resolveInitialGroupKey,
  selectVisibleSkills,
  summariseGroups,
  type CatalogueGroup,
} from '../../app/utils/skill-catalogue'

function skill(
  typeId: number,
  name: string,
  activeLevel: number,
  trainedLevel = activeLevel,
  skillpoints = activeLevel === 0 && trainedLevel === 0 ? 0 : typeId * 10,
  injected = activeLevel > 0 || trainedLevel > 0 || skillpoints > 0,
) {
  return { typeId, name, injected, activeLevel, trainedLevel, skillpoints }
}

const groups: CatalogueGroup[] = [
  {
    groupId: 255,
    name: 'Gunnery',
    skills: [
      skill(1, 'Rapid Firing', 5),
      skill(2, 'Sharpshooter', 3),
      skill(5, 'Weapon Upgrades', 0),
    ],
  },
  { groupId: 1210, name: 'Armor', skills: [skill(3, 'Repair Systems', 5)] },
  { groupId: null, name: 'Unknown', skills: [skill(4, 'Unknown skill 4', 1)] },
]

const indexed = indexSkills(groups)

describe('indexSkills', () => {
  it('flattens groups and carries group identity onto every skill', () => {
    expect(indexed).toHaveLength(5)
    expect(indexed[0]).toMatchObject({ typeId: 1, groupKey: '255', groupName: 'Gunnery' })
    expect(indexed[4]).toMatchObject({
      typeId: 4,
      injected: true,
      groupKey: 'unknown',
      groupName: 'Unknown',
    })
    expect(indexed[2]).toMatchObject({ typeId: 5, injected: false })
  })

  it('keys a group without static data deterministically', () => {
    expect(groupKeyOf(null)).toBe('unknown')
    expect(groupKeyOf(255)).toBe('255')
  })
})

describe('selectVisibleSkills', () => {
  it('returns every skill under the all filter', () => {
    expect(selectVisibleSkills(indexed, 'all', null)).toHaveLength(5)
  })

  it('restricts to untrained skills', () => {
    expect(selectVisibleSkills(indexed, 'untrained', null).map((s) => s.typeId)).toEqual([5])
  })

  it('restricts to skills in progress from levels I through IV', () => {
    expect(selectVisibleSkills(indexed, 'progress', null).map((s) => s.typeId)).toEqual([2, 4])
  })

  it('restricts to skills at level V', () => {
    expect(selectVisibleSkills(indexed, 'v', null).map((s) => s.typeId)).toEqual([1, 3])
  })

  it('composes the filter with search matches', () => {
    const matches = { skillIds: new Set([1, 2]), groupKeys: new Set<string>() }

    expect(selectVisibleSkills(indexed, 'progress', matches).map((s) => s.typeId)).toEqual([2])
  })

  it('includes level-0 catalogue skills in the untrained view', () => {
    expect(selectVisibleSkills(indexed, 'untrained', null)).toContainEqual(
      expect.objectContaining({ typeId: 5, trainedLevel: 0, skillpoints: 0 }),
    )
  })

  it('includes every skill of a group whose name matched', () => {
    const matches = { skillIds: new Set<number>(), groupKeys: new Set(['255']) }

    expect(selectVisibleSkills(indexed, 'all', matches).map((s) => s.typeId)).toEqual([1, 2, 5])
  })
})

describe('summariseGroups', () => {
  it('counts only visible skills and keeps empty groups listed', () => {
    const visible = selectVisibleSkills(indexed, 'v', null)

    expect(summariseGroups(groups, visible)).toEqual([
      {
        key: '255',
        name: 'Gunnery',
        groupId: 255,
        icon: 'gunnery',
        count: 1,
        progressPercent: 53,
      },
      {
        key: '1210',
        name: 'Armor',
        groupId: 1210,
        icon: 'armor',
        count: 1,
        progressPercent: 100,
      },
      {
        key: 'unknown',
        name: 'Unknown',
        groupId: null,
        icon: 'unknown',
        count: 0,
        progressPercent: 20,
      },
    ])
  })

  it('counts level-0 catalogue skills in the all view', () => {
    expect(summariseGroups(groups, indexed).map(({ key, count }) => ({ key, count }))).toEqual([
      { key: '255', count: 3 },
      { key: '1210', count: 1 },
      { key: 'unknown', count: 1 },
    ])
  })

  it('keeps category progress independent of filtering', () => {
    const all = summariseGroups(groups, indexed)
    const atFive = summariseGroups(groups, selectVisibleSkills(indexed, 'v', null))

    expect(atFive.map(({ progressPercent }) => progressPercent)).toEqual(
      all.map(({ progressPercent }) => progressPercent),
    )
  })
})

describe('resolveInitialGroupKey', () => {
  const initialGroups: CatalogueGroup[] = [
    { groupId: 1, name: 'Armor', skills: [skill(10, 'Hull Upgrades', 0)] },
    { groupId: 2, name: 'Gunnery', skills: [skill(11, 'Gunnery', 1)] },
    { groupId: 3, name: 'Sequencing', skills: [skill(12, 'Biology', 0)] },
  ]

  it('prefers the first name-ordered group with character progress', () => {
    expect(resolveInitialGroupKey(initialGroups)).toBe('2')
  })

  it('falls back to the first published group when the character has no progress', () => {
    const noProgress = initialGroups.map((group) => ({
      groupId: group.groupId,
      name: group.name,
      skills: group.skills.map((entry) => skill(entry.typeId, entry.name, 0)),
    }))

    expect(resolveInitialGroupKey(noProgress)).toBe('1')
  })

  it('returns no selection for an empty catalogue', () => {
    expect(resolveInitialGroupKey([])).toBeNull()
  })
})

describe('resolveActiveGroupKey', () => {
  const summaries = summariseGroups(groups, selectVisibleSkills(indexed, 'all', null))

  it('keeps the selected group while it still has matches', () => {
    expect(resolveActiveGroupKey(summaries, '1210', false)).toBe('1210')
  })

  it('falls back to the first group with matches when the selection empties', () => {
    const filtered = summariseGroups(groups, selectVisibleSkills(indexed, 'v', null))

    expect(resolveActiveGroupKey(filtered, 'unknown', false)).toBe('255')
  })

  it('selects the first group with matches when nothing is chosen yet', () => {
    expect(resolveActiveGroupKey(summaries, null, false)).toBe('255')
  })

  it('yields to search results', () => {
    expect(resolveActiveGroupKey(summaries, '255', true)).toBeNull()
  })

  it('returns nothing when no group has matches', () => {
    const empty = summariseGroups(groups, [])

    expect(resolveActiveGroupKey(empty, '255', false)).toBeNull()
  })
})

describe('levelCells', () => {
  it('marks active, trained and untrained levels without a queue', () => {
    const cells = levelCells(indexSkills([groups[1]!])[0]!, 0)

    expect(cells.filter((cell) => cell.active)).toHaveLength(5)
    expect(cells.filter((cell) => cell.queued)).toHaveLength(0)
  })

  it('separates trained-but-inactive levels from active ones', () => {
    const partial = indexSkills([
      { groupId: 1, name: 'G', skills: [skill(9, 'Partial', 2, 4)] },
    ])[0]!
    const cells = levelCells(partial, 0)

    expect(cells.map((cell) => cell.active)).toEqual([true, true, false, false, false])
    expect(cells.map((cell) => cell.trained)).toEqual([false, false, true, true, false])
  })

  it('marks levels between trained and the queued target as queued', () => {
    const partial = indexSkills([
      { groupId: 1, name: 'G', skills: [skill(9, 'Partial', 2, 3)] },
    ])[0]!
    const cells = levelCells(partial, 5)

    expect(cells.map((cell) => cell.queued)).toEqual([false, false, false, true, true])
  })

  it('marks nothing queued when the queue is unavailable', () => {
    const partial = indexSkills([
      { groupId: 1, name: 'G', skills: [skill(9, 'Partial', 2, 3)] },
    ])[0]!

    expect(levelCells(partial, 0).some((cell) => cell.queued)).toBe(false)
  })
})

describe('levelDescription', () => {
  it('reports active and trained levels as text', () => {
    const partial = indexSkills([
      { groupId: 1, name: 'G', skills: [skill(9, 'Partial', 2, 4)] },
    ])[0]!

    expect(levelDescription(partial, 0)).toBe('Active level 2; trained level 4 of 5')
  })

  it('adds the queued target when the queue trains the skill higher', () => {
    const partial = indexSkills([
      { groupId: 1, name: 'G', skills: [skill(9, 'Partial', 2, 3)] },
    ])[0]!

    expect(levelDescription(partial, 5)).toBe(
      'Active level 2; trained level 3 of 5; queued to level 5',
    )
  })

  it('separates an injected untrained skill from one the character does not own', () => {
    const [injected, absent] = indexSkills([
      {
        groupId: 1,
        name: 'G',
        skills: [skill(9, 'Injected', 0, 0, 0, true), skill(10, 'Absent', 0, 0, 0, false)],
      },
    ])

    expect(levelDescription(injected!, 0)).toBe(
      'Active level 0; trained level 0 of 5; injected, not trained',
    )
    expect(levelDescription(absent!, 0)).toBe('Active level 0; trained level 0 of 5; not injected')
    expect(levelDescription(injected!, 2)).toBe(
      'Active level 0; trained level 0 of 5; injected, not trained; queued to level 2',
    )
  })
})

describe('isInjectedOnly', () => {
  it('marks only skills the character owns at level zero', () => {
    const [injected, absent, trained] = indexSkills([
      {
        groupId: 1,
        name: 'G',
        skills: [
          skill(9, 'Injected', 0, 0, 0, true),
          skill(10, 'Absent', 0, 0, 0, false),
          skill(11, 'Trained', 3),
        ],
      },
    ])

    expect(isInjectedOnly(injected!)).toBe(true)
    expect(isInjectedOnly(absent!)).toBe(false)
    expect(isInjectedOnly(trained!)).toBe(false)
  })
})
