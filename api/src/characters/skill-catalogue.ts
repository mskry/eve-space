import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeGroups, sdeTypes } from '../db/schema.js'
import { skillCategoryId } from '../skills/training.js'

export interface SkillCatalogue {
  readonly groups: readonly {
    readonly groupId: number
    readonly name: string
    readonly skills: readonly { readonly typeId: number; readonly name: string }[]
  }[]
}

let skillCataloguePromise: Promise<SkillCatalogue> | undefined

export function getSkillCatalogue(): Promise<SkillCatalogue> {
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

  const groupsById = new Map<
    number,
    {
      groupId: number
      name: string
      skills: Array<{ typeId: number; name: string }>
    }
  >()
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

  return { groups: [...groupsById.values()] }
}
