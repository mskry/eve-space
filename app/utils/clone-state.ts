export type InferredCloneState = 'alpha'

interface SkillArchive {
  groups: ReadonlyArray<{
    skills: ReadonlyArray<{
      activeLevel: number
      trainedLevel: number
    }>
  }>
}

export function inferCloneState(skills: SkillArchive | undefined): InferredCloneState | undefined {
  for (const group of skills?.groups ?? []) {
    for (const skill of group.skills) {
      if (skill.activeLevel < skill.trainedLevel) return 'alpha'
    }
  }
  return undefined
}
