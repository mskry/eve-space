import type {
  PublishedTypeDetail,
  PublishedTypeDetailsRequest,
  PublishedTypeDetailsResult,
} from '@eve-space/core-data-contract'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import { executeUniverseQuery, runBoundedReadTransaction } from '../universe/database-read.js'
import {
  boundedPositiveIds,
  CoreDataProductUnavailableError,
  nonemptyString,
  nullableNonnegativeFinite,
  positiveSafeInteger,
  selectCoreDataRevision,
} from './sde-product-adapter.js'

const maximumTypeIds = 500

interface PublishedTypeDetailRow extends postgres.Row {
  type_id: string
  type_name: string
  group_id: string
  group_name: string
  category_id: string
  category_name: string
  packaged_volume: number | null
}

export function loadPublishedTypeDetailsProduct(
  request: PublishedTypeDetailsRequest,
  database: postgres.Sql = sql,
): Promise<PublishedTypeDetailsResult> {
  const typeIds = boundedPositiveIds(request, 'typeIds', 'Published type-detail', maximumTypeIds)
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Published type-detail database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`
          lock table
            sde_projection_state,
            sde_builds,
            sde_categories,
            sde_groups,
            sde_types
          in access share mode
        `,
        signal,
      )
      const revision = await selectCoreDataRevision(transaction, signal)
      const sourceRows =
        typeIds.length === 0 ? [] : await selectPublishedTypeDetails(transaction, signal, typeIds)
      return { complete: true, revision, rows: sourceRows.map(mapPublishedTypeDetail) }
    },
  )
}

async function selectPublishedTypeDetails(
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  typeIds: readonly number[],
) {
  return executeUniverseQuery(
    transaction<PublishedTypeDetailRow[]>`
      select
        types.type_id::text as type_id,
        types.name as type_name,
        groups.group_id::text as group_id,
        groups.name as group_name,
        categories.category_id::text as category_id,
        categories.name as category_name,
        types.volume as packaged_volume
      from sde_types as types
      inner join sde_groups as groups on groups.group_id = types.group_id
      inner join sde_categories as categories on categories.category_id = groups.category_id
      where types.type_id = any(${transaction.array([...typeIds], 20)})
        and types.published = true
        and groups.published = true
        and categories.published = true
      order by types.type_id
      limit ${maximumTypeIds}
    `,
    signal,
  )
}

function mapPublishedTypeDetail(row: PublishedTypeDetailRow): PublishedTypeDetail {
  return {
    categoryId: positiveSafeInteger(row.category_id, 'type-detail category ID'),
    categoryName: nonemptyString(row.category_name, 'type-detail category name'),
    groupId: positiveSafeInteger(row.group_id, 'type-detail group ID'),
    groupName: nonemptyString(row.group_name, 'type-detail group name'),
    packagedVolume: nullableNonnegativeFinite(row.packaged_volume, 'type-detail packaged volume'),
    typeId: positiveSafeInteger(row.type_id, 'type-detail type ID'),
    typeName: nonemptyString(row.type_name, 'type-detail type name'),
  }
}
