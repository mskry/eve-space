export const infomorphPsychologyTypeId = 24_242
export const advancedInfomorphPsychologyTypeId = 33_407
export const implantSlotCount = 10
export const attributeImplantSlotCount = 5

export interface JumpCloneCapacity {
  installed: number
  maximum: number | null
}

interface SkillArchive {
  groups: ReadonlyArray<{
    skills: ReadonlyArray<{
      typeId: number
      trainedLevel?: number
      activeLevel?: number
    }>
  }>
}

interface SlottedImplant {
  slot?: number | null
}

export interface ImplantRackEntry<Implant extends SlottedImplant> {
  slot: number
  implant: Implant | null
}

export interface ImplantRack<Implant extends SlottedImplant> {
  attributes: ImplantRackEntry<Implant>[]
  hardwirings: ImplantRackEntry<Implant>[]
  unslotted: Implant[]
  filledSlots: number
  emptySlots: number
}

// Alpha caps do not remove installed clones, so capacity follows the trained rather than active level.
export function deriveJumpCloneCapacity(
  installed: number,
  skills: SkillArchive | undefined,
): JumpCloneCapacity {
  if (!skills) return { installed, maximum: null }

  let maximum = 0
  for (const group of skills.groups) {
    for (const skill of group.skills) {
      if (
        skill.typeId === infomorphPsychologyTypeId ||
        skill.typeId === advancedInfomorphPsychologyTypeId
      )
        maximum += skill.trainedLevel ?? skill.activeLevel ?? 0
    }
  }
  return { installed, maximum: maximum < installed ? null : maximum }
}

export function toImplantRack<Implant extends SlottedImplant>(
  implants: ReadonlyArray<Implant> | undefined,
): ImplantRack<Implant> {
  const bySlot = new Map<number, Implant>()
  const unslotted: Implant[] = []
  for (const implant of implants ?? []) {
    const slot = implant.slot
    if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= implantSlotCount)
      bySlot.set(slot, implant)
    else unslotted.push(implant)
  }

  const entries = Array.from({ length: implantSlotCount }, (_unused, index) => ({
    slot: index + 1,
    implant: bySlot.get(index + 1) ?? null,
  }))

  return {
    attributes: entries.slice(0, attributeImplantSlotCount),
    hardwirings: entries.slice(attributeImplantSlotCount),
    unslotted,
    filledSlots: bySlot.size,
    emptySlots: implantSlotCount - bySlot.size,
  }
}

interface CloneLocation {
  locationId: number
  locationType: 'station' | 'structure'
  name: string | null
}

interface LocatedClone {
  location: CloneLocation
}

export interface JumpCloneLocationGroup<Clone extends LocatedClone> {
  key: string
  label: string
  locationType: CloneLocation['locationType']
  clones: Clone[]
}

export function jumpCloneLocationLabel(location: CloneLocation) {
  if (location.name) return location.name
  return `${location.locationType === 'station' ? 'Station' : 'Structure'} ${location.locationId}`
}

// ESI provides no meaningful clone order, so location groups retain first appearance.
export function groupJumpClonesByLocation<Clone extends LocatedClone>(
  jumpClones: ReadonlyArray<Clone> | undefined,
): JumpCloneLocationGroup<Clone>[] {
  const groups = new Map<string, JumpCloneLocationGroup<Clone>>()
  for (const clone of jumpClones ?? []) {
    const key = `${clone.location.locationType}:${clone.location.locationId}`
    const group = groups.get(key) ?? {
      key,
      label: jumpCloneLocationLabel(clone.location),
      locationType: clone.location.locationType,
      clones: [],
    }
    group.clones.push(clone)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export type ImplantBonusAttribute =
  | 'charisma'
  | 'intelligence'
  | 'memory'
  | 'perception'
  | 'willpower'

const attributeAbbreviations: Record<ImplantBonusAttribute, string> = {
  charisma: 'CHA',
  intelligence: 'INT',
  memory: 'MEM',
  perception: 'PER',
  willpower: 'WIL',
}

export function attributeAbbreviation(attribute: string) {
  return (
    attributeAbbreviations[attribute as ImplantBonusAttribute] ??
    attribute.slice(0, 3).toUpperCase()
  )
}

export function formatAttributeBonus(bonus: { attribute: string; value: number }) {
  return `${bonus.value > 0 ? '+' : ''}${bonus.value} ${attributeAbbreviation(bonus.attribute)}`
}

export function formatImplantSlot(slot: number | null | undefined) {
  return typeof slot === 'number' && Number.isInteger(slot) ? String(slot).padStart(2, '0') : ''
}
