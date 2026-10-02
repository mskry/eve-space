import {
  MARKET_CATALOGUE_GROUP_PAGE_SIZE,
  MARKET_CATALOGUE_MAX_GROUPS,
  MARKET_CATALOGUE_MAX_TYPES,
  type MarketCatalogueGroup,
  type MarketCatalogueRequest,
  type MarketCatalogueResult,
  type MarketCatalogueType,
  type SdeProjectionRevision,
} from '@eve-space/core-data-contract'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  executeUniverseQuery,
  runBoundedReadTransaction,
  type BoundedReadDatabase,
} from '../universe/database-read.js'
import {
  CoreDataProductUnavailableError,
  nonemptyString,
  positiveSafeInteger,
  selectCoreDataRevision,
} from './sde-product-adapter.js'

const minimumMarketProjectionVersion = 5
const groupPageCursor = /^t_[\da-z]{1,12}$/

interface MarketGroupRow extends postgres.Row {
  market_group_id: string
  parent_group_id: string | null
  name: string
  icon_id: string | null
}

interface DirectTypeCountRow extends postgres.Row {
  market_group_id: string
  direct_type_count: string
}

interface MarketTypeRow extends postgres.Row {
  type_id: string
  market_group_id: string
  name: string
  group_exists?: boolean
}

const typeFromRow = (row: MarketTypeRow): MarketCatalogueType => ({
  id: positiveSafeInteger(row.type_id, 'market type ID'),
  groupId: positiveSafeInteger(row.market_group_id, 'market type group ID'),
  name: nonemptyString(row.name, 'market type name'),
})

const validateParentChain = (
  group: MarketCatalogueGroup,
  byId: ReadonlyMap<number, MarketCatalogueGroup>,
  resolved: Set<number>,
) => {
  const visiting = new Set<number>()
  let cursor: MarketCatalogueGroup | undefined = group
  while (cursor && !resolved.has(cursor.id)) {
    if (visiting.has(cursor.id)) {
      throw new CoreDataProductUnavailableError('Market catalogue contains a parent cycle')
    }
    visiting.add(cursor.id)
    if (cursor.parentId !== null && !byId.has(cursor.parentId)) {
      throw new CoreDataProductUnavailableError('Market catalogue has a missing parent')
    }
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  for (const id of visiting) resolved.add(id)
}

const decodeCursor = (cursor: string | undefined) => {
  if (cursor === undefined) return 0
  if (!groupPageCursor.test(cursor)) {
    throw new TypeError('Invalid market group cursor')
  }
  const id = Number.parseInt(cursor.slice(2), 36)
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Invalid market group cursor')
  return id
}

const validateRequest = (request: MarketCatalogueRequest) => {
  if (request.kind === 'revision' || request.kind === 'tree' || request.kind === 'search-index')
    return
  if (request.kind === 'type-by-id') {
    if (!Number.isSafeInteger(request.typeId) || request.typeId <= 0) {
      throw new TypeError('Invalid market type ID')
    }
    return
  }
  if (request.kind !== 'group-types') throw new TypeError('Invalid market catalogue request')
  if (!Number.isSafeInteger(request.groupId) || request.groupId <= 0) {
    throw new TypeError('Invalid market group ID')
  }
  decodeCursor(request.cursor)
  const pageSize = request.pageSize ?? MARKET_CATALOGUE_GROUP_PAGE_SIZE
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MARKET_CATALOGUE_GROUP_PAGE_SIZE)
    throw new TypeError('Invalid market group page size')
}

const loadTypeById = async (
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  revision: SdeProjectionRevision,
  typeId: number,
): Promise<MarketCatalogueResult> => {
  const [row] = await executeUniverseQuery(
    transaction<MarketTypeRow[]>`
      select types.type_id::text, types.market_group_id::text, types.name,
        groups.market_group_id is not null as group_exists
      from sde_types as types
      left join sde_market_groups as groups on groups.market_group_id = types.market_group_id
      where types.type_id = ${typeId}
        and types.published = true
        and types.market_group_id is not null
      limit 1
    `,
    signal,
  )
  if (row && row.group_exists !== true) {
    throw new CoreDataProductUnavailableError('Market catalogue type has a missing group')
  }
  return { kind: 'type-by-id', complete: true, item: row ? typeFromRow(row) : null, revision }
}

const loadTree = async (
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  revision: SdeProjectionRevision,
): Promise<MarketCatalogueResult> => {
  const groupRows = await executeUniverseQuery(
    transaction<MarketGroupRow[]>`
      select market_group_id::text, parent_group_id::text, name, icon_id::text
      from sde_market_groups as groups
      order by groups.market_group_id
      limit ${MARKET_CATALOGUE_MAX_GROUPS + 1}
    `,
    signal,
  )
  if (groupRows.length === 0 || groupRows.length > MARKET_CATALOGUE_MAX_GROUPS) {
    throw new CoreDataProductUnavailableError('Market catalogue group bound is invalid')
  }
  const countRows = await executeUniverseQuery(
    transaction<DirectTypeCountRow[]>`
      select market_group_id::text, count(*)::text as direct_type_count
      from sde_types
      where published = true and market_group_id is not null
      group by market_group_id
      order by market_group_id
      limit ${MARKET_CATALOGUE_MAX_GROUPS + 1}
    `,
    signal,
  )
  const counts = new Map(
    countRows.map((row) => [
      positiveSafeInteger(row.market_group_id, 'market type group ID'),
      positiveSafeInteger(row.direct_type_count, 'market group type count'),
    ]),
  )
  const groups: MarketCatalogueGroup[] = groupRows.map((row) => {
    const id = positiveSafeInteger(row.market_group_id, 'market group ID')
    return {
      id,
      parentId:
        row.parent_group_id === null
          ? null
          : positiveSafeInteger(row.parent_group_id, 'market parent group ID'),
      name: nonemptyString(row.name, 'market group name'),
      iconId:
        row.icon_id === null ? null : positiveSafeInteger(row.icon_id, 'market group icon ID'),
      directTypeCount: counts.get(id) ?? 0,
    }
  })
  const byId = new Map(groups.map((group) => [group.id, group]))
  const resolved = new Set<number>()
  for (const group of groups) validateParentChain(group, byId, resolved)
  if (
    countRows.length > MARKET_CATALOGUE_MAX_GROUPS ||
    [...counts.keys()].some((id) => !byId.has(id))
  ) {
    throw new CoreDataProductUnavailableError('Market catalogue type has a missing group')
  }
  const totalTypes = groups.reduce((total, group) => total + group.directTypeCount, 0)
  if (totalTypes > MARKET_CATALOGUE_MAX_TYPES) {
    throw new CoreDataProductUnavailableError('Market catalogue exceeds the type bound')
  }
  return { kind: 'tree', complete: true, revision, groups }
}

const loadGroupTypes = async (
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  revision: SdeProjectionRevision,
  request: Extract<MarketCatalogueRequest, { kind: 'group-types' }>,
): Promise<MarketCatalogueResult> => {
  const [group] = await executeUniverseQuery(
    transaction<postgres.Row[]>`
      select market_group_id from sde_market_groups where market_group_id = ${request.groupId}
    `,
    signal,
  )
  if (!group) throw new CoreDataProductUnavailableError('Market group is missing')
  const afterId = decodeCursor(request.cursor)
  const pageSize = request.pageSize ?? MARKET_CATALOGUE_GROUP_PAGE_SIZE
  const rows = await executeUniverseQuery(
    transaction<MarketTypeRow[]>`
      select type_id::text, market_group_id::text, name
      from sde_types as types
      where types.published = true and types.market_group_id = ${request.groupId} and types.type_id > ${afterId}
      order by types.type_id
      limit ${pageSize + 1}
    `,
    signal,
  )
  const items = rows.slice(0, pageSize).map(typeFromRow)
  const lastId = items.at(-1)?.id
  const nextCursor = rows.length > pageSize && lastId ? `t_${lastId.toString(36)}` : null
  return { kind: 'group-types', groupId: request.groupId, items, nextCursor, revision }
}

const loadSearchIndex = async (
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  revision: SdeProjectionRevision,
): Promise<MarketCatalogueResult> => {
  const rows = await executeUniverseQuery(
    transaction<MarketTypeRow[]>`
      select types.type_id::text as type_id, types.market_group_id::text as market_group_id,
        types.name, groups.market_group_id is not null as group_exists
      from sde_types as types
      left join sde_market_groups as groups on groups.market_group_id = types.market_group_id
      where types.published = true and types.market_group_id is not null
      order by types.type_id
      limit ${MARKET_CATALOGUE_MAX_TYPES + 1}
    `,
    signal,
  )
  if (rows.length > MARKET_CATALOGUE_MAX_TYPES) {
    throw new CoreDataProductUnavailableError('Market catalogue exceeds the type bound')
  }
  if (rows.some((row) => row.group_exists !== true)) {
    throw new CoreDataProductUnavailableError('Market catalogue type has a missing group')
  }
  return { kind: 'search-index', complete: true, revision, types: rows.map(typeFromRow) }
}

export const loadMarketCatalogueProduct = (
  request: MarketCatalogueRequest,
  database: BoundedReadDatabase = sql,
): Promise<MarketCatalogueResult> => {
  validateRequest(request)
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Market catalogue database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`
          lock table sde_projection_state, sde_builds, sde_market_groups, sde_types
          in access share mode
        `,
        signal,
      )
      const revision = await selectCoreDataRevision(transaction, signal)
      if (revision.ingestVersion < minimumMarketProjectionVersion) {
        throw new CoreDataProductUnavailableError('Market catalogue projection is not published')
      }
      if (request.kind === 'revision') return { kind: 'revision', revision }
      if (request.kind === 'tree') return loadTree(transaction, signal, revision)
      if (request.kind === 'search-index') return loadSearchIndex(transaction, signal, revision)
      if (request.kind === 'type-by-id') {
        return loadTypeById(transaction, signal, revision, request.typeId)
      }
      return loadGroupTypes(transaction, signal, revision, request)
    },
    request.signal,
  )
}
