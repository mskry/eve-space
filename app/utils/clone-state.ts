export type InferredCloneState = 'alpha' | 'omega'

interface SkillArchive {
  groups: ReadonlyArray<{
    skills: ReadonlyArray<{
      activeLevel: number
      trainedLevel: number
    }>
  }>
}

export function inferCloneState(skills: SkillArchive | undefined): InferredCloneState | undefined {
  let hasSkills = false
  for (const group of skills?.groups ?? []) {
    for (const skill of group.skills) {
      hasSkills = true
      if (skill.activeLevel < skill.trainedLevel) return 'alpha'
    }
  }
  return hasSkills ? 'omega' : undefined
}
