import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdSkillsResponse } from '@evespace/esi-client/types'
import { projectTrainedSkills } from '@eve-space/core-eve-projections/trained-skills'
import { z } from 'zod'
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

const characterSkillsCacheSchema = z.object({
  skills: z.array(
    z.object({
      typeId: z.number(),
      activeLevel: z.number(),
      trainedLevel: z.number(),
      skillpoints: z.number(),
    }),
  ),
  totalSp: z.number(),
  unallocatedSp: z.number(),
})

const characterSkillsRead = createCharacterEsiRead({
  cacheSchema: characterSkillsCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: CharacterSkillsRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterSkillsSnapshot(response.data),
  name: 'character-skills-core',
  operation: 'skills',
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
    skills: result.skills.map((skill) => ({
      typeId: skill.skill_id,
      activeLevel: skill.active_skill_level,
      trainedLevel: skill.trained_skill_level,
      skillpoints: skill.skillpoints_in_skill,
    })),
    totalSp: result.total_sp,
    unallocatedSp: result.unallocated_sp ?? 0,
  }
}

function composeCharacterSkills(
  snapshot: CharacterSkillsSnapshot,
  catalogue: SkillCatalogue,
): CharacterSkillsData {
  const projected = projectTrainedSkills(snapshot, {
    groups: catalogue.groups.map((group) => ({
      ...group,
      skills: group.skills.map((skill) => ({
        ...skill,
        primaryAttribute: null,
        rank: null,
        secondaryAttribute: null,
      })),
    })),
  })
  return {
    groups: projected.groups.map((group) => ({
      groupId: group.groupId,
      name: group.name,
      trainedSp: group.trainedSp,
      skills: group.skills.map((skill) => ({
        typeId: skill.typeId,
        name: skill.name,
        injected: skill.injected,
        activeLevel: skill.activeLevel,
        trainedLevel: skill.trainedLevel,
        skillpoints: skill.skillpoints,
      })),
    })),
    injectedSkillCount: projected.injectedSkillCount,
    totalSp: projected.totalSp,
    unallocatedSp: projected.unallocatedSp,
  }
}
