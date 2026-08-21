import { createSkillsClient } from '@evespace/esi-client/domains/skills'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db/client.js'
import { sdeGroups, sdeTypes } from './db/schema.js'
import { esiFetch } from './esi-fetch.js'
import { getCharacterAccessToken } from './token-service.js'

export const characterSkillsScope = 'esi-skills.read_skills.v1'

export interface CharacterSkills {
  totalSp: number
  unallocatedSp: number
  groups: Array<{
    groupId: number | null
    name: string
    trainedSp: number
    skills: Array<{
      typeId: number
      name: string
      activeLevel: number
      trainedLevel: number
      skillpoints: number
    }>
  }>
}

export async function getCharacterSkills(characterId: number): Promise<CharacterSkills> {
  const accessToken = await getCharacterAccessToken(characterId, characterSkillsScope)
  const skills = createSkillsClient({ fetch: esiFetch, token: accessToken })
  const result = await skills.getSkills(characterId)

  if (result.skills.length === 0) {
    return {
      totalSp: result.total_sp,
      unallocatedSp: result.unallocated_sp ?? 0,
      groups: [],
    }
  }

  const typeIds = [...new Set(result.skills.map((skill) => skill.skill_id))]
  const staticRows = await db
    .select({
      typeId: sdeTypes.typeId,
      typeName: sdeTypes.name,
      groupId: sdeGroups.groupId,
      groupName: sdeGroups.name,
    })
    .from(sdeTypes)
    .innerJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
    .where(
      and(
        inArray(sdeTypes.typeId, typeIds),
        eq(sdeTypes.published, true),
        eq(sdeGroups.published, true),
      ),
    )

  const staticByType = new Map(staticRows.map((row) => [row.typeId, row]))
  const grouped = new Map<number | null, CharacterSkills['groups'][number]>()

  for (const skill of result.skills) {
    const staticSkill = staticByType.get(skill.skill_id)
    const groupId = staticSkill?.groupId ?? null
    let group = grouped.get(groupId)
    if (!group) {
      group = {
        groupId,
        name: staticSkill?.groupName ?? 'Unknown',
        trainedSp: 0,
        skills: [],
      }
      grouped.set(groupId, group)
    }

    group.trainedSp += skill.skillpoints_in_skill
    group.skills.push({
      typeId: skill.skill_id,
      name: staticSkill?.typeName ?? `Unknown skill ${skill.skill_id}`,
      activeLevel: skill.active_skill_level,
      trainedLevel: skill.trained_skill_level,
      skillpoints: skill.skillpoints_in_skill,
    })
  }

  const groups = [...grouped.values()]
  for (const group of groups) {
    group.skills.sort((left, right) =>
      compareNameAndId(left.name, left.typeId, right.name, right.typeId),
    )
  }
  groups.sort((left, right) =>
    compareNameAndId(left.name, left.groupId ?? -1, right.name, right.groupId ?? -1),
  )

  return {
    totalSp: result.total_sp,
    unallocatedSp: result.unallocated_sp ?? 0,
    groups,
  }
}

function compareNameAndId(leftName: string, leftId: number, rightName: string, rightId: number) {
  if (leftName < rightName) return -1
  if (leftName > rightName) return 1
  return leftId - rightId
}
