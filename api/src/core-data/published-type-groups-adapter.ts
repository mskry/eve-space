import type {
  PublishedTypeGroup,
  PublishedTypeGroupsRequest,
  PublishedTypeGroupsResult,
} from '@eve-space/core-data-contract'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import { executeUniverseQuery, runBoundedReadTransaction } from '../universe/database-read.js'
import {
  boundedPositiveIds,
  CoreDataProductUnavailableError,
  nonemptyString,
  positiveSafeInteger,
  selectCoreDataRevision,
} from './sde-product-adapter.js'

const maximumTypeIds = 500

interface PublishedTypeGroupRow extends postgres.Row {
  type_id: string
  type_name: string
  group_id: string
  group_name: string
}

export function loadPublishedTypeGroupsProduct(
  request: PublishedTypeGroupsRequest,
  database: postgres.Sql = sql,
): Promise<PublishedTypeGroupsResult> {
  const uniqueTypeIds = boundedPositiveIds(
    request,
    'typeIds',
    'Published type-group',
    maximumTypeIds,
  )
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Published type-group database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`
          lock table sde_projection_state, sde_builds, sde_types, sde_groups in access share mode
        `,
        signal,
      )
      const revision = await selectCoreDataRevision(transaction, signal)
      const rows =
        uniqueTypeIds.length === 0
          ? []
          : await selectPublishedTypeGroups(transaction, signal, uniqueTypeIds)
      return { complete: true, revision, rows }
    },
  )
}

async function selectPublishedTypeGroups(
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  typeIds: readonly number[],
): Promise<PublishedTypeGroup[]> {
  const rows = await executeUniverseQuery(
    transaction<PublishedTypeGroupRow[]>`
      select
        types.type_id::text as type_id,
        types.name as type_name,
        groups.group_id::text as group_id,
        groups.name as group_name
      from sde_types as types
      inner join sde_groups as groups on groups.group_id = types.group_id
      where types.type_id = any(${transaction.array([...typeIds], 20)})
        and types.published = true
        and groups.published = true
      order by types.type_id
      limit ${maximumTypeIds}
    `,
    signal,
  )
  return rows.map((row) => ({
    groupId: positiveSafeInteger(row.group_id, 'group ID'),
    groupName: nonemptyString(row.group_name, 'group name'),
    typeId: positiveSafeInteger(row.type_id, 'type ID'),
    typeName: nonemptyString(row.type_name, 'type name'),
  }))
}
