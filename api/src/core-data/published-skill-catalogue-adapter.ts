import type {
  PublishedSkillCatalogueRecord,
  PublishedSkillCatalogueResult,
} from '@eve-space/core-data-contract'
import {
  skillAttributeFromDogmaValue,
  skillCategoryId,
  skillPrimaryAttributeId,
  skillRankAttributeId,
  skillRankFromDogmaValue,
  skillSecondaryAttributeId,
} from '@eve-space/core-eve-projections/skill-training'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import { executeUniverseQuery, runBoundedReadTransaction } from '../universe/database-read.js'
import {
  CoreDataProductUnavailableError,
  nonemptyString,
  positiveSafeInteger,
  selectCoreDataRevision,
} from './sde-product-adapter.js'

const maximumPublishedSkills = 10_000

interface PublishedSkillRow extends postgres.Row {
  type_id: string
  type_name: string
  group_id: string
  group_name: string
  rank: number | null
  primary_attribute: number | null
  secondary_attribute: number | null
}

export function loadPublishedSkillCatalogueProduct(
  _request: Record<never, never> = {},
  database: postgres.Sql = sql,
): Promise<PublishedSkillCatalogueResult> {
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Published skill catalogue database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`
          lock table
            sde_projection_state,
            sde_builds,
            sde_categories,
            sde_groups,
            sde_types,
            sde_type_dogma_attributes
          in access share mode
        `,
        signal,
      )
      const revision = await selectCoreDataRevision(transaction, signal)
      const sourceRows = await executeUniverseQuery(
        transaction<PublishedSkillRow[]>`
          select
            types.type_id::text as type_id,
            types.name as type_name,
            groups.group_id::text as group_id,
            groups.name as group_name,
            max(dogma.value) filter (where dogma.attribute_id = ${skillRankAttributeId}) as rank,
            max(dogma.value) filter (where dogma.attribute_id = ${skillPrimaryAttributeId}) as primary_attribute,
            max(dogma.value) filter (where dogma.attribute_id = ${skillSecondaryAttributeId}) as secondary_attribute
          from sde_types as types
          inner join sde_groups as groups on groups.group_id = types.group_id
          inner join sde_categories as categories on categories.category_id = groups.category_id
          left join sde_type_dogma_attributes as dogma
            on dogma.type_id = types.type_id
            and dogma.attribute_id = any(${transaction.array(
              [skillRankAttributeId, skillPrimaryAttributeId, skillSecondaryAttributeId],
              20,
            )})
          where categories.category_id = ${skillCategoryId}
            and categories.published = true
            and groups.published = true
            and types.published = true
          group by types.type_id, types.name, groups.group_id, groups.name
          order by groups.name, types.name, groups.group_id, types.type_id
          limit ${maximumPublishedSkills + 1}
        `,
        signal,
      )
      if (sourceRows.length > maximumPublishedSkills)
        throw new CoreDataProductUnavailableError('Published skill catalogue exceeds its bound')
      const rows = sourceRows.map(mapPublishedSkill)
      return { rows, revision, complete: true }
    },
  )
}

function mapPublishedSkill(row: PublishedSkillRow): PublishedSkillCatalogueRecord {
  return {
    typeId: positiveSafeInteger(row.type_id, 'skill type ID'),
    typeName: nonemptyString(row.type_name, 'skill type name'),
    groupId: positiveSafeInteger(row.group_id, 'skill group ID'),
    groupName: nonemptyString(row.group_name, 'skill group name'),
    rank: skillRankFromDogmaValue(row.rank),
    primaryAttribute: skillAttributeFromDogmaValue(row.primary_attribute),
    secondaryAttribute: skillAttributeFromDogmaValue(row.secondary_attribute),
  }
}
