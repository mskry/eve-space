import { describe, expect, it } from 'vitest'
import {
  deriveJumpCloneCapacity,
  formatImplantSlot,
  groupJumpClonesByLocation,
  toImplantRack,
} from '../../app/utils/clone-derivation'

function implant(
  slot: number | null,
  name: string,
  bonuses: { attribute: string; value: number }[] = [],
) {
  return { bonuses, name, slot, typeId: slot ?? 999 }
}

describe('jump clone capacity', () => {
  const skills = {
    groups: [
      {
        skills: [
          { activeLevel: 5, trainedLevel: 5, typeId: 24_242 },
          { activeLevel: 3, trainedLevel: 3, typeId: 33_407 },
          { activeLevel: 5, trainedLevel: 5, typeId: 3327 },
        ],
      },
    ],
  }

  it('sums both infomorph skills into the maximum', () => {
    expect(deriveJumpCloneCapacity(4, skills)).toStrictEqual({ installed: 4, maximum: 8 })
  })

  it('leaves the maximum unknown when the skills resource is unavailable', () => {
    expect(deriveJumpCloneCapacity(4, undefined)).toStrictEqual({ installed: 4, maximum: null })
  })

  it('reports no capacity when neither infomorph skill is trained', () => {
    expect(
      deriveJumpCloneCapacity(0, {
        groups: [{ skills: [{ activeLevel: 5, trainedLevel: 5, typeId: 3327 }] }],
      }),
    ).toStrictEqual({ installed: 0, maximum: 0 })
  })

  it('uses the trained level so an alpha-capped character keeps its real capacity', () => {
    const lapsedToAlpha = {
      groups: [
        {
          skills: [
            { activeLevel: 1, trainedLevel: 5, typeId: 24_242 },
            { activeLevel: 0, trainedLevel: 3, typeId: 33_407 },
          ],
        },
      ],
    }

    expect(deriveJumpCloneCapacity(6, lapsedToAlpha)).toStrictEqual({ installed: 6, maximum: 8 })
  })

  it('withholds a maximum that contradicts the number of installed clones', () => {
    const understated = {
      groups: [{ skills: [{ activeLevel: 1, trainedLevel: 1, typeId: 24_242 }] }],
    }

    expect(deriveJumpCloneCapacity(6, understated)).toStrictEqual({ installed: 6, maximum: null })
  })
})

describe('implant rack', () => {
  it('splits attribute slots from hardwirings and keeps empty slots addressable', () => {
    const rack = toImplantRack([implant(1, 'Ocular Filter'), implant(7, 'Zainou Gnome')])

    expect(rack.attributes.map((entry) => entry.slot)).toStrictEqual([1, 2, 3, 4, 5])
    expect(rack.hardwirings.map((entry) => entry.slot)).toStrictEqual([6, 7, 8, 9, 10])
    expect(rack.attributes[0]?.implant?.name).toBe('Ocular Filter')
    expect(rack.attributes[1]?.implant).toBeNull()
    expect(rack.hardwirings[1]?.implant?.name).toBe('Zainou Gnome')
    expect(rack.filledSlots).toBe(2)
    expect(rack.emptySlots).toBe(8)
  })

  it('keeps implants with an unusable slot visible instead of dropping them', () => {
    const rack = toImplantRack([implant(null, 'Unknown implant 999'), implant(11, 'Out of range')])

    expect(rack.unslotted.map((entry) => entry.name)).toStrictEqual([
      'Unknown implant 999',
      'Out of range',
    ])
    expect(rack.filledSlots).toBe(0)
  })

  it('degrades instead of throwing when a payload predates the slot and bonus fields', () => {
    const legacy = [
      { name: 'Ocular Filter', typeId: 1 },
      { name: 'Memory Aug', typeId: 2 },
    ]

    const rack = toImplantRack(legacy)
    expect(rack.filledSlots).toBe(0)
    expect(rack.unslotted).toHaveLength(2)
    expect(rack.attributes.every((entry) => entry.implant === null)).toBe(true)
  })

  it('leaves the gutter blank for an unusable slot value', () => {
    expect(formatImplantSlot(undefined)).toBe('')
    expect(formatImplantSlot(null)).toBe('')
    expect(formatImplantSlot(1)).toBe('01')
    expect(formatImplantSlot(10)).toBe('10')
  })

  it('tolerates an absent implant collection', () => {
    expect(toImplantRack(undefined).filledSlots).toBe(0)
  })
})

function stationClone(jumpCloneId: number, locationId: number, name: string | null) {
  return {
    implants: [],
    jumpCloneId,
    location: { locationId, locationType: 'station' as const, name },
    name,
  }
}

describe('jump clone grouping', () => {
  it('groups clones by location, busiest first, keeping first appearance for equal counts', () => {
    const groups = groupJumpClonesByLocation([
      stationClone(12, 60_000_002, 'Amarr VIII'),
      stationClone(11, 60_000_001, 'Jita IV - Moon 4'),
      stationClone(13, 60_000_001, 'Jita IV - Moon 4'),
      stationClone(14, 60_000_003, 'Dodixie IX'),
    ])

    expect(groups.map((group) => group.label)).toStrictEqual([
      'Jita IV - Moon 4',
      'Amarr VIII',
      'Dodixie IX',
    ])
    expect(groups[0]?.clones.map((entry) => entry.jumpCloneId)).toStrictEqual([11, 13])
  })

  it('labels an unresolved location by type and identifier', () => {
    const groups = groupJumpClonesByLocation([
      {
        implants: [],
        jumpCloneId: 14,
        location: { locationId: 1_035_466_617_946, locationType: 'structure', name: null },
        name: null,
      },
    ])

    expect(groups[0]?.label).toBe('Structure 1035466617946')
    expect(groups[0]?.locationType).toBe('structure')
  })

  it('separates identical identifiers across location types', () => {
    const groups = groupJumpClonesByLocation([
      stationClone(15, 60_000_001, 'Station'),
      {
        implants: [],
        jumpCloneId: 16,
        location: { locationId: 60_000_001, locationType: 'structure', name: null },
        name: null,
      },
    ])

    expect(groups).toHaveLength(2)
  })
})
