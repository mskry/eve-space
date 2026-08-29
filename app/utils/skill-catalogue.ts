export type SkillLevelFilter = 'all' | 'partial' | 'v'

export interface CatalogueGroup {
  groupId: number | null
  name: string
  skills: ReadonlyArray<{
    typeId: number
    name: string
    activeLevel: number
    trainedLevel: number
    skillpoints: number
  }>
}

export interface IndexedSkill {
  typeId: number
  name: string
  skillpoints: number
  activeLevel: number
  trainedLevel: number
  groupKey: string
  groupName: string
}

export interface GroupSummary {
  key: string
  name: string
  groupId: number | null
  count: number
}

export function groupKeyOf(groupId: number | null) {
  return String(groupId ?? 'unknown')
}

export function indexSkills(groups: readonly CatalogueGroup[]): IndexedSkill[] {
  return groups.flatMap((group) =>
    group.skills.map((skill) => ({
      typeId: skill.typeId,
      name: skill.name,
      skillpoints: skill.skillpoints,
      activeLevel: skill.activeLevel,
      trainedLevel: skill.trainedLevel,
      groupKey: groupKeyOf(group.groupId),
      groupName: group.name,
    })),
  )
}

export function passesLevelFilter(skill: IndexedSkill, filter: SkillLevelFilter) {
  if (filter === 'v') return skill.trainedLevel === 5
  if (filter === 'partial') return skill.trainedLevel < 5
  return true
}

export interface SearchMatches {
  skillIds: ReadonlySet<number>
  groupKeys: ReadonlySet<string>
}

export function selectVisibleSkills(
  indexed: readonly IndexedSkill[],
  filter: SkillLevelFilter,
  matches: SearchMatches | null,
): IndexedSkill[] {
  return indexed.filter(
    (skill) =>
      passesLevelFilter(skill, filter) &&
      (matches === null ||
        matches.skillIds.has(skill.typeId) ||
        matches.groupKeys.has(skill.groupKey)),
  )
}

export function summariseGroups(
  groups: readonly CatalogueGroup[],
  visible: readonly IndexedSkill[],
): GroupSummary[] {
  const counts = new Map<string, number>()
  for (const skill of visible) counts.set(skill.groupKey, (counts.get(skill.groupKey) ?? 0) + 1)
  return groups.map((group) => {
    const key = groupKeyOf(group.groupId)
    return { key, name: group.name, groupId: group.groupId, count: counts.get(key) ?? 0 }
  })
}

/**
 * Selection survives unrelated interaction, falls back to the first group with matches when the
 * selected group empties, and yields to search results.
 */
export function resolveActiveGroupKey(
  summaries: readonly GroupSummary[],
  selectedKey: string | null,
  searching: boolean,
): string | null {
  if (searching) return null
  const selected = summaries.find((group) => group.key === selectedKey)
  if (selected && selected.count > 0) return selected.key
  return summaries.find((group) => group.count > 0)?.key ?? null
}

export interface LevelCell {
  level: number
  active: boolean
  trained: boolean
  queued: boolean
}

export function levelCells(skill: IndexedSkill, queuedTarget: number): LevelCell[] {
  return [1, 2, 3, 4, 5].map((level) => ({
    level,
    active: level <= skill.activeLevel,
    trained: level > skill.activeLevel && level <= skill.trainedLevel,
    queued: level > skill.trainedLevel && level <= queuedTarget,
  }))
}

export function levelDescription(skill: IndexedSkill, queuedTarget: number) {
  const base = `Active level ${skill.activeLevel}; trained level ${skill.trainedLevel} of 5`
  return queuedTarget > skill.trainedLevel ? `${base}; queued to level ${queuedTarget}` : base
}
