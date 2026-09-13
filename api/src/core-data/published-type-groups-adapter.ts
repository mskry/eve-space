import type {
  PublishedTypeGroup,
  PublishedTypeGroupsRequest,
  PublishedTypeGroupsResult,
  SdeProjectionRevision,
} from '@eve-space/core-data-contract'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import { executeUniverseQuery, runBoundedReadTransaction } from '../universe/database-read.js'

const maximumTypeIds = 500

interface RevisionRow extends postgres.Row {
  build_number: string
  ingest_version: number
  ingested_at: string
}

interface PublishedTypeGroupRow extends postgres.Row {
  type_id: string
  type_name: string
  group_id: string
  group_name: string
}

class CoreDataProductUnavailableError extends Error {
  constructor(message = 'Core data product is unavailable') {
    super(message)
    this.name = 'CoreDataProductUnavailableError'
  }
}

export function loadPublishedTypeGroupsProduct(
  request: PublishedTypeGroupsRequest,
  database: postgres.Sql = sql,
): Promise<PublishedTypeGroupsResult> {
  const typeIds = request?.typeIds
  if (!Array.isArray(typeIds))
    throw new TypeError('Published type-group request must contain a typeIds array')
  if (typeIds.length > maximumTypeIds)
    throw new RangeError(`Published type-group lookup cannot exceed ${maximumTypeIds} IDs`)
  for (const index of typeIds.keys())
    if (!isPositiveSafeInteger(typeIds[index]))
      throw new TypeError('Published type-group IDs must be positive safe integers')

  const uniqueTypeIds = [...new Set(typeIds)]
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Published type-group database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`lock table sde_builds, sde_types, sde_groups in access share mode`,
        signal,
      )
      const revision = await selectLatestRevision(transaction, signal)
      const rows =
        uniqueTypeIds.length === 0
          ? []
          : await selectPublishedTypeGroups(transaction, signal, uniqueTypeIds)
      return { rows, revision, complete: true }
    },
  )
}

async function selectLatestRevision(
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
): Promise<SdeProjectionRevision> {
  const [row] = await executeUniverseQuery(
    transaction<RevisionRow[]>`
      select
        build_number::text as build_number,
        ingest_version,
        ingested_at::text as ingested_at
      from sde_builds
      order by ingested_at desc, build_number desc
      limit 1
    `,
    signal,
  )
  if (!row) throw new CoreDataProductUnavailableError('Committed SDE revision is missing')
  return {
    buildNumber: positiveSafeInteger(row.build_number, 'build number'),
    ingestVersion: positiveSafeInteger(row.ingest_version, 'ingest version'),
    ingestedAt: nonemptyString(row.ingested_at, 'ingestion timestamp'),
  }
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
    typeId: positiveSafeInteger(row.type_id, 'type ID'),
    typeName: nonemptyString(row.type_name, 'type name'),
    groupId: positiveSafeInteger(row.group_id, 'group ID'),
    groupName: nonemptyString(row.group_name, 'group name'),
  }))
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function positiveSafeInteger(value: unknown, label: string) {
  let parsed = Number.NaN
  if (isPositiveSafeInteger(value)) parsed = value
  else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new CoreDataProductUnavailableError(`Published type-group ${label} is invalid`)
  return parsed
}

function nonemptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new CoreDataProductUnavailableError(`Published type-group ${label} is invalid`)
  return value
}
