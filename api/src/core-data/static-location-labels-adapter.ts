import type {
  StaticLocationLabel,
  StaticLocationLabelsRequest,
  StaticLocationLabelsResult,
} from '@eve-space/core-data-contract'
import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  executeUniverseQuery,
  runBoundedReadTransaction,
  type BoundedReadDatabase,
} from '../universe/database-read.js'
import {
  boundedPositiveIds,
  CoreDataProductUnavailableError,
  nonemptyString,
  positiveSafeInteger,
  selectCoreDataRevision,
} from './sde-product-adapter.js'

const maximumLocationIds = 500

interface StaticLocationLabelRow extends postgres.Row {
  location_id: string
  kind: 'solar_system' | 'station'
  name: string
  solar_system_id: string
}

export function loadStaticLocationLabelsProduct(
  request: StaticLocationLabelsRequest,
  database: BoundedReadDatabase = sql,
): Promise<StaticLocationLabelsResult> {
  const locationIds = boundedPositiveIds(
    request,
    'locationIds',
    'Static location-label',
    maximumLocationIds,
  )
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Static location-label database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`
          lock table
            sde_projection_state,
            sde_builds,
            sde_solar_systems,
            sde_npc_stations
          in access share mode
        `,
        signal,
      )
      const revision = await selectCoreDataRevision(transaction, signal)
      const sourceRows =
        locationIds.length === 0
          ? []
          : await selectStaticLocationLabels(transaction, signal, locationIds)
      return { complete: true, revision, rows: sourceRows.map(mapStaticLocationLabel) }
    },
  )
}

async function selectStaticLocationLabels(
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  locationIds: readonly number[],
) {
  return executeUniverseQuery(
    transaction<StaticLocationLabelRow[]>`
      select location_id, kind, name, solar_system_id
      from (
        select
          systems.solar_system_id::text as location_id,
          'solar_system'::text as kind,
          systems.name,
          systems.solar_system_id::text as solar_system_id
        from sde_solar_systems as systems
        where systems.solar_system_id = any(${transaction.array([...locationIds], 20)})
        union all
        select
          stations.station_id::text as location_id,
          'station'::text as kind,
          'NPC station ' || stations.station_id::text as name,
          stations.solar_system_id::text as solar_system_id
        from sde_npc_stations as stations
        where stations.station_id = any(${transaction.array([...locationIds], 20)})
      ) as locations
      order by location_id::bigint
      limit ${maximumLocationIds}
    `,
    signal,
  )
}

function mapStaticLocationLabel(row: StaticLocationLabelRow): StaticLocationLabel {
  if (row.kind !== 'solar_system' && row.kind !== 'station') {
    throw new CoreDataProductUnavailableError('Core-data location kind is invalid')
  }
  return {
    kind: row.kind,
    locationId: positiveSafeInteger(row.location_id, 'location ID'),
    name: nonemptyString(row.name, 'location name'),
    solarSystemId: positiveSafeInteger(row.solar_system_id, 'location solar-system ID'),
  }
}
