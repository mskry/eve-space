import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeCategories, sdeGroups, sdeTypeDogmaAttributes, sdeTypes } from '../db/schema.js'
import {
  skillAttributeFromDogmaValue,
  skillCategoryId,
  skillPrimaryAttributeId,
  skillRankAttributeId,
  skillRankFromDogmaValue,
  skillSecondaryAttributeId,
  skillTrainingDogmaAttributeIds,
} from '../skills/training.js'
import type { SkillAttribute } from '../skills/training.js'
import { eveDescriptionToPlainText } from '../text/eve-description.js'
import type { ImplantBonusAttribute } from './implant-attributes.js'
import {
  implantBonusAttributes,
  implantDogmaAttributeIds,
  implantSlotAttributeId,
} from './implant-attributes.js'

const typeDetailDogmaAttributeIds = [
  ...skillTrainingDogmaAttributeIds,
  ...implantDogmaAttributeIds,
] as const

export interface UniverseTypeDetails {
  typeId: number
  name: string
  description: string | null
  group: { id: number; name: string }
  category: { id: number; name: string }
  detail:
    | {
        kind: 'skill'
        rank: number | null
        primaryAttribute: SkillAttribute | null
        secondaryAttribute: SkillAttribute | null
      }
    | {
        kind: 'implant'
        slot: number
        bonuses: Array<{ attribute: ImplantBonusAttribute; value: number }>
      }
    | null
}

interface TypeDetailRow {
  typeId: number
  typeName: string
  description: string | null
  typePublished: boolean
  groupId: number
  groupName: string
  groupPublished: boolean
  categoryId: number
  categoryName: string
  categoryPublished: boolean
  attributeId: number | null
  attributeValue: number | null
}

export async function getUniverseTypeDetails(typeId: number): Promise<UniverseTypeDetails | null> {
  const rows = await db
    .select({
      typeId: sdeTypes.typeId,
      typeName: sdeTypes.name,
      description: sdeTypes.description,
      typePublished: sdeTypes.published,
      groupId: sdeGroups.groupId,
      groupName: sdeGroups.name,
      groupPublished: sdeGroups.published,
      categoryId: sdeCategories.categoryId,
      categoryName: sdeCategories.name,
      categoryPublished: sdeCategories.published,
      attributeId: sdeTypeDogmaAttributes.attributeId,
      attributeValue: sdeTypeDogmaAttributes.value,
    })
    .from(sdeTypes)
    .innerJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
    .innerJoin(sdeCategories, eq(sdeCategories.categoryId, sdeGroups.categoryId))
    .leftJoin(
      sdeTypeDogmaAttributes,
      and(
        eq(sdeTypeDogmaAttributes.typeId, sdeTypes.typeId),
        inArray(sdeTypeDogmaAttributes.attributeId, [...typeDetailDogmaAttributeIds]),
      ),
    )
    .where(
      and(
        eq(sdeTypes.typeId, typeId),
        eq(sdeTypes.published, true),
        eq(sdeGroups.published, true),
        eq(sdeCategories.published, true),
      ),
    )
    .limit(typeDetailDogmaAttributeIds.length)

  return mapUniverseTypeDetails(rows)
}

function mapUniverseTypeDetails(rows: readonly TypeDetailRow[]): UniverseTypeDetails | null {
  const first = rows[0]
  if (!first || !isRepresentable(first)) return null
  if (rows.some((row) => !sameTypeIdentity(first, row))) return null

  const detail =
    first.categoryId === skillCategoryId ? mapSkillDetail(rows) : mapImplantDetail(rows)

  return {
    typeId: first.typeId,
    name: first.typeName,
    description: eveDescriptionToPlainText(first.description) ?? null,
    group: { id: first.groupId, name: first.groupName },
    category: { id: first.categoryId, name: first.categoryName },
    detail,
  }
}

function mapSkillDetail(rows: readonly TypeDetailRow[]) {
  const detail: Extract<NonNullable<UniverseTypeDetails['detail']>, { kind: 'skill' }> = {
    kind: 'skill',
    rank: null,
    primaryAttribute: null,
    secondaryAttribute: null,
  }
  for (const row of rows) {
    if (row.attributeId === skillRankAttributeId)
      detail.rank = skillRankFromDogmaValue(row.attributeValue)
    if (row.attributeId === skillPrimaryAttributeId)
      detail.primaryAttribute = skillAttributeFromDogmaValue(row.attributeValue)
    if (row.attributeId === skillSecondaryAttributeId)
      detail.secondaryAttribute = skillAttributeFromDogmaValue(row.attributeValue)
  }
  return detail
}

function mapImplantDetail(
  rows: readonly TypeDetailRow[],
): Extract<NonNullable<UniverseTypeDetails['detail']>, { kind: 'implant' }> | null {
  const values = new Map(rows.map((row) => [row.attributeId, row.attributeValue]))
  const slot = values.get(implantSlotAttributeId)
  if (slot === null || slot === undefined || !isPositiveSafeInteger(slot)) return null

  const bonuses = implantBonusAttributes.flatMap(([attributeId, attribute]) => {
    const value = values.get(attributeId)
    return value !== null && value !== undefined && Number.isFinite(value) && value !== 0
      ? [{ attribute, value }]
      : []
  })
  return { kind: 'implant', slot, bonuses }
}

function isRepresentable(row: TypeDetailRow) {
  return (
    row.typePublished &&
    row.groupPublished &&
    row.categoryPublished &&
    isPositiveSafeInteger(row.typeId) &&
    isPositiveSafeInteger(row.groupId) &&
    isPositiveSafeInteger(row.categoryId) &&
    row.typeName.length > 0 &&
    row.groupName.length > 0 &&
    row.categoryName.length > 0
  )
}

function sameTypeIdentity(left: TypeDetailRow, right: TypeDetailRow) {
  return (
    left.typeId === right.typeId &&
    left.typeName === right.typeName &&
    left.description === right.description &&
    left.typePublished === right.typePublished &&
    left.groupId === right.groupId &&
    left.groupName === right.groupName &&
    left.groupPublished === right.groupPublished &&
    left.categoryId === right.categoryId &&
    left.categoryName === right.categoryName &&
    left.categoryPublished === right.categoryPublished
  )
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}
