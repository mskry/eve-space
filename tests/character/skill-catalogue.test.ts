import { describe, expect, it } from 'vitest'
import {
  groupKeyOf,
  indexSkills,
  levelCells,
  levelDescription,
  resolveActiveGroupKey,
  selectVisibleSkills,
  summariseGroups,
  type CatalogueGroup,
} from '../../app/utils/skill-catalogue'

function skill(typeId: number, name: string, activeLevel: number, trainedLevel = activeLevel) {
  return { typeId, name, activeLevel, trainedLevel, skillpoints: typeId * 10 }
}

const groups: CatalogueGroup[] = [
  {
    groupId: 255,
    name: 'Gunnery',
    skills: [skill(1, 'Rapid Firing', 5), skill(2, 'Sharpshooter', 3)],
  },
  { groupId: 1210, name: 'Armor', skills: [skill(3, 'Repair Systems', 5)] },
  { groupId: null, name: 'Unknown', skills: [skill(4, 'Unknown skill 4', 1)] },
]

const indexed = indexSkills(groups)

describe('indexSkills', () => {
  it('flattens groups and carries group identity onto every skill', () => {
    expect(indexed).toHaveLength(4)
    expect(indexed[0]).toMatchObject({ typeId: 1, groupKey: '255', groupName: 'Gunnery' })
    expect(indexed[3]).toMatchObject({ typeId: 4, groupKey: 'unknown', groupName: 'Unknown' })
  })

  it('keys a group without static data deterministically', () => {
    expect(groupKeyOf(null)).toBe('unknown')
    expect(groupKeyOf(255)).toBe('255')
  })
})

describe('selectVisibleSkills', () => {
  it('returns every skill under the all filter', () => {
    expect(selectVisibleSkills(indexed, 'all', null)).toHaveLength(4)
  })

  it('restricts to skills below level V', () => {
    expect(selectVisibleSkills(indexed, 'partial', null).map((s) => s.typeId)).toEqual([2, 4])
  })

  it('restricts to skills at level V', () => {
    expect(selectVisibleSkills(indexed, 'v', null).map((s) => s.typeId)).toEqual([1, 3])
  })

  it('composes the filter with search matches', () => {
    const matches = { skillIds: new Set([1, 2]), groupKeys: new Set<string>() }

    expect(selectVisibleSkills(indexed, 'partial', matches).map((s) => s.typeId)).toEqual([2])
  })

  it('includes every skill of a group whose name matched', () => {
    const matches = { skillIds: new Set<number>(), groupKeys: new Set(['255']) }

    expect(selectVisibleSkills(indexed, 'all', matches).map((s) => s.typeId)).toEqual([1, 2])
  })
})

describe('summariseGroups', () => {
  it('counts only visible skills and keeps empty groups listed', () => {
    const visible = selectVisibleSkills(indexed, 'v', null)

    expect(summariseGroups(groups, visible)).toEqual([
      { key: '255', name: 'Gunnery', groupId: 255, count: 1 },
      { key: '1210', name: 'Armor', groupId: 1210, count: 1 },
      { key: 'unknown', name: 'Unknown', groupId: null, count: 0 },
    ])
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
})
