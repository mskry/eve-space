export const skillCategoryId = 16
export const skillPrimaryAttributeId = 180
export const skillSecondaryAttributeId = 181
export const skillRankAttributeId = 275
export const skillTrainingDogmaAttributeIds = [
  skillPrimaryAttributeId,
  skillSecondaryAttributeId,
  skillRankAttributeId,
] as const

export type SkillAttribute = 'charisma' | 'intelligence' | 'memory' | 'perception' | 'willpower'

const skillAttributes = new Map<number, SkillAttribute>([
  [164, 'charisma'],
  [165, 'intelligence'],
  [166, 'memory'],
  [167, 'perception'],
  [168, 'willpower'],
])

export function skillAttributeFromDogmaValue(value: number | null | undefined) {
  return value === null || value === undefined ? null : (skillAttributes.get(value) ?? null)
}

export function skillRankFromDogmaValue(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null
}
