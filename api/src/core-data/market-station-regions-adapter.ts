import {
  MARKET_STATION_REGION_MAX_IDS,
  type MarketStationRegion,
  type MarketStationRegionsRequest,
  type MarketStationRegionsResult,
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
  positiveSafeInteger,
  selectCoreDataRevision,
} from './sde-product-adapter.js'

const minimumProjectionVersion = 6

interface StationRegionRow extends postgres.Row {
  station_id: string
  solar_system_id: string
  region_id: string | null
}

const mapStationRegion = (row: StationRegionRow): MarketStationRegion => ({
  stationId: positiveSafeInteger(row.station_id, 'market station ID'),
  solarSystemId: positiveSafeInteger(row.solar_system_id, 'market solar-system ID'),
  regionId: positiveSafeInteger(row.region_id, 'market region ID'),
})

export const loadMarketStationRegionsProduct = (
  request: MarketStationRegionsRequest,
  database: BoundedReadDatabase = sql,
): Promise<MarketStationRegionsResult> => {
  const stationIds = boundedPositiveIds(
    request,
    'stationIds',
    'Market station-region',
    MARKET_STATION_REGION_MAX_IDS,
  )
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new CoreDataProductUnavailableError('Market station-region database operation timed out'),
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
      if (revision.ingestVersion < minimumProjectionVersion) {
        throw new CoreDataProductUnavailableError('Market station-region projection is unavailable')
      }
      const rows = stationIds.length
        ? await executeUniverseQuery(
            transaction<StationRegionRow[]>`
              select stations.station_id::text,
                     systems.solar_system_id::text,
                     systems.region_id::text
              from sde_npc_stations as stations
              join sde_solar_systems as systems
                on systems.solar_system_id = stations.solar_system_id
              where stations.station_id = any(${transaction.array([...stationIds], 20)})
              order by stations.station_id
              limit ${MARKET_STATION_REGION_MAX_IDS}
            `,
            signal,
          )
        : []
      return { complete: true, rows: rows.map(mapStationRegion), revision }
    },
  )
}
