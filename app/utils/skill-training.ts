export type SkillLevel = 1 | 2 | 3 | 4 | 5

export function skillPointsRequiredForLevel(skillRank: number, skillLevel: SkillLevel) {
  return Math.floor(2 ** (2.5 * (skillLevel - 1)) * 250 * skillRank)
}

export function skillPointsPerMinute(primaryAttribute: number, secondaryAttribute: number) {
  return primaryAttribute + secondaryAttribute / 2
}
