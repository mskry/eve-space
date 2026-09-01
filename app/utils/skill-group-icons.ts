export const skillGroupIconNames = [
  'armor',
  'shields',
  'rigging',
  'subsystems',
  'gunnery',
  'missiles',
  'drones',
  'targeting',
  'electronic-systems',
  'engineering',
  'navigation',
  'scanning',
  'spaceship-command',
  'fleet-support',
  'science',
  'production',
  'resource-processing',
  'trade',
  'planet-management',
  'structure-management',
  'social',
  'corporation-management',
  'neural-enhancement',
] as const

export type SkillGroupIcon = (typeof skillGroupIconNames)[number] | 'unknown'

const iconNames: ReadonlySet<string> = new Set(skillGroupIconNames)

/**
 * Skill group IDs are stable but the catalogue only carries SDE group names through to the chips,
 * so the glyph is keyed by the slugged name and unrecognised groups fall back rather than vanish.
 */
export function skillGroupIcon(groupName: string): SkillGroupIcon {
  const slug = groupName.trim().toLowerCase().replaceAll(/\s+/g, '-')
  return iconNames.has(slug) ? (slug as SkillGroupIcon) : 'unknown'
}
