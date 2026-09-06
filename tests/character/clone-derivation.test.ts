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
  return { typeId: slot ?? 999, name, slot, bonuses }
}

describe('jump clone capacity', () => {
  const skills = {
    groups: [
      {
        skills: [
          { typeId: 24_242, trainedLevel: 5, activeLevel: 5 },
          { typeId: 33_407, trainedLevel: 3, activeLevel: 3 },
          { typeId: 3_327, trainedLevel: 5, activeLevel: 5 },
        ],
      },
    ],
  }

  it('sums both infomorph skills into the maximum', () => {
    expect(deriveJumpCloneCapacity(4, skills)).toEqual({ installed: 4, maximum: 8 })
  })

  it('leaves the maximum unknown when the skills resource is unavailable', () => {
    expect(deriveJumpCloneCapacity(4, undefined)).toEqual({ installed: 4, maximum: null })
  })

  it('reports no capacity when neither infomorph skill is trained', () => {
    expect(
      deriveJumpCloneCapacity(0, {
        groups: [{ skills: [{ typeId: 3_327, trainedLevel: 5, activeLevel: 5 }] }],
      }),
    ).toEqual({ installed: 0, maximum: 0 })
  })

  it('uses the trained level so an alpha-capped character keeps its real capacity', () => {
    const lapsedToAlpha = {
      groups: [
        {
          skills: [
            { typeId: 24_242, trainedLevel: 5, activeLevel: 1 },
            { typeId: 33_407, trainedLevel: 3, activeLevel: 0 },
          ],
        },
      ],
    }

    expect(deriveJumpCloneCapacity(6, lapsedToAlpha)).toEqual({ installed: 6, maximum: 8 })
  })

  it('withholds a maximum that contradicts the number of installed clones', () => {
    const understated = {
      groups: [{ skills: [{ typeId: 24_242, trainedLevel: 1, activeLevel: 1 }] }],
    }

    expect(deriveJumpCloneCapacity(6, understated)).toEqual({ installed: 6, maximum: null })
  })
})

describe('implant rack', () => {
  it('splits attribute slots from hardwirings and keeps empty slots addressable', () => {
    const rack = toImplantRack([implant(1, 'Ocular Filter'), implant(7, 'Zainou Gnome')])

    expect(rack.attributes.map((entry) => entry.slot)).toEqual([1, 2, 3, 4, 5])
    expect(rack.hardwirings.map((entry) => entry.slot)).toEqual([6, 7, 8, 9, 10])
    expect(rack.attributes[0]?.implant?.name).toBe('Ocular Filter')
    expect(rack.attributes[1]?.implant).toBeNull()
    expect(rack.hardwirings[1]?.implant?.name).toBe('Zainou Gnome')
    expect(rack.filledSlots).toBe(2)
    expect(rack.emptySlots).toBe(8)
  })

  it('keeps implants with an unusable slot visible instead of dropping them', () => {
    const rack = toImplantRack([implant(null, 'Unknown implant 999'), implant(11, 'Out of range')])

    expect(rack.unslotted.map((entry) => entry.name)).toEqual([
      'Unknown implant 999',
      'Out of range',
    ])
    expect(rack.filledSlots).toBe(0)
  })

  it('degrades instead of throwing when a payload predates the slot and bonus fields', () => {
    const legacy = [
      { typeId: 1, name: 'Ocular Filter' },
      { typeId: 2, name: 'Memory Aug' },
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
    jumpCloneId,
    name,
    location: { locationId, locationType: 'station' as const, name },
    implants: [],
  }
}

describe('jump clone grouping', () => {
  it('groups clones by location in first-appearance order', () => {
    const groups = groupJumpClonesByLocation([
      stationClone(11, 60_000_001, 'Jita IV - Moon 4'),
      stationClone(12, 60_000_002, 'Amarr VIII'),
      stationClone(13, 60_000_001, 'Jita IV - Moon 4'),
    ])

    expect(groups.map((group) => group.label)).toEqual(['Jita IV - Moon 4', 'Amarr VIII'])
    expect(groups[0]?.clones.map((entry) => entry.jumpCloneId)).toEqual([11, 13])
  })

  it('labels an unresolved location by type without exposing its identifier', () => {
    const groups = groupJumpClonesByLocation([
      {
        jumpCloneId: 14,
        name: null,
        location: { locationId: 1_035_466_617_946, locationType: 'structure', name: null },
        implants: [],
      },
    ])

    expect(groups[0]?.label).toBe('Unknown structure')
    expect(groups[0]?.locationType).toBe('structure')
  })

  it('separates identical identifiers across location types', () => {
    const groups = groupJumpClonesByLocation([
      stationClone(15, 60_000_001, 'Station'),
      {
        jumpCloneId: 16,
        name: null,
        location: { locationId: 60_000_001, locationType: 'structure', name: null },
        implants: [],
      },
    ])

    expect(groups).toHaveLength(2)
  })
})
