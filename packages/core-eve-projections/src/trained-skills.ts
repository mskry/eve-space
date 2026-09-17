import type { SkillAttribute } from './skill-training.js'

export interface TrainedSkillSnapshot {
  readonly typeId: number
  readonly activeLevel: number
  readonly trainedLevel: number
  readonly skillpoints: number
}

export interface TrainedSkillsSnapshot {
  readonly totalSp: number
  readonly unallocatedSp: number
  readonly skills: readonly TrainedSkillSnapshot[]
}

export interface SkillProjectionCatalogue {
  readonly groups: readonly {
    readonly groupId: number
    readonly name: string
    readonly skills: readonly {
      readonly typeId: number
      readonly name: string
      readonly rank: number | null
      readonly primaryAttribute: SkillAttribute | null
      readonly secondaryAttribute: SkillAttribute | null
    }[]
  }[]
}

export interface ProjectedTrainedSkills {
  readonly totalSp: number
  readonly unallocatedSp: number
  readonly injectedSkillCount: number
  readonly groups: Array<{
    groupId: number | null
    name: string
    trainedSp: number
    skills: Array<{
      typeId: number
      name: string
      injected: boolean
      activeLevel: number
      trainedLevel: number
      skillpoints: number
      rank: number | null
      primaryAttribute: SkillAttribute | null
      secondaryAttribute: SkillAttribute | null
    }>
  }>
}

export function projectTrainedSkills(
  snapshot: TrainedSkillsSnapshot,
  catalogue: SkillProjectionCatalogue,
): ProjectedTrainedSkills {
  const progressByType = new Map(snapshot.skills.map((skill) => [skill.typeId, skill]))
  const catalogueTypeIds = new Set<number>()
  const groups: ProjectedTrainedSkills['groups'] = catalogue.groups.map((catalogueGroup) => {
    let trainedSp = 0
    const skills = catalogueGroup.skills
      .map((catalogueSkill) => {
        catalogueTypeIds.add(catalogueSkill.typeId)
        const progress = progressByType.get(catalogueSkill.typeId)
        trainedSp += progress?.skillpoints ?? 0
        return {
          ...catalogueSkill,
          injected: progress !== undefined,
          activeLevel: progress?.activeLevel ?? 0,
          trainedLevel: progress?.trainedLevel ?? 0,
          skillpoints: progress?.skillpoints ?? 0,
        }
      })
      .toSorted((left, right) => compareNameAndId(left.name, left.typeId, right.name, right.typeId))
    return { groupId: catalogueGroup.groupId, name: catalogueGroup.name, trainedSp, skills }
  })

  const unmatchedSkills = snapshot.skills.filter((skill) => !catalogueTypeIds.has(skill.typeId))
  if (unmatchedSkills.length > 0)
    groups.push({
      groupId: null,
      name: 'Unknown',
      trainedSp: unmatchedSkills.reduce((total, skill) => total + skill.skillpoints, 0),
      skills: unmatchedSkills
        .map((skill) => ({
          typeId: skill.typeId,
          name: `Unknown skill ${skill.typeId}`,
          injected: true,
          activeLevel: skill.activeLevel,
          trainedLevel: skill.trainedLevel,
          skillpoints: skill.skillpoints,
          rank: null,
          primaryAttribute: null,
          secondaryAttribute: null,
        }))
        .toSorted((left, right) =>
          compareNameAndId(left.name, left.typeId, right.name, right.typeId),
        ),
    })

  groups.sort((left, right) =>
    compareNameAndId(left.name, left.groupId ?? -1, right.name, right.groupId ?? -1),
  )
  return {
    totalSp: snapshot.totalSp,
    unallocatedSp: snapshot.unallocatedSp,
    injectedSkillCount: snapshot.skills.length,
    groups,
  }
}

function compareNameAndId(leftName: string, leftId: number, rightName: string, rightId: number) {
  if (leftName < rightName) return -1
  if (leftName > rightName) return 1
  return leftId - rightId
}
