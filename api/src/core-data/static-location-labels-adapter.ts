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
  solar_system_name: string
  security_status: number
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
            sde_npc_stations,
            sde_dataset_rows
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
    request.signal,
  )
}

async function selectStaticLocationLabels(
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
  locationIds: readonly number[],
) {
  return executeUniverseQuery(
    transaction<StaticLocationLabelRow[]>`
      select location_id, kind, name, solar_system_id, solar_system_name, security_status
      from (
        select
          systems.solar_system_id::text as location_id,
          'solar_system'::text as kind,
          systems.name,
          systems.solar_system_id::text as solar_system_id,
          systems.name as solar_system_name,
          systems.security_status
        from sde_solar_systems as systems
        where systems.solar_system_id = any(${transaction.array([...locationIds], 20)})
        union all
        select
          stations.station_id::text as location_id,
          'station'::text as kind,
          coalesce(
            case when moons.key is not null or planets.key is not null then
              systems.name || ' ' || to_char((station_data.data ->> 'celestialIndex')::integer, 'FMRN') ||
                case when moons.key is not null
                  then ' - Moon ' || (station_data.data ->> 'orbitIndex')
                  else '' end ||
                ' - ' || (owner.data -> 'name' ->> 'en') ||
                case when station_data.data ->> 'useOperationName' = 'true'
                  then ' ' || (operation.data -> 'operationName' ->> 'en')
                  else '' end
            else null end,
            systems.name || ' · NPC station ' || stations.station_id::text
          ) as name,
          stations.solar_system_id::text as solar_system_id,
          systems.name as solar_system_name,
          systems.security_status
        from sde_npc_stations as stations
        join sde_solar_systems as systems on systems.solar_system_id = stations.solar_system_id
        left join sde_dataset_rows as station_data
          on station_data.dataset = 'npcStations' and station_data.key = stations.station_id::text
        left join sde_dataset_rows as moons
          on moons.dataset = 'mapMoons' and moons.key = station_data.data ->> 'orbitID'
        left join sde_dataset_rows as planets
          on planets.dataset = 'mapPlanets' and planets.key = station_data.data ->> 'orbitID'
        left join sde_dataset_rows as owner
          on owner.dataset = 'npcCorporations' and owner.key = station_data.data ->> 'ownerID'
        left join sde_dataset_rows as operation
          on operation.dataset = 'stationOperations'
            and operation.key = station_data.data ->> 'operationID'
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
  if (
    !Number.isFinite(row.security_status) ||
    row.security_status < -1 ||
    row.security_status > 1
  ) {
    throw new CoreDataProductUnavailableError('Core-data system security is invalid')
  }
  return {
    kind: row.kind,
    locationId: positiveSafeInteger(row.location_id, 'location ID'),
    name: nonemptyString(row.name, 'location name'),
    solarSystemId: positiveSafeInteger(row.solar_system_id, 'location solar-system ID'),
    solarSystemName: nonemptyString(row.solar_system_name, 'location solar-system name'),
    solarSystemSecurityStatus: row.security_status,
  }
}
