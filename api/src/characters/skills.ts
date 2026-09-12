import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdSkillsResponse } from '@evespace/esi-client/types'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResult,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { getSkillCatalogue, type SkillCatalogue } from './skill-catalogue.js'

interface CharacterSkillsRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const characterSkillsRead = createCharacterEsiRead({
  operation: 'skills',
  name: 'character-skills-core',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: CharacterSkillsRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterSkillsSnapshot(response.data),
})

export const characterSkillsScope = characterSkillsRead.requiredScope

interface CharacterSkillSnapshot {
  typeId: number
  activeLevel: number
  trainedLevel: number
  skillpoints: number
}

interface CharacterSkillsSnapshot {
  totalSp: number
  unallocatedSp: number
  skills: CharacterSkillSnapshot[]
}

interface CharacterSkillsData {
  totalSp: number
  unallocatedSp: number
  injectedSkillCount: number
  groups: Array<{
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
    }>
  }>
}

type CharacterSkills = CharacterSkillsData & EsiReadResultMetadata

interface CharacterSkillsSummaryData {
  totalSp: number
  unallocatedSp: number
}

export type CharacterSkillsSummary = CharacterSkillsSummaryData & EsiReadResultMetadata

export async function getCharacterSkills(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterSkills> {
  const [snapshot, catalogue] = await Promise.all([
    getCharacterSkillsSnapshot(characterId, subjectLifecycleId),
    getSkillCatalogue(),
  ])
  return {
    ...composeCharacterSkills(snapshot.data, catalogue),
    ...toEsiReadResultMetadata(snapshot),
  }
}

export async function getCharacterSkillsSummary(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterSkillsSummary> {
  const skills = await getCharacterSkillsSnapshot(characterId, subjectLifecycleId)
  return {
    totalSp: skills.data.totalSp,
    unallocatedSp: skills.data.unallocatedSp,
    ...toEsiReadResultMetadata(skills),
  }
}

async function getCharacterSkillsSnapshot(
  characterId: number,
  subjectLifecycleId: string,
): Promise<EsiReadResult<CharacterSkillsSnapshot>> {
  return characterSkillsRead.execute({ characterId, subjectLifecycleId })
}

function mapCharacterSkillsSnapshot(
  result: GetCharactersCharacterIdSkillsResponse,
): CharacterSkillsSnapshot {
  return {
    totalSp: result.total_sp,
    unallocatedSp: result.unallocated_sp ?? 0,
    skills: result.skills.map((skill) => ({
      typeId: skill.skill_id,
      activeLevel: skill.active_skill_level,
      trainedLevel: skill.trained_skill_level,
      skillpoints: skill.skillpoints_in_skill,
    })),
  }
}

function composeCharacterSkills(
  snapshot: CharacterSkillsSnapshot,
  catalogue: SkillCatalogue,
): CharacterSkillsData {
  const progressByType = new Map(snapshot.skills.map((skill) => [skill.typeId, skill]))
  const catalogueTypeIds = new Set<number>()
  const groups: CharacterSkillsData['groups'] = catalogue.groups.map((catalogueGroup) => {
    let trainedSp = 0
    const skills = catalogueGroup.skills
      .map((catalogueSkill) => {
        catalogueTypeIds.add(catalogueSkill.typeId)
        const progress = progressByType.get(catalogueSkill.typeId)
        trainedSp += progress?.skillpoints ?? 0
        return {
          typeId: catalogueSkill.typeId,
          name: catalogueSkill.name,
          injected: progress !== undefined,
          activeLevel: progress?.activeLevel ?? 0,
          trainedLevel: progress?.trainedLevel ?? 0,
          skillpoints: progress?.skillpoints ?? 0,
        }
      })
      .toSorted((left, right) => compareNameAndId(left.name, left.typeId, right.name, right.typeId))
    return {
      groupId: catalogueGroup.groupId,
      name: catalogueGroup.name,
      trainedSp,
      skills,
    }
  })

  const unmatchedSkills = snapshot.skills.filter((skill) => !catalogueTypeIds.has(skill.typeId))
  if (unmatchedSkills.length > 0) {
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
        }))
        .toSorted((left, right) =>
          compareNameAndId(left.name, left.typeId, right.name, right.typeId),
        ),
    })
  }

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
