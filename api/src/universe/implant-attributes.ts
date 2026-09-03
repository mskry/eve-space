export const implantSlotAttributeId = 331

export const implantBonusAttributes = [
  [175, 'charisma'],
  [176, 'intelligence'],
  [177, 'memory'],
  [178, 'perception'],
  [179, 'willpower'],
] as const

export type ImplantBonusAttribute = (typeof implantBonusAttributes)[number][1]

export interface ImplantBonus {
  attribute: ImplantBonusAttribute
  value: number
}

export const implantDogmaAttributeIds = [
  ...implantBonusAttributes.map(([attributeId]) => attributeId),
  implantSlotAttributeId,
] as const

export function implantBonusAttributeFor(attributeId: number): ImplantBonusAttribute | null {
  return implantBonusAttributes.find(([id]) => id === attributeId)?.[1] ?? null
}

export function isImplantBonusValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value !== 0
}

export function isImplantSlot(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0
}
