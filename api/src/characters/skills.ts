import { createSkillsClient } from '@evespace/esi-client/domains/skills'
import type { GetCharactersCharacterIdSkillsOutput } from '@evespace/esi-client/schemas'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeGroups, sdeTypes } from '../db/schema.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiCachedResult, EsiResultMetadata } from '../esi-resilience/types.js'

export const characterSkillsScope = getCharacterEsiScope('skills')
export const skillCategoryId = 16

interface CharacterSkillSnapshot {
  typeId: number
  activeLevel: number
  trainedLevel: number
  skillpoints: number
}

export interface CharacterSkillsSnapshot {
  totalSp: number
  unallocatedSp: number
  skills: CharacterSkillSnapshot[]
}

interface SkillCatalogue {
  groups: Array<{
    groupId: number
    name: string
    skills: Array<{ typeId: number; name: string }>
  }>
}

let skillCataloguePromise: Promise<SkillCatalogue> | undefined

export async function getCharacterSkillsData(
  characterId: number,
): Promise<EsiCachedResult<CharacterSkillsSnapshot>> {
  return getEsiResilienceLayer().getCharacter({
    operation: 'skills',
    inputs: { characterId },
    load: async (authority, revalidation) => {
      const response = await createSkillsClient({
        fetch: createEsiTransport('skills', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .getSkills(characterId, revalidation)
      return { data: mapCharacterSkillsSnapshot(response.data), meta: response.meta }
    },
  })
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

export type CharacterSkills = CharacterSkillsData & EsiResultMetadata

export async function getCharacterSkills(characterId: number): Promise<CharacterSkills> {
  const [snapshot, catalogue] = await Promise.all([
    getCharacterSkillsData(characterId),
    getSkillCatalogue(),
  ])
  return {
    ...composeCharacterSkills(snapshot.data, catalogue),
    ...toEsiResultMetadata(snapshot),
  }
}

function mapCharacterSkillsSnapshot(
  result: GetCharactersCharacterIdSkillsOutput,
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

function getSkillCatalogue() {
  skillCataloguePromise ??= loadSkillCatalogue()
    .then((catalogue) => {
      if (catalogue.groups.length === 0) skillCataloguePromise = undefined
      return catalogue
    })
    .catch((error: unknown) => {
      skillCataloguePromise = undefined
      throw error
    })
  return skillCataloguePromise
}

async function loadSkillCatalogue(): Promise<SkillCatalogue> {
  const rows = await db
    .select({
      groupId: sdeGroups.groupId,
      groupName: sdeGroups.name,
      typeId: sdeTypes.typeId,
      typeName: sdeTypes.name,
    })
    .from(sdeGroups)
    .leftJoin(sdeTypes, and(eq(sdeTypes.groupId, sdeGroups.groupId), eq(sdeTypes.published, true)))
    .where(and(eq(sdeGroups.categoryId, skillCategoryId), eq(sdeGroups.published, true)))

  const groupsById = new Map<number, SkillCatalogue['groups'][number]>()
  const seenTypeIds = new Set<number>()
  for (const row of rows) {
    let group = groupsById.get(row.groupId)
    if (!group) {
      group = { groupId: row.groupId, name: row.groupName, skills: [] }
      groupsById.set(row.groupId, group)
    }
    if (row.typeId !== null && row.typeName !== null && !seenTypeIds.has(row.typeId)) {
      seenTypeIds.add(row.typeId)
      group.skills.push({ typeId: row.typeId, name: row.typeName })
    }
  }

  const groups = [...groupsById.values()]
  for (const group of groups) {
    group.skills.sort((left, right) =>
      compareNameAndId(left.name, left.typeId, right.name, right.typeId),
    )
  }
  groups.sort((left, right) => compareNameAndId(left.name, left.groupId, right.name, right.groupId))
  return { groups }
}

function composeCharacterSkills(
  snapshot: CharacterSkillsSnapshot,
  catalogue: SkillCatalogue,
): CharacterSkillsData {
  const progressByType = new Map(snapshot.skills.map((skill) => [skill.typeId, skill]))
  const catalogueTypeIds = new Set<number>()
  const groups: CharacterSkillsData['groups'] = catalogue.groups.map((catalogueGroup) => {
    let trainedSp = 0
    const skills = catalogueGroup.skills.map((catalogueSkill) => {
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
